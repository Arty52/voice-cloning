from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
import shutil
from typing import Protocol, cast
from uuid import uuid4

from fastapi import UploadFile

from ..config import Settings
from ..models import (
    SampleProcessingJob,
    SampleProcessingJobStep,
    SampleProcessingJobResult,
    SampleProcessingOperation,
    SampleProcessingOperationId,
    SampleProcessingPreset,
    SampleProcessingPresetId,
    SampleProcessingResult,
    SampleProcessingSourcePreference,
    SampleProcessingWorkflowMode,
    SpeakerSeparationResult,
    SpeakerSeparationSpeaker,
    SpeakerSeparationTranscript,
    VOICE_PRESET_IDS,
    VoiceAsset,
    VoiceProcessingStep,
    VoiceSample,
)
from ..samples import load_sample_file, load_uploaded_sample, sample_hash, save_sample_file, slugify_voice_name
from .cancellation import cancel_and_drain_task
from ..voice_library import VoiceLibrary


RESULT_FILENAME = "result.wav"
RESULT_CONTENT_TYPE = "audio/wav"
DEFAULT_ISOLATION_PROCESSING_PRESET_ID: SampleProcessingPresetId = "balanced"
DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID: SampleProcessingPresetId = "trimBalanced"
RECOMMENDED_WORKFLOW_ORDER: tuple[SampleProcessingOperationId, ...] = (
    "isolateVoice",
    "separateSpeakers",
    "trimSilence",
)

ISOLATION_PROCESSING_PRESETS: tuple[SampleProcessingPreset, ...] = (
    SampleProcessingPreset(
        id="fast",
        label="Fast",
        description="Quickest preview with lighter separation quality.",
    ),
    SampleProcessingPreset(
        id="balanced",
        label="Balanced",
        description="Default vocal isolation quality and runtime.",
    ),
    SampleProcessingPreset(
        id="clean",
        label="Clean",
        description="Balanced isolation with conservative cleanup for background residue.",
    ),
    SampleProcessingPreset(
        id="maxIsolation",
        label="Max Isolation",
        description="Slower, strongest separation attempt for difficult tracks.",
    ),
)

TRIM_SILENCE_PROCESSING_PRESETS: tuple[SampleProcessingPreset, ...] = (
    SampleProcessingPreset(
        id="trimLight",
        label="Light",
        description="Conservative trimming for only quieter or longer empty regions.",
    ),
    SampleProcessingPreset(
        id="trimBalanced",
        label="Balanced",
        description="Default silence trimming with a small amount of preserved room tone.",
    ),
    SampleProcessingPreset(
        id="trimAggressive",
        label="Aggressive",
        description="Tighter trimming for shorter or louder empty regions.",
    ),
)


BASE_OPERATIONS: tuple[SampleProcessingOperation, ...] = (
    SampleProcessingOperation(
        id="isolateVoice",
        label="Isolate Voice",
        description="Separate the vocal stem from music or background audio.",
        enabled=False,
    ),
    SampleProcessingOperation(
        id="trimSilence",
        label="Trim Silence",
        description="Remove long empty sections from a voice sample.",
        enabled=False,
    ),
    SampleProcessingOperation(
        id="separateSpeakers",
        label="Separate Speakers",
        description="Split a source track into individual speaker samples.",
        enabled=False,
    ),
)


class SampleProcessingServiceError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass(frozen=True)
class SampleProcessingRequest:
    job_id: str
    operation_id: SampleProcessingOperationId
    source_path: Path
    output_path: Path
    job_dir: Path
    source: VoiceSample
    processing_preset_id: SampleProcessingPresetId | None = None
    processing_preset_label: str | None = None


@dataclass(frozen=True)
class SampleProcessingWorkflowStepInput:
    operation_id: str
    processing_preset_id: str | None = None


@dataclass(frozen=True)
class ResolvedSampleProcessingWorkflowStep:
    operation: SampleProcessingOperation
    processing_preset_id: SampleProcessingPresetId | None = None
    processing_preset_label: str | None = None


@dataclass(frozen=True)
class SpeakerNameAssignment:
    speaker_id: str
    name: str | None = None


@dataclass(frozen=True)
class SpeakerTranscriptAssignment:
    item_id: str
    speaker_id: str


@dataclass(frozen=True)
class SpeakerAssignmentRequest:
    job_id: str
    job_dir: Path
    source_path: Path
    result: SpeakerSeparationResult
    speaker_names: tuple[SpeakerNameAssignment, ...] = ()
    transcript_assignments: tuple[SpeakerTranscriptAssignment, ...] = ()


@dataclass(frozen=True)
class SpeakerVoiceSelection:
    speaker_id: str
    name: str
    voice_preset_id: str | None = None


class SampleProcessor(Protocol):
    @property
    def engine_name(self) -> str: ...

    def engine_name_for_operation(self, operation_id: SampleProcessingOperationId) -> str: ...

    def operations(self) -> tuple[SampleProcessingOperation, ...]: ...

    async def process(self, request: SampleProcessingRequest) -> SampleProcessingJobResult | None: ...


class SpeakerAssignmentProcessor(Protocol):
    async def update_speaker_assignments(self, request: SpeakerAssignmentRequest) -> SpeakerSeparationResult: ...


class UnavailableSampleProcessor:
    @property
    def engine_name(self) -> str:
        return "unavailable"

    def engine_name_for_operation(self, operation_id: SampleProcessingOperationId) -> str:
        return self.engine_name

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        return ()

    async def process(self, request: SampleProcessingRequest) -> None:
        raise SampleProcessingServiceError("Sample processing is not available.", 503)


class SampleProcessingService:
    def __init__(
        self,
        settings: Settings,
        voice_library: VoiceLibrary,
        processor: SampleProcessor | None = None,
    ) -> None:
        self.settings = settings
        self.voice_library = voice_library
        self.processor = processor or UnavailableSampleProcessor()
        self.processing_dir = settings.sample_processing_dir
        self.processing_dir.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, SampleProcessingJob] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._source_paths: dict[str, Path] = {}
        self._speaker_processing_steps: dict[str, dict[str, tuple[VoiceProcessingStep, ...]]] = {}

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        processor_operations = {operation.id: operation for operation in self.processor.operations()}
        operations: list[SampleProcessingOperation] = []
        for operation in BASE_OPERATIONS:
            processor_operation = processor_operations.get(operation.id)
            operations.append(
                replace(
                    operation,
                    enabled=bool(processor_operation and processor_operation.enabled),
                    description=processor_operation.description if processor_operation else operation.description,
                    label=processor_operation.label if processor_operation else operation.label,
                    processing_presets=processor_operation.processing_presets if processor_operation else (),
                    default_processing_preset_id=(
                        processor_operation.default_processing_preset_id if processor_operation else None
                    ),
                )
            )
        return tuple(operations)

    def engine(self) -> str | None:
        if not any(operation.enabled for operation in self.operations()):
            return None
        return self.processor.engine_name

    def recommended_workflow_order(self) -> tuple[SampleProcessingOperationId, ...]:
        enabled_operation_ids = {operation.id for operation in self.operations() if operation.enabled}
        return tuple(operation_id for operation_id in RECOMMENDED_WORKFLOW_ORDER if operation_id in enabled_operation_ids)

    async def create_job(
        self,
        *,
        operation_id: str | None,
        processing_preset_id: str | None = None,
        source_preference: str | None,
        source_voice_id: str | None = None,
        source_upload: UploadFile | None = None,
        workflow_steps: tuple[SampleProcessingWorkflowStepInput, ...] | None = None,
    ) -> SampleProcessingJob:
        resolved_source_preference = _normalize_source_preference(source_preference)
        resolved_steps = self._resolve_workflow_steps(
            operation_id=operation_id,
            processing_preset_id=processing_preset_id,
            workflow_steps=workflow_steps,
        )
        workflow_mode: SampleProcessingWorkflowMode = "stack" if workflow_steps is not None else "single"
        terminal_operation = _terminal_operation_id(resolved_steps)
        first_step = resolved_steps[0]

        if bool(source_voice_id and source_voice_id.strip()) == bool(source_upload):
            raise SampleProcessingServiceError("Choose one source voice or upload one source file.", 422)

        job_id = uuid4().hex
        job_dir = self._job_dir(job_id)
        job_dir_created = False
        try:
            if source_upload is not None:
                job_dir.mkdir(parents=True, exist_ok=False)
                job_dir_created = True
                source_path, source_sample, source_name = await self._source_from_upload(job_dir, source_upload)
            else:
                source_path, source_sample, source_name = self._source_from_voice(
                    (source_voice_id or "").strip(),
                    resolved_source_preference,
                )
                job_dir.mkdir(parents=True, exist_ok=False)
                job_dir_created = True

            now = _utc_now()
            job_steps = _initial_job_steps(
                job_id=job_id,
                workflow_mode=workflow_mode,
                steps=resolved_steps,
                processor=self.processor,
            )
            job = SampleProcessingJob(
                id=job_id,
                operation_id=terminal_operation,
                status="pending",
                source_name=source_name,
                source_filename=source_sample.filename,
                source_content_type=source_sample.content_type,
                source_sha256=source_sample.sha256,
                source_preference=resolved_source_preference,
                created_at=now,
                updated_at=now,
                engine=self.processor.engine_name_for_operation(first_step.operation.id),
                processing_preset_id=first_step.processing_preset_id,
                processing_preset_label=first_step.processing_preset_label,
                workflow_mode=workflow_mode,
                steps=job_steps,
            )
            self._jobs[job_id] = job
            self._source_paths[job_id] = source_path
            request = SampleProcessingRequest(
                job_id=job_id,
                operation_id=first_step.operation.id,
                source_path=source_path,
                output_path=job_dir / RESULT_FILENAME,
                job_dir=job_dir,
                source=source_sample,
                processing_preset_id=first_step.processing_preset_id,
                processing_preset_label=first_step.processing_preset_label,
            )
            self._tasks[job_id] = asyncio.create_task(self._run_job(job_id, request, resolved_steps))
            return job
        except Exception:
            self._jobs.pop(job_id, None)
            self._tasks.pop(job_id, None)
            self._source_paths.pop(job_id, None)
            self._speaker_processing_steps.pop(job_id, None)
            if job_dir_created:
                shutil.rmtree(job_dir, ignore_errors=True)
            raise

    def get_job(self, job_id: str) -> SampleProcessingJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise SampleProcessingServiceError("Sample processing job was not found.", 404)
        return job

    async def cancel_job(self, job_id: str) -> SampleProcessingJob:
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

    def result_path(self, job_id: str) -> Path:
        job = self.get_job(job_id)
        if job.status != "success" or job.result is None:
            raise SampleProcessingServiceError("Sample processing result is not ready.", 409)
        if not isinstance(job.result, SampleProcessingResult):
            raise SampleProcessingServiceError(
                "Speaker separation jobs expose per-speaker audio results.",
                409,
            )
        return self._result_path(job.result)

    def source_path(self, job_id: str) -> Path:
        job = self.get_job(job_id)
        if job.status != "success" or not isinstance(job.result, SpeakerSeparationResult):
            raise SampleProcessingServiceError("Speaker separation source is not ready.", 409)
        path = self._source_paths.get(job_id)
        if path is None:
            raise SampleProcessingServiceError("Speaker separation source is missing.", 404)
        resolved_path = path.resolve()
        _require_allowed_source_path(resolved_path, self.processing_dir, self.voice_library.assets_dir)
        if not resolved_path.exists():
            raise SampleProcessingServiceError("Speaker separation source is missing.", 404)
        return resolved_path

    def speaker_result_path(self, job_id: str, speaker_id: str) -> Path:
        job = self.get_job(job_id)
        result = self._speaker_separation_result(job)
        speaker = _speaker_by_id(result, speaker_id)
        if speaker.result is None:
            raise SampleProcessingServiceError("Speaker result is not ready.", 409)
        return self._result_path(speaker.result)

    def save_result_as_voice(
        self,
        job_id: str,
        *,
        name: str,
        voice_preset_id: str | None = None,
    ) -> VoiceAsset:
        job = self.get_job(job_id)
        if job.status != "success" or job.result is None:
            raise SampleProcessingServiceError("Sample processing result is not ready.", 409)
        result_path = self.result_path(job_id)
        sample = load_sample_file(result_path, job.result.content_type)
        steps = self._voice_processing_steps_for_job(job, final_result_sha256=sample.sha256)
        return self.voice_library.add_processed_sample(
            name,
            sample,
            processing_steps=steps,
            voice_preset_id=voice_preset_id,
        )

    async def update_speaker_assignments(
        self,
        job_id: str,
        *,
        speaker_names: tuple[SpeakerNameAssignment, ...] = (),
        transcript_assignments: tuple[SpeakerTranscriptAssignment, ...] = (),
    ) -> SampleProcessingJob:
        job = self.get_job(job_id)
        result = self._speaker_separation_result(job)
        source_path = self.source_path(job_id)
        _validate_speaker_assignments(result, speaker_names, transcript_assignments)
        if not speaker_names and not transcript_assignments:
            return job
        update_assignments = getattr(self.processor, "update_speaker_assignments", None)
        if update_assignments is None:
            raise SampleProcessingServiceError("Speaker assignment updates are not available for this processor.", 503)
        assignment_processor = cast(SpeakerAssignmentProcessor, self.processor)

        updated_result = await assignment_processor.update_speaker_assignments(
            SpeakerAssignmentRequest(
                job_id=job.id,
                job_dir=self._job_dir(job.id),
                source_path=source_path,
                result=result,
                speaker_names=speaker_names,
                transcript_assignments=transcript_assignments,
            )
        )
        self._validate_speaker_separation_result(updated_result)
        trim_step = _successful_job_step(job, "trimSilence")
        if trim_step is not None:
            self._refresh_speaker_processing_steps_from_result(
                job_id,
                updated_result,
                operation_id="separateSpeakers",
            )
            updated_result, trim_steps = await self._run_trim_on_speakers(
                job_id,
                trim_step,
                _resolved_workflow_step_from_job_step(trim_step, self._enabled_operation("trimSilence")),
                updated_result,
            )
            self._replace_speaker_processing_step(job_id, trim_step.id, trim_steps)
            self._update_step(
                job_id,
                trim_step.id,
                result_sha256=_aggregate_speaker_result_sha256(updated_result),
            )
        else:
            self._refresh_speaker_processing_steps_from_result(job_id, updated_result)
        self._update_job(job_id, result=updated_result)
        return self.get_job(job_id)

    def save_speaker_results_as_voices(
        self,
        job_id: str,
        *,
        voices: tuple[SpeakerVoiceSelection, ...],
    ) -> tuple[VoiceAsset, ...]:
        job = self.get_job(job_id)
        result = self._speaker_separation_result(job)
        normalized = self._validate_speaker_voice_selections(result, voices)
        prepared: list[tuple[SpeakerVoiceSelection, VoiceSample, tuple[VoiceProcessingStep, ...]]] = []
        for selection, speaker in normalized:
            if speaker.result is None:
                raise SampleProcessingServiceError("Speaker result is not ready.", 409)
            result_path = self._result_path(speaker.result)
            sample = load_sample_file(result_path, speaker.result.content_type)
            steps = self._voice_processing_steps_for_speaker(job, speaker, final_result_sha256=sample.sha256)
            prepared.append(
                (
                    selection,
                    sample,
                    steps,
                )
            )

        saved: list[VoiceAsset] = []
        try:
            for selection, sample, steps in prepared:
                saved.append(
                    self.voice_library.add_processed_sample(
                        selection.name,
                        sample,
                        processing_steps=steps,
                        voice_preset_id=selection.voice_preset_id,
                    )
                )
        except Exception:
            for voice in saved:
                try:
                    self.voice_library.delete_asset(voice.id)
                except Exception:
                    pass
            raise
        return tuple(saved)

    async def _run_job(
        self,
        job_id: str,
        initial_request: SampleProcessingRequest,
        workflow_steps: tuple[ResolvedSampleProcessingWorkflowStep, ...],
    ) -> None:
        self._update_job(job_id, status="running")
        current_path = initial_request.source_path
        current_sample = initial_request.source
        speaker_result: SpeakerSeparationResult | None = None
        result: SampleProcessingJobResult | None = None
        prior_voice_steps: list[VoiceProcessingStep] = []
        try:
            for index, workflow_step in enumerate(workflow_steps):
                step = self.get_job(job_id).steps[index]
                if speaker_result is not None and workflow_step.operation.id != "trimSilence":
                    raise SampleProcessingServiceError("Speaker Separation must be the final split step in a workflow.", 422)

                self._start_step(job_id, step.id, source_sha256=_current_source_sha256(speaker_result, current_sample))
                if speaker_result is not None and workflow_step.operation.id == "trimSilence":
                    speaker_result, speaker_steps = await self._run_trim_on_speakers(
                        job_id,
                        step,
                        workflow_step,
                        speaker_result,
                    )
                    self._extend_speaker_processing_steps(job_id, speaker_steps)
                    result = speaker_result
                    self._finish_step(
                        job_id,
                        step.id,
                        result_sha256=_aggregate_speaker_result_sha256(speaker_result),
                    )
                    continue

                output_path = _step_output_path(
                    initial_request.job_dir,
                    step.id,
                    is_final=index == len(workflow_steps) - 1,
                )
                request = SampleProcessingRequest(
                    job_id=job_id,
                    operation_id=workflow_step.operation.id,
                    source_path=current_path,
                    output_path=output_path,
                    job_dir=initial_request.job_dir,
                    source=current_sample,
                    processing_preset_id=workflow_step.processing_preset_id,
                    processing_preset_label=workflow_step.processing_preset_label,
                )
                processed_result = await self.processor.process(request)
                if processed_result is None:
                    current_sample = load_sample_file(request.output_path, RESULT_CONTENT_TYPE)
                    result = SampleProcessingResult(
                        path=request.output_path.relative_to(self.processing_dir).as_posix(),
                        filename=request.output_path.name,
                        content_type=current_sample.content_type,
                        sha256=current_sample.sha256,
                    )
                    prior_voice_steps.append(
                        _voice_step_from_job_step(
                            replace(step, result_sha256=current_sample.sha256),
                            source_sha256=request.source.sha256,
                            result_sha256=current_sample.sha256,
                        )
                    )
                    current_path = request.output_path
                    self._finish_step(job_id, step.id, result_sha256=current_sample.sha256)
                    continue

                result = processed_result
                if isinstance(result, SpeakerSeparationResult):
                    self._validate_speaker_separation_result(result)
                    speaker_result = result
                    self._source_paths[job_id] = current_path
                    self._speaker_processing_steps[job_id] = _speaker_steps_from_result(
                        step,
                        speaker_result,
                        source_sha256=current_sample.sha256,
                        prior_steps=tuple(prior_voice_steps),
                    )
                    self._finish_step(
                        job_id,
                        step.id,
                        result_sha256=_aggregate_speaker_result_sha256(speaker_result),
                    )
                    continue

                raise SampleProcessingServiceError("Sample processor returned an unsupported result.", 500)

            if result is None:
                raise SampleProcessingServiceError("Sample processing did not produce a result.", 500)
            self._update_job(job_id, status="success", result=result, active_step_id=None)
        except asyncio.CancelledError:
            self._cancel_job_state(job_id)
            raise
        except SampleProcessingServiceError as exc:
            self._fail_active_step(job_id, exc.detail)
            self._update_job(job_id, status="error", error=exc.detail, active_step_id=None)
        except Exception:
            self._fail_active_step(job_id, "Sample processing failed.")
            self._update_job(job_id, status="error", error="Sample processing failed.", active_step_id=None)
        finally:
            self._tasks.pop(job_id, None)

    async def _run_trim_on_speakers(
        self,
        job_id: str,
        step: SampleProcessingJobStep,
        workflow_step: ResolvedSampleProcessingWorkflowStep,
        result: SpeakerSeparationResult,
    ) -> tuple[SpeakerSeparationResult, dict[str, tuple[VoiceProcessingStep, ...]]]:
        job_dir = self._job_dir(job_id)
        updated_speakers: list[SpeakerSeparationSpeaker] = []
        added_steps: dict[str, tuple[VoiceProcessingStep, ...]] = {}
        for speaker in result.speakers:
            if speaker.result is None:
                raise SampleProcessingServiceError("Speaker result is not ready.", 409)
            source_path = self._result_path(speaker.result)
            source_sample = load_sample_file(source_path, speaker.result.content_type)
            output_path = job_dir / f"{speaker.id}-trimmed.wav"
            request = SampleProcessingRequest(
                job_id=job_id,
                operation_id=workflow_step.operation.id,
                source_path=source_path,
                output_path=output_path,
                job_dir=job_dir,
                source=source_sample,
                processing_preset_id=workflow_step.processing_preset_id,
                processing_preset_label=workflow_step.processing_preset_label,
            )
            processed_result = await self.processor.process(request)
            if processed_result is not None:
                raise SampleProcessingServiceError("Trim Silence returned an unsupported result.", 500)
            trimmed_sample = load_sample_file(output_path, RESULT_CONTENT_TYPE)
            trimmed_result = SampleProcessingResult(
                path=output_path.relative_to(self.processing_dir).as_posix(),
                filename=output_path.name,
                content_type=trimmed_sample.content_type,
                sha256=trimmed_sample.sha256,
            )
            updated_speakers.append(replace(speaker, result=trimmed_result))
            added_steps[speaker.id] = (
                _voice_step_from_job_step(
                    step,
                    source_sha256=source_sample.sha256,
                    result_sha256=trimmed_sample.sha256,
                    speaker_id=speaker.id,
                    speaker_label=speaker.label,
                ),
            )
        updated_result = SpeakerSeparationResult(
            kind=result.kind,
            speakers=tuple(updated_speakers),
            transcript=result.transcript,
        )
        self._validate_speaker_separation_result(updated_result)
        return updated_result, added_steps

    def _update_job(self, job_id: str, **changes: object) -> None:
        job = self.get_job(job_id)
        self._jobs[job_id] = replace(job, updated_at=_utc_now(), **changes)

    def _start_step(self, job_id: str, step_id: str, *, source_sha256: str | None) -> None:
        self._update_step(
            job_id,
            step_id,
            status="running",
            started_at=_utc_now(),
            source_sha256=source_sha256,
        )
        self._update_job(job_id, active_step_id=step_id)

    def _finish_step(self, job_id: str, step_id: str, *, result_sha256: str | None) -> None:
        self._update_step(
            job_id,
            step_id,
            status="success",
            completed_at=_utc_now(),
            result_sha256=result_sha256,
        )

    def _fail_active_step(self, job_id: str, error: str) -> None:
        job = self.get_job(job_id)
        if job.active_step_id is None:
            return
        self._update_step(
            job_id,
            job.active_step_id,
            status="error",
            completed_at=_utc_now(),
            error=error,
        )

    def _cancel_job_state(self, job_id: str) -> None:
        job = self.get_job(job_id)
        active_step_id = job.active_step_id
        if active_step_id is not None:
            self._update_step(
                job_id,
                active_step_id,
                status="canceled",
                completed_at=_utc_now(),
                error="Sample processing was canceled.",
            )
        canceled_steps = tuple(
            replace(step, status="canceled", completed_at=step.completed_at or _utc_now())
            if step.status == "pending"
            else step
            for step in self.get_job(job_id).steps
        )
        self._update_job(
            job_id,
            status="canceled",
            error="Sample processing was canceled.",
            active_step_id=None,
            steps=canceled_steps,
        )

    def _update_step(self, job_id: str, step_id: str, **changes: object) -> None:
        job = self.get_job(job_id)
        steps = tuple(replace(step, **changes) if step.id == step_id else step for step in job.steps)
        self._update_job(job_id, steps=steps)

    def _extend_speaker_processing_steps(
        self,
        job_id: str,
        steps_by_speaker_id: dict[str, tuple[VoiceProcessingStep, ...]],
    ) -> None:
        current = self._speaker_processing_steps.setdefault(job_id, {})
        for speaker_id, steps in steps_by_speaker_id.items():
            current[speaker_id] = (*current.get(speaker_id, ()), *steps)

    def _replace_speaker_processing_step(
        self,
        job_id: str,
        step_id: str,
        steps_by_speaker_id: dict[str, tuple[VoiceProcessingStep, ...]],
    ) -> None:
        current = self._speaker_processing_steps.setdefault(job_id, {})
        for speaker_id, replacement_steps in steps_by_speaker_id.items():
            existing_steps = current.get(speaker_id, ())
            updated_steps: list[VoiceProcessingStep] = []
            replaced = False
            for step in existing_steps:
                if step.id == step_id:
                    updated_steps.extend(replacement_steps)
                    replaced = True
                else:
                    updated_steps.append(step)
            if not replaced:
                updated_steps.extend(replacement_steps)
            current[speaker_id] = tuple(updated_steps)

    def _refresh_speaker_processing_steps_from_result(
        self,
        job_id: str,
        result: SpeakerSeparationResult,
        *,
        operation_id: SampleProcessingOperationId | None = None,
    ) -> None:
        current = self._speaker_processing_steps.get(job_id)
        if not current:
            return
        for speaker in result.speakers:
            if speaker.result is None or speaker.id not in current or not current[speaker.id]:
                continue
            steps = current[speaker.id]
            step_index = _speaker_processing_step_index(steps, operation_id=operation_id)
            if step_index is None:
                continue
            current[speaker.id] = (
                *steps[:step_index],
                replace(steps[step_index], result_sha256=speaker.result.sha256),
                *steps[step_index + 1 :],
            )

    def _voice_processing_steps_for_job(
        self,
        job: SampleProcessingJob,
        *,
        final_result_sha256: str,
    ) -> tuple[VoiceProcessingStep, ...]:
        if job.workflow_mode == "single" and len(job.steps) == 1:
            step = job.steps[0]
            return (
                VoiceProcessingStep(
                    id=job.id,
                    label=step.operation_label,
                    operation_id=step.operation_id,
                    created_at=_utc_now(),
                    source_sha256=step.source_sha256 or job.source_sha256,
                    result_sha256=final_result_sha256,
                    engine=step.engine,
                    processing_preset_id=step.processing_preset_id,
                    processing_preset_label=step.processing_preset_label,
                ),
            )
        steps: list[VoiceProcessingStep] = []
        for step in job.steps:
            if step.status != "success":
                continue
            result_sha256 = step.result_sha256 or final_result_sha256
            steps.append(
                _voice_step_from_job_step(
                    step,
                    source_sha256=step.source_sha256 or job.source_sha256,
                    result_sha256=result_sha256,
                )
            )
        return tuple(steps)

    def _voice_processing_steps_for_speaker(
        self,
        job: SampleProcessingJob,
        speaker: SpeakerSeparationSpeaker,
        *,
        final_result_sha256: str,
    ) -> tuple[VoiceProcessingStep, ...]:
        speaker_steps = self._speaker_processing_steps.get(job.id, {}).get(speaker.id)
        if speaker_steps:
            return speaker_steps
        return (
            VoiceProcessingStep(
                id=job.id,
                label=self._operation_label(job.operation_id),
                operation_id=job.operation_id,
                created_at=_utc_now(),
                source_sha256=job.source_sha256,
                result_sha256=final_result_sha256,
                engine=job.engine,
                processing_preset_id=job.processing_preset_id,
                processing_preset_label=job.processing_preset_label,
                speaker_id=speaker.id,
                speaker_label=speaker.label,
            ),
        )

    def _resolve_workflow_steps(
        self,
        *,
        operation_id: str | None,
        processing_preset_id: str | None,
        workflow_steps: tuple[SampleProcessingWorkflowStepInput, ...] | None,
    ) -> tuple[ResolvedSampleProcessingWorkflowStep, ...]:
        if workflow_steps is None:
            if not operation_id:
                raise SampleProcessingServiceError("Operation is required.", 422)
            workflow_steps = (
                SampleProcessingWorkflowStepInput(
                    operation_id=operation_id,
                    processing_preset_id=processing_preset_id,
                ),
            )
        if not workflow_steps:
            raise SampleProcessingServiceError("Choose at least one sample processing step.", 422)

        seen_operation_ids: set[SampleProcessingOperationId] = set()
        resolved_by_id: dict[SampleProcessingOperationId, ResolvedSampleProcessingWorkflowStep] = {}
        for step in workflow_steps:
            operation_id = _normalize_operation_id(step.operation_id)
            if operation_id in seen_operation_ids:
                raise SampleProcessingServiceError("Sample processing steps cannot be duplicated.", 422)
            seen_operation_ids.add(operation_id)
            operation = self._enabled_operation(operation_id)
            preset_id, preset_label = _normalize_processing_preset(step.processing_preset_id, operation)
            resolved_by_id[operation_id] = ResolvedSampleProcessingWorkflowStep(
                operation=operation,
                processing_preset_id=preset_id,
                processing_preset_label=preset_label,
            )

        return tuple(
            resolved_by_id[operation_id]
            for operation_id in RECOMMENDED_WORKFLOW_ORDER
            if operation_id in resolved_by_id
        )

    def _enabled_operation(self, operation_id: SampleProcessingOperationId) -> SampleProcessingOperation:
        for operation in self.operations():
            if operation.id == operation_id:
                if operation.enabled:
                    return operation
                raise SampleProcessingServiceError(
                    "Sample processing is not available. Configure a processor to use this operation.",
                    503,
                )
        raise SampleProcessingServiceError(f"Unsupported sample processing operation: {operation_id}.", 422)

    def _operation_label(self, operation_id: SampleProcessingOperationId) -> str:
        for operation in self.operations():
            if operation.id == operation_id:
                return operation.label
        return operation_id

    def _speaker_separation_result(self, job: SampleProcessingJob) -> SpeakerSeparationResult:
        if job.status != "success" or job.result is None:
            raise SampleProcessingServiceError("Speaker separation result is not ready.", 409)
        if not isinstance(job.result, SpeakerSeparationResult):
            raise SampleProcessingServiceError("Sample processing job is not a speaker separation result.", 409)
        return job.result

    def _result_path(self, result: SampleProcessingResult) -> Path:
        path = (self.processing_dir / result.path).resolve()
        _require_relative_path(path, self.processing_dir)
        if not path.exists():
            raise SampleProcessingServiceError("Sample processing result is missing.", 404)
        return path

    def _validate_speaker_separation_result(self, result: SpeakerSeparationResult) -> None:
        if result.kind != "speakerSeparation":
            raise SampleProcessingServiceError("Speaker separation result kind is invalid.", 500)
        speaker_ids = [speaker.id for speaker in result.speakers]
        if not speaker_ids or len(speaker_ids) != len(set(speaker_ids)):
            raise SampleProcessingServiceError("Speaker separation result has invalid speakers.", 500)
        known_speaker_ids = set(speaker_ids)
        item_ids: set[str] = set()
        speaker_id_by_item_id: dict[str, str] = {}
        for item in result.transcript.items:
            if not item.id or item.id in item_ids or item.speaker_id not in known_speaker_ids:
                raise SampleProcessingServiceError("Speaker separation transcript is invalid.", 500)
            if item.start_seconds < 0 or item.end_seconds <= item.start_seconds:
                raise SampleProcessingServiceError("Speaker separation transcript timing is invalid.", 500)
            item_ids.add(item.id)
            speaker_id_by_item_id[item.id] = item.speaker_id
        for speaker in result.speakers:
            if not speaker.id or not speaker.label:
                raise SampleProcessingServiceError("Speaker separation result has invalid speakers.", 500)
            unknown_items = set(speaker.transcript_item_ids) - item_ids
            if unknown_items:
                raise SampleProcessingServiceError("Speaker separation speaker references invalid transcript items.", 500)
            if len(speaker.transcript_item_ids) != len(set(speaker.transcript_item_ids)):
                raise SampleProcessingServiceError("Speaker separation speaker references duplicate transcript items.", 500)
            for item_id in speaker.transcript_item_ids:
                if speaker_id_by_item_id[item_id] != speaker.id:
                    raise SampleProcessingServiceError(
                        "Speaker separation speaker references transcript items assigned to another speaker.",
                        500,
                    )
            assigned_item_ids = {
                item_id for item_id, speaker_id in speaker_id_by_item_id.items() if speaker_id == speaker.id
            }
            if set(speaker.transcript_item_ids) != assigned_item_ids:
                raise SampleProcessingServiceError("Speaker separation speaker transcript items are incomplete.", 500)
            if speaker.result is not None:
                self._result_path(speaker.result)

    def _validate_speaker_voice_selections(
        self,
        result: SpeakerSeparationResult,
        voices: tuple[SpeakerVoiceSelection, ...],
    ) -> tuple[tuple[SpeakerVoiceSelection, SpeakerSeparationSpeaker], ...]:
        if not voices:
            raise SampleProcessingServiceError("Choose at least one speaker to save.", 422)
        existing_assets = self.voice_library.list_assets()
        existing_ids = {asset.id for asset in existing_assets}
        existing_names = {slugify_voice_name(asset.name) for asset in existing_assets}
        seen_speaker_ids: set[str] = set()
        seen_names: set[str] = set()
        normalized: list[tuple[SpeakerVoiceSelection, SpeakerSeparationSpeaker]] = []
        for selection in voices:
            if selection.speaker_id in seen_speaker_ids:
                raise SampleProcessingServiceError("Speaker can only be selected once.", 422)
            seen_speaker_ids.add(selection.speaker_id)
            speaker = _speaker_by_id(result, selection.speaker_id)
            display_name = selection.name.strip()
            if not display_name:
                raise SampleProcessingServiceError("Voice name is required.", 422)
            normalized_name = slugify_voice_name(display_name)
            if normalized_name in seen_names:
                raise SampleProcessingServiceError("Speaker voice names must be unique.", 409)
            if normalized_name in existing_ids or normalized_name in existing_names:
                raise SampleProcessingServiceError("A voice with that name already exists.", 409)
            if selection.voice_preset_id not in (None, "", *VOICE_PRESET_IDS):
                raise SampleProcessingServiceError("Voice preset must be standardNarration or animatedDialogue.", 422)
            if speaker.result is None:
                raise SampleProcessingServiceError("Speaker result is not ready.", 409)
            seen_names.add(normalized_name)
            normalized.append(
                (
                    SpeakerVoiceSelection(
                        speaker_id=selection.speaker_id,
                        name=display_name,
                        voice_preset_id=selection.voice_preset_id,
                    ),
                    speaker,
                )
            )
        return tuple(normalized)

    async def _source_from_upload(
        self,
        job_dir: Path,
        upload: UploadFile,
    ) -> tuple[Path, VoiceSample, str]:
        source_sample = await load_uploaded_sample(
            upload,
            self.settings,
            max_bytes=self.settings.max_source_upload_bytes,
        )
        source_name = Path(source_sample.filename).stem or "Uploaded Source"
        source_path = job_dir / f"source{Path(source_sample.filename).suffix.lower() or '.wav'}"
        saved_source = save_sample_file(source_sample, source_path)
        return source_path, saved_source, source_name

    def _source_from_voice(
        self,
        voice_id: str,
        source_preference: SampleProcessingSourcePreference,
    ) -> tuple[Path, VoiceSample, str]:
        if not voice_id:
            raise SampleProcessingServiceError("Source voice is required.", 422)
        asset = self.voice_library.get_asset(voice_id)
        source_path = self._voice_source_path(asset, source_preference)
        content_type = (
            asset.source_content_type
            if source_preference == "original" and asset.source_file_path
            else asset.content_type
        )
        sample = load_sample_file(source_path, content_type or asset.content_type)
        return source_path, sample, asset.name

    def _voice_source_path(
        self,
        asset: VoiceAsset,
        source_preference: SampleProcessingSourcePreference,
    ) -> Path:
        if source_preference == "original" and asset.source_file_path:
            source_path = (self.voice_library.assets_dir / asset.source_file_path).resolve()
            _require_relative_path(source_path, self.voice_library.assets_dir)
            if source_path.exists():
                return source_path
        return self.voice_library.resolve_asset_path(asset)

    def _job_dir(self, job_id: str) -> Path:
        path = (self.processing_dir / job_id).resolve()
        _require_relative_path(path, self.processing_dir)
        return path


def _normalize_operation_id(value: str) -> SampleProcessingOperationId:
    if value in {"isolateVoice", "trimSilence", "separateSpeakers"}:
        return value  # type: ignore[return-value]
    raise SampleProcessingServiceError(f"Unsupported sample processing operation: {value}.", 422)


def _terminal_operation_id(
    steps: tuple[ResolvedSampleProcessingWorkflowStep, ...],
) -> SampleProcessingOperationId:
    operation_ids = [step.operation.id for step in steps]
    if "separateSpeakers" in operation_ids:
        return "separateSpeakers"
    return operation_ids[-1]


def _initial_job_steps(
    *,
    job_id: str,
    workflow_mode: SampleProcessingWorkflowMode,
    steps: tuple[ResolvedSampleProcessingWorkflowStep, ...],
    processor: SampleProcessor,
) -> tuple[SampleProcessingJobStep, ...]:
    return tuple(
        SampleProcessingJobStep(
            id=job_id if workflow_mode == "single" else f"{job_id}-step-{index + 1}",
            operation_id=step.operation.id,
            operation_label=step.operation.label,
            status="pending",
            engine=processor.engine_name_for_operation(step.operation.id),
            processing_preset_id=step.processing_preset_id,
            processing_preset_label=step.processing_preset_label,
        )
        for index, step in enumerate(steps)
    )


def _step_output_path(
    job_dir: Path,
    step_id: str,
    *,
    is_final: bool,
) -> Path:
    if is_final:
        return job_dir / RESULT_FILENAME
    return job_dir / f"{step_id}.wav"


def _voice_step_from_job_step(
    step: SampleProcessingJobStep,
    *,
    source_sha256: str,
    result_sha256: str,
    speaker_id: str | None = None,
    speaker_label: str | None = None,
) -> VoiceProcessingStep:
    return VoiceProcessingStep(
        id=step.id,
        label=step.operation_label,
        operation_id=step.operation_id,
        created_at=step.completed_at or step.started_at or _utc_now(),
        source_sha256=source_sha256,
        result_sha256=result_sha256,
        engine=step.engine,
        processing_preset_id=step.processing_preset_id,
        processing_preset_label=step.processing_preset_label,
        speaker_id=speaker_id,
        speaker_label=speaker_label,
    )


def _resolved_workflow_step_from_job_step(
    step: SampleProcessingJobStep,
    operation: SampleProcessingOperation,
) -> ResolvedSampleProcessingWorkflowStep:
    return ResolvedSampleProcessingWorkflowStep(
        operation=operation,
        processing_preset_id=step.processing_preset_id,
        processing_preset_label=step.processing_preset_label,
    )


def _speaker_steps_from_result(
    step: SampleProcessingJobStep,
    result: SpeakerSeparationResult,
    *,
    source_sha256: str,
    prior_steps: tuple[VoiceProcessingStep, ...],
) -> dict[str, tuple[VoiceProcessingStep, ...]]:
    steps_by_speaker_id: dict[str, tuple[VoiceProcessingStep, ...]] = {}
    for speaker in result.speakers:
        if speaker.result is None:
            continue
        speaker_step = _voice_step_from_job_step(
            step,
            source_sha256=source_sha256,
            result_sha256=speaker.result.sha256,
            speaker_id=speaker.id,
            speaker_label=speaker.label,
        )
        steps_by_speaker_id[speaker.id] = (*prior_steps, speaker_step)
    return steps_by_speaker_id


def _aggregate_speaker_result_sha256(result: SpeakerSeparationResult) -> str | None:
    hashes = [speaker.result.sha256 for speaker in result.speakers if speaker.result is not None]
    if not hashes:
        return None
    return sample_hash("|".join(hashes).encode("utf-8"))


def _successful_job_step(
    job: SampleProcessingJob,
    operation_id: SampleProcessingOperationId,
) -> SampleProcessingJobStep | None:
    for step in reversed(job.steps):
        if step.operation_id == operation_id and step.status == "success":
            return step
    return None


def _speaker_processing_step_index(
    steps: tuple[VoiceProcessingStep, ...],
    *,
    operation_id: SampleProcessingOperationId | None,
) -> int | None:
    if not steps:
        return None
    if operation_id is None:
        return len(steps) - 1
    for index in range(len(steps) - 1, -1, -1):
        if steps[index].operation_id == operation_id:
            return index
    return None


def _current_source_sha256(result: SpeakerSeparationResult | None, sample: VoiceSample) -> str:
    if result is None:
        return sample.sha256
    return _aggregate_speaker_result_sha256(result) or sample.sha256


def _normalize_source_preference(value: str | None) -> SampleProcessingSourcePreference:
    normalized = (value or "original").strip()
    if normalized in {"original", "active"}:
        return "active" if normalized == "active" else "original"
    raise SampleProcessingServiceError("Source preference must be original or active.", 422)


def _normalize_processing_preset(
    value: str | None,
    operation: SampleProcessingOperation,
) -> tuple[SampleProcessingPresetId | None, str | None]:
    raw_value = (value or "").strip()
    if not operation.processing_presets:
        if raw_value:
            raise SampleProcessingServiceError("Processing preset is not supported for this operation.", 422)
        return None, None

    resolved_value = raw_value or operation.default_processing_preset_id
    if resolved_value is None:
        resolved_value = operation.processing_presets[0].id
    for preset in operation.processing_presets:
        if preset.id == resolved_value:
            return preset.id, preset.label
    raise SampleProcessingServiceError(f"Unsupported processing preset: {raw_value}.", 422)


def _require_relative_path(path: Path, parent: Path) -> None:
    try:
        path.relative_to(parent.resolve())
    except ValueError as exc:
        raise SampleProcessingServiceError("Sample processing path is invalid.", 500) from exc


def _require_allowed_source_path(path: Path, processing_dir: Path, assets_dir: Path) -> None:
    for parent in (processing_dir, assets_dir):
        try:
            path.relative_to(parent.resolve())
            return
        except ValueError:
            continue
    raise SampleProcessingServiceError("Sample processing source path is invalid.", 500)


def _speaker_by_id(result: SpeakerSeparationResult, speaker_id: str) -> SpeakerSeparationSpeaker:
    for speaker in result.speakers:
        if speaker.id == speaker_id:
            return speaker
    raise SampleProcessingServiceError("Speaker was not found.", 404)


def _validate_speaker_assignments(
    result: SpeakerSeparationResult,
    speaker_names: tuple[SpeakerNameAssignment, ...],
    transcript_assignments: tuple[SpeakerTranscriptAssignment, ...],
) -> None:
    speaker_ids = {speaker.id for speaker in result.speakers}
    transcript_item_ids = {item.id for item in result.transcript.items}
    seen_name_speakers: set[str] = set()
    for assignment in speaker_names:
        if assignment.speaker_id not in speaker_ids:
            raise SampleProcessingServiceError("Speaker was not found.", 404)
        if assignment.speaker_id in seen_name_speakers:
            raise SampleProcessingServiceError("Speaker name can only be assigned once.", 422)
        seen_name_speakers.add(assignment.speaker_id)
        if assignment.name is not None and not assignment.name.strip():
            raise SampleProcessingServiceError("Speaker name is required.", 422)
    seen_items: set[str] = set()
    for assignment in transcript_assignments:
        if assignment.item_id not in transcript_item_ids:
            raise SampleProcessingServiceError("Transcript item was not found.", 404)
        if assignment.speaker_id not in speaker_ids:
            raise SampleProcessingServiceError("Speaker was not found.", 404)
        if assignment.item_id in seen_items:
            raise SampleProcessingServiceError("Transcript item can only be assigned once.", 422)
        seen_items.add(assignment.item_id)


def apply_speaker_assignment_metadata(
    result: SpeakerSeparationResult,
    *,
    speaker_names: tuple[SpeakerNameAssignment, ...] = (),
    transcript_assignments: tuple[SpeakerTranscriptAssignment, ...] = (),
) -> SpeakerSeparationResult:
    names_by_speaker_id = {assignment.speaker_id: assignment.name for assignment in speaker_names}
    speaker_by_item_id = {assignment.item_id: assignment.speaker_id for assignment in transcript_assignments}
    updated_items = tuple(
        replace(item, speaker_id=speaker_by_item_id.get(item.id, item.speaker_id))
        for item in result.transcript.items
    )
    item_ids_by_speaker_id: dict[str, list[str]] = {speaker.id: [] for speaker in result.speakers}
    for item in updated_items:
        item_ids_by_speaker_id[item.speaker_id].append(item.id)
    updated_speakers: list[SpeakerSeparationSpeaker] = []
    for speaker in result.speakers:
        assigned_name = speaker.assigned_name
        if speaker.id in names_by_speaker_id:
            name = names_by_speaker_id[speaker.id]
            assigned_name = name.strip() if name is not None else None
        updated_speakers.append(
            replace(
                speaker,
                assigned_name=assigned_name,
                transcript_item_ids=tuple(item_ids_by_speaker_id[speaker.id]),
            )
        )
    return SpeakerSeparationResult(
        kind="speakerSeparation",
        speakers=tuple(updated_speakers),
        transcript=SpeakerSeparationTranscript(items=updated_items),
    )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
