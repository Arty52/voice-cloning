from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
import shutil
from typing import Any, Mapping
from uuid import uuid4

from ..cache import VoiceCache
from ..config import Settings
from ..models import SpeechJob, SpeechJobSegment, SpeechSegmentAssignmentKind
from ..providers import VoiceProvider
from ..samples import sample_hash
from ..voice_library import VoiceLibrary
from .cancellation import cancel_and_drain_task
from .speech import SpeechServiceError, generate_speech
from .speech_audio import (
    SPEECH_RESULT_FILENAME,
    SpeechAudioProcessor,
    SpeechAudioProcessorError,
)


SEGMENTS_DIR_NAME = "segments"


class SpeechJobServiceError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class SpeechJobService:
    def __init__(
        self,
        settings: Settings,
        voice_cache: VoiceCache,
        voice_library: VoiceLibrary,
        audio_processor: SpeechAudioProcessor | None = None,
    ) -> None:
        self.settings = settings
        self.voice_cache = voice_cache
        self.voice_library = voice_library
        self.audio_processor = audio_processor or SpeechAudioProcessor(settings)
        self.jobs_dir = settings.speech_jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, SpeechJob] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def create_job(
        self,
        *,
        text: str,
        default_voice_id: str,
        segments: tuple[SpeechJobSegmentInput, ...],
        provider: VoiceProvider,
        model_id: str | None,
        segment_gap_ms: int | None,
        voice_settings: Mapping[str, Any] | None,
        provider_key: str | None,
    ) -> SpeechJob:
        resolved_segments = self._validate_job_input(
            text=text,
            default_voice_id=default_voice_id,
            segments=segments,
            voice_settings=voice_settings,
        )
        effective_segment_gap_ms = self._validate_segment_gap(segment_gap_ms)
        job_id = uuid4().hex
        job_dir = self._job_dir(job_id)
        job_dir_created = False
        now = _utc_now()
        job = SpeechJob(
            id=job_id,
            status="pending",
            text=text,
            default_voice_id=default_voice_id,
            segment_gap_ms=effective_segment_gap_ms,
            provider_id=provider.id,
            model_id=model_id,
            voice_settings=dict(voice_settings) if voice_settings is not None else None,
            segments=resolved_segments,
            created_at=now,
            updated_at=now,
        )
        try:
            job_dir.mkdir(parents=True, exist_ok=False)
            (job_dir / SEGMENTS_DIR_NAME).mkdir(parents=True, exist_ok=True)
            job_dir_created = True
            self._jobs[job_id] = job
            self._tasks[job_id] = asyncio.create_task(
                self._run_job(
                    job_id,
                    provider=provider,
                    model_id=model_id,
                    provider_key=provider_key,
                )
            )
            return job
        except Exception:
            self._jobs.pop(job_id, None)
            self._tasks.pop(job_id, None)
            if job_dir_created:
                shutil.rmtree(job_dir, ignore_errors=True)
            raise

    def get_job(self, job_id: str) -> SpeechJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise SpeechJobServiceError("Speech job was not found.", 404)
        return job

    async def cancel_job(self, job_id: str) -> SpeechJob:
        job = self.get_job(job_id)
        if job.status in {"success", "error", "canceled"}:
            return job
        task = self._tasks.get(job_id)
        if task is None:
            self._cancel_job_state(job_id)
            return self.get_job(job_id)
        task.cancel()
        await cancel_and_drain_task(task)  # type: ignore[arg-type]
        if self.get_job(job_id).status not in {"success", "error", "canceled"}:
            self._cancel_job_state(job_id)
        return self.get_job(job_id)

    async def regenerate_segment(
        self,
        job_id: str,
        segment_id: str,
        *,
        provider: VoiceProvider,
        provider_key: str | None,
        voice_id: str | None = None,
        voice_settings: Mapping[str, Any] | None = None,
    ) -> SpeechJob:
        job = self.get_job(job_id)
        if job.status == "running" or job_id in self._tasks:
            raise SpeechJobServiceError("Speech job is already running.", 409)
        if job.status != "success":
            raise SpeechJobServiceError("Speech segment can be regenerated only after a successful job.", 409)
        segment = self._segment(job, segment_id)
        next_voice_id = (voice_id or segment.voice_id).strip()
        asset = self.voice_library.get_asset(next_voice_id)
        updated_segment = replace(
            segment,
            voice_id=asset.id,
            voice_name=asset.name,
            voice_settings=(
                _copy_voice_settings(voice_settings) if voice_settings is not None else segment.voice_settings
            ),
            status="pending",
            error=None,
        )
        self._replace_segment(job_id, updated_segment)
        self._update_job(job_id, status="pending", active_segment_id=None, error=None)
        next_job = self.get_job(job_id)
        self._tasks[job_id] = asyncio.create_task(
            self._run_segment_regeneration(
                job_id,
                segment_id=segment_id,
                provider=provider,
                model_id=next_job.model_id,
                provider_key=provider_key,
            )
        )
        return next_job

    def result_path(self, job_id: str) -> Path:
        job = self.get_job(job_id)
        path = self._job_dir(job_id) / SPEECH_RESULT_FILENAME
        if job.status != "success" or job.result_sha256 is None or not path.exists():
            raise SpeechJobServiceError("Speech job result is not ready.", 409)
        return path

    def segment_result_path(self, job_id: str, segment_id: str) -> Path:
        job = self.get_job(job_id)
        segment = self._segment(job, segment_id)
        path = self._segment_path(job_id, segment_id)
        if segment.status != "success" or segment.result_sha256 is None or not path.exists():
            raise SpeechJobServiceError("Speech segment result is not ready.", 409)
        return path

    async def _run_job(
        self,
        job_id: str,
        *,
        provider: VoiceProvider,
        model_id: str | None,
        provider_key: str | None,
    ) -> None:
        self._update_job(job_id, status="running", error=None)
        try:
            for segment in self.get_job(job_id).segments:
                await self._generate_segment(
                    job_id,
                    segment,
                    provider=provider,
                    model_id=model_id,
                    voice_settings=segment.voice_settings,
                    provider_key=provider_key,
                )
            await self._rebuild_result(job_id)
        except asyncio.CancelledError:
            self._cancel_job_state(job_id)
            raise
        except (SpeechServiceError, SpeechAudioProcessorError) as exc:
            detail = exc.detail
            self._fail_active_segment(job_id, detail)
            self._update_job(job_id, status="error", error=detail, active_segment_id=None)
        except Exception:
            self._fail_active_segment(job_id, "Speech job failed.")
            self._update_job(job_id, status="error", error="Speech job failed.", active_segment_id=None)
        finally:
            self._tasks.pop(job_id, None)

    async def _run_segment_regeneration(
        self,
        job_id: str,
        *,
        segment_id: str,
        provider: VoiceProvider,
        model_id: str | None,
        provider_key: str | None,
    ) -> None:
        self._update_job(job_id, status="running", error=None)
        try:
            segment = self._segment(self.get_job(job_id), segment_id)
            await self._generate_segment(
                job_id,
                segment,
                provider=provider,
                model_id=model_id,
                voice_settings=segment.voice_settings,
                provider_key=provider_key,
            )
            await self._rebuild_result(job_id)
        except asyncio.CancelledError:
            self._cancel_job_state(job_id)
            raise
        except (SpeechServiceError, SpeechAudioProcessorError) as exc:
            detail = exc.detail
            self._fail_active_segment(job_id, detail)
            self._update_job(job_id, status="error", error=detail, active_segment_id=None)
        except Exception:
            self._fail_active_segment(job_id, "Speech segment regeneration failed.")
            self._update_job(job_id, status="error", error="Speech segment regeneration failed.", active_segment_id=None)
        finally:
            self._tasks.pop(job_id, None)

    async def _generate_segment(
        self,
        job_id: str,
        segment: SpeechJobSegment,
        *,
        provider: VoiceProvider,
        model_id: str | None,
        voice_settings: Mapping[str, Any] | None,
        provider_key: str | None,
    ) -> None:
        self._replace_segment(job_id, replace(segment, status="running", error=None))
        self._update_job(job_id, active_segment_id=segment.id)
        speech = await generate_speech(
            text=segment.text,
            voice_id=segment.voice_id,
            model_id=model_id,
            provider_key=provider_key,
            voice_settings=voice_settings,
            settings=self.settings,
            provider=provider,
            voice_cache=self.voice_cache,
            voice_library=self.voice_library,
            is_disconnected=_never_disconnected,
        )
        segment_path = self._segment_path(job_id, segment.id)
        segment_path.write_bytes(speech.audio)
        self._replace_segment(
            job_id,
            replace(
                segment,
                status="success",
                generation_count=segment.generation_count + 1,
                character_count=speech.character_count,
                request_id=speech.request_id,
                cache_state=speech.cache_state,
                result_sha256=sample_hash(speech.audio),
                error=None,
            ),
        )

    async def _rebuild_result(self, job_id: str) -> None:
        job = self.get_job(job_id)
        segment_paths = tuple(self._segment_path(job_id, segment.id) for segment in job.segments)
        await self.audio_processor.concatenate(
            segment_paths,
            self._job_dir(job_id) / SPEECH_RESULT_FILENAME,
            segment_gap_ms=job.segment_gap_ms,
        )
        result_content = (self._job_dir(job_id) / SPEECH_RESULT_FILENAME).read_bytes()
        self._update_job(
            job_id,
            status="success",
            active_segment_id=None,
            result_sha256=sample_hash(result_content),
            error=None,
        )

    def _validate_job_input(
        self,
        *,
        text: str,
        default_voice_id: str,
        segments: tuple[SpeechJobSegmentInput, ...],
        voice_settings: Mapping[str, Any] | None,
    ) -> tuple[SpeechJobSegment, ...]:
        if not text.strip():
            raise SpeechJobServiceError("Text is required.", 422)
        if len(text) > self.settings.max_text_chars:
            raise SpeechJobServiceError(f"Text must be {self.settings.max_text_chars} characters or fewer.", 422)
        if not default_voice_id.strip():
            raise SpeechJobServiceError("Default voice is required.", 422)
        self.voice_library.get_asset(default_voice_id)
        if not segments:
            raise SpeechJobServiceError("At least one speech segment is required.", 422)
        if "".join(segment.text for segment in segments) != text:
            raise SpeechJobServiceError("Speech segments must exactly match the submitted text.", 422)

        resolved_segments: list[SpeechJobSegment] = []
        seen_ids: set[str] = set()
        for index, segment in enumerate(segments):
            if not segment.text.strip():
                raise SpeechJobServiceError("Speech segments must contain speakable text.", 422)
            asset = self.voice_library.get_asset(segment.voice_id)
            segment_id = _segment_id(segment.client_segment_id, seen_ids)
            seen_ids.add(segment_id)
            segment_voice_settings = segment.voice_settings if segment.voice_settings is not None else voice_settings
            resolved_segments.append(
                SpeechJobSegment(
                    id=segment_id,
                    index=index,
                    text=segment.text,
                    voice_id=asset.id,
                    voice_name=asset.name,
                    assignment_kind=segment.assignment_kind,
                    voice_settings=_copy_voice_settings(segment_voice_settings),
                )
            )
        return tuple(resolved_segments)

    def _validate_segment_gap(self, segment_gap_ms: int | None) -> int:
        if segment_gap_ms is None:
            return self.settings.speech_job_segment_gap_ms
        if segment_gap_ms < 0:
            raise SpeechJobServiceError("Speech segment gap must be a non-negative integer.", 422)
        return segment_gap_ms

    def _cancel_job_state(self, job_id: str) -> None:
        job = self.get_job(job_id)
        canceled_segments = []
        for segment in job.segments:
            if segment.status in {"pending", "running"}:
                canceled_segments.append(replace(segment, status="canceled", error="Speech generation was canceled."))
            else:
                canceled_segments.append(segment)
        self._update_job(
            job_id,
            status="canceled",
            segments=tuple(canceled_segments),
            active_segment_id=None,
            error="Speech generation was canceled.",
        )

    def _fail_active_segment(self, job_id: str, detail: str) -> None:
        job = self.get_job(job_id)
        if job.active_segment_id is None:
            return
        segment = self._segment(job, job.active_segment_id)
        self._replace_segment(job_id, replace(segment, status="error", error=detail))

    def _update_job(self, job_id: str, **changes: object) -> None:
        job = self.get_job(job_id)
        self._jobs[job_id] = replace(job, updated_at=_utc_now(), **changes)

    def _replace_segment(self, job_id: str, segment: SpeechJobSegment) -> None:
        job = self.get_job(job_id)
        segments = tuple(candidate if candidate.id != segment.id else segment for candidate in job.segments)
        self._update_job(job_id, segments=segments)

    def _segment(self, job: SpeechJob, segment_id: str) -> SpeechJobSegment:
        for segment in job.segments:
            if segment.id == segment_id:
                return segment
        raise SpeechJobServiceError("Speech segment was not found.", 404)

    def _job_dir(self, job_id: str) -> Path:
        return self.jobs_dir / job_id

    def _segment_path(self, job_id: str, segment_id: str) -> Path:
        return self._job_dir(job_id) / SEGMENTS_DIR_NAME / f"{segment_id}.mp3"


class SpeechJobSegmentInput:
    def __init__(
        self,
        *,
        text: str,
        voice_id: str,
        assignment_kind: SpeechSegmentAssignmentKind,
        client_segment_id: str | None = None,
        voice_settings: Mapping[str, Any] | None = None,
    ) -> None:
        self.client_segment_id = client_segment_id
        self.text = text
        self.voice_id = voice_id
        self.assignment_kind = "default" if assignment_kind == "default" else "assigned"
        self.voice_settings = _copy_voice_settings(voice_settings)


async def _never_disconnected() -> bool:
    return False


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _copy_voice_settings(voice_settings: Mapping[str, Any] | None) -> dict[str, object] | None:
    return dict(voice_settings) if voice_settings is not None else None


def _segment_id(candidate: str | None, existing_ids: set[str]) -> str:
    normalized = (candidate or "").strip()
    if normalized and normalized not in existing_ids:
        return normalized
    while True:
        generated = uuid4().hex
        if generated not in existing_ids:
            return generated
