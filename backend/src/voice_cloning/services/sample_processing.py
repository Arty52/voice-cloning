from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from datetime import UTC, datetime
import json
from pathlib import Path
import shutil
from typing import Protocol, cast
from uuid import uuid4

from fastapi import UploadFile

from ..config import Settings
from ..models import (
    PreparedSampleCandidate,
    PreparedSamplesResult,
    SampleProcessingDurationRange,
    SampleProcessingJob,
    SampleProcessingProgressPhase,
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
from ..samples import load_sample_file, sample_hash, save_sample_file, save_uploaded_sample_stream, slugify_voice_name
from .cancellation import cancel_and_drain_task
from ..voice_library import VoiceLibrary


RESULT_FILENAME = "result.wav"
RESULT_CONTENT_TYPE = "audio/wav"
PREPARED_SAMPLE_RATE_HZ = 16000
PREPARE_MAX_WINDOW_SECONDS = 120.0
PREPARE_MAX_CANDIDATES_PER_SPEAKER = 3
BYTES_PER_MEBIBYTE = 1024 * 1024
PREPARE_FINAL_TRIM_FILTER = (
    "silenceremove="
    "start_periods=1:start_duration=0.12:start_threshold=-45dB:start_silence=0.08:"
    "stop_periods=-1:stop_duration=0.5:stop_threshold=-45dB:stop_silence=0.15:"
    "detection=peak"
)
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
    SampleProcessingOperation(
        id="prepareVoice",
        label="Prepare Voice",
        description="Clean, rank, trim, and normalize provider-sized voice samples.",
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
    max_output_bytes: int | None = None


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


@dataclass(frozen=True)
class PreparedCandidateVoiceSelection:
    candidate_id: str
    name: str
    voice_preset_id: str | None = None


@dataclass(frozen=True)
class PrepareVoiceOptions:
    clean_voice: bool
    detect_speakers: bool
    trim_candidates: bool
    isolation_requested: bool
    speaker_detection_requested: bool


@dataclass(frozen=True)
class AudioProbe:
    duration_seconds: float | None = None
    sample_rate_hz: int | None = None


@dataclass(frozen=True)
class SpeechRegion:
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class CandidateWindow:
    start_seconds: float
    end_seconds: float
    speech_seconds: float
    score: float
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class PrepareSource:
    path: Path
    sample: VoiceSample
    speaker_id: str
    speaker_label: str


@dataclass(frozen=True)
class RankedPrepareSource:
    source: PrepareSource
    probe: AudioProbe
    regions: tuple[SpeechRegion, ...]
    windows: tuple[CandidateWindow, ...] = ()


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
        self._prepared_candidate_processing_steps: dict[str, dict[str, tuple[VoiceProcessingStep, ...]]] = {}

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        processor_operations = {operation.id: operation for operation in self.processor.operations()}
        operations: list[SampleProcessingOperation] = []
        for operation in BASE_OPERATIONS:
            if operation.id == "prepareVoice":
                operations.append(replace(operation, enabled=_command_available(self.settings.sample_processing_ffmpeg_command)))
                continue
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
        enabled_operations = {operation.id for operation in self.operations() if operation.enabled}
        if not enabled_operations:
            return None
        if enabled_operations == {"prepareVoice"}:
            return "ffmpeg"
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
        clean_voice: bool | None = None,
        detect_speakers: bool | None = None,
        trim_candidates: bool | None = None,
    ) -> SampleProcessingJob:
        resolved_source_preference = _normalize_source_preference(source_preference)
        if operation_id == "prepareVoice":
            if workflow_steps is not None:
                raise SampleProcessingServiceError("Prepare Voice cannot be used inside a manual processing stack.", 422)
            return await self._create_prepare_voice_job(
                source_preference=resolved_source_preference,
                source_voice_id=source_voice_id,
                source_upload=source_upload,
                clean_voice=clean_voice,
                detect_speakers=detect_speakers,
                trim_candidates=trim_candidates,
            )
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

            source_size_bytes = _path_size_bytes(source_path)
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
                source_size_bytes=source_size_bytes,
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
            self._prepared_candidate_processing_steps.pop(job_id, None)
            if job_dir_created:
                shutil.rmtree(job_dir, ignore_errors=True)
            raise

    async def _create_prepare_voice_job(
        self,
        *,
        source_preference: SampleProcessingSourcePreference,
        source_voice_id: str | None,
        source_upload: UploadFile | None,
        clean_voice: bool | None,
        detect_speakers: bool | None,
        trim_candidates: bool | None,
    ) -> SampleProcessingJob:
        prepare_operation = self._enabled_operation("prepareVoice")
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
                    source_preference,
                )
                job_dir.mkdir(parents=True, exist_ok=False)
                job_dir_created = True

            source_size_bytes = _path_size_bytes(source_path)
            options = self._prepare_voice_options(
                clean_voice=clean_voice,
                detect_speakers=detect_speakers,
                trim_candidates=trim_candidates,
            )
            now = _utc_now()
            step = SampleProcessingJobStep(
                id=f"{job_id}-prepare",
                operation_id="prepareVoice",
                operation_label=prepare_operation.label,
                status="pending",
                engine=self._prepare_voice_engine(options),
            )
            job = SampleProcessingJob(
                id=job_id,
                operation_id="prepareVoice",
                status="pending",
                source_name=source_name,
                source_filename=source_sample.filename,
                source_content_type=source_sample.content_type,
                source_sha256=source_sample.sha256,
                source_size_bytes=source_size_bytes,
                source_preference=source_preference,
                created_at=now,
                updated_at=now,
                engine=step.engine,
                workflow_mode="single",
                steps=(step,),
                estimated_duration_range_seconds=_estimate_prepare_voice_duration(source_size_bytes, options),
                progress_phases=_initial_prepare_voice_progress_phases(job_id, options),
            )
            self._jobs[job_id] = job
            self._source_paths[job_id] = source_path
            self._tasks[job_id] = asyncio.create_task(
                self._run_prepare_voice_job(
                    job_id=job_id,
                    job_dir=job_dir,
                    source_path=source_path,
                    source_sample=source_sample,
                    options=options,
                )
            )
            return job
        except Exception:
            self._jobs.pop(job_id, None)
            self._tasks.pop(job_id, None)
            self._source_paths.pop(job_id, None)
            self._prepared_candidate_processing_steps.pop(job_id, None)
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
            if isinstance(job.result, PreparedSamplesResult):
                raise SampleProcessingServiceError(
                    "Prepared sample jobs expose per-candidate audio results.",
                    409,
                )
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

    def candidate_result_path(self, job_id: str, candidate_id: str) -> Path:
        job = self.get_job(job_id)
        result = self._prepared_samples_result(job)
        candidate = _prepared_candidate_by_id(result, candidate_id)
        return self._result_path(candidate.result)

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

    def save_candidate_results_as_voices(
        self,
        job_id: str,
        *,
        voices: tuple[PreparedCandidateVoiceSelection, ...],
    ) -> tuple[VoiceAsset, ...]:
        job = self.get_job(job_id)
        result = self._prepared_samples_result(job)
        normalized = self._validate_prepared_candidate_voice_selections(result, voices)
        candidate_steps = self._prepared_candidate_processing_steps.get(job_id, {})
        prepared: list[tuple[PreparedCandidateVoiceSelection, VoiceSample, tuple[VoiceProcessingStep, ...]]] = []
        for selection, candidate in normalized:
            result_path = self._result_path(candidate.result)
            sample = load_sample_file(result_path, candidate.result.content_type)
            steps = candidate_steps.get(candidate.candidate_id) or (
                VoiceProcessingStep(
                    id=job.id,
                    label="Prepare Voice",
                    operation_id="prepareVoice",
                    created_at=_utc_now(),
                    source_sha256=job.source_sha256,
                    result_sha256=sample.sha256,
                    engine=job.engine,
                    speaker_id=candidate.speaker_id,
                    speaker_label=candidate.speaker_label,
                ),
            )
            prepared.append((selection, sample, steps))

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

    async def _run_prepare_voice_job(
        self,
        *,
        job_id: str,
        job_dir: Path,
        source_path: Path,
        source_sample: VoiceSample,
        options: PrepareVoiceOptions,
    ) -> None:
        step = self.get_job(job_id).steps[0]
        warnings: list[str] = []
        current_path = source_path
        current_sample = source_sample
        try:
            self._update_job(job_id, status="running")
            self._start_step(job_id, step.id, source_sha256=source_sample.sha256)

            if options.clean_voice:
                clean_phase_id = _prepare_voice_phase_id(job_id, "clean-voice")
                self._start_progress_phase(job_id, clean_phase_id)
                isolate_operation = self._enabled_operation("isolateVoice")
                isolated_path = job_dir / "prepare-isolated.wav"
                isolate_request = SampleProcessingRequest(
                    job_id=job_id,
                    operation_id="isolateVoice",
                    source_path=current_path,
                    output_path=isolated_path,
                    job_dir=job_dir,
                    source=current_sample,
                    processing_preset_id=isolate_operation.default_processing_preset_id,
                    processing_preset_label=_processing_preset_label(
                        isolate_operation.default_processing_preset_id,
                        isolate_operation,
                    ),
                    max_output_bytes=self.settings.max_source_upload_bytes,
                )
                isolated_result = await self.processor.process(isolate_request)
                if isolated_result is not None:
                    raise SampleProcessingServiceError("Isolate Voice returned an unsupported result.", 500)
                current_sample = load_sample_file(isolated_path, RESULT_CONTENT_TYPE)
                current_path = isolated_path
                self._finish_progress_phase(job_id, clean_phase_id)
            elif options.isolation_requested:
                warnings.append("Voice isolation is unavailable; ranking used the original source audio.")

            prepare_sources = await self._prepare_sources_for_ranking(
                job_id=job_id,
                job_dir=job_dir,
                source_path=current_path,
                source_sample=current_sample,
                options=options,
                warnings=warnings,
            )

            detect_speech_phase_id = _prepare_voice_phase_id(job_id, "detect-speech")
            ranked_sources: list[RankedPrepareSource] = []
            self._start_progress_phase(job_id, detect_speech_phase_id, detail=_prepare_sources_detail(prepare_sources))
            for prepare_source in prepare_sources:
                self._update_progress_phase_detail(job_id, detect_speech_phase_id, prepare_source.speaker_label)
                probe, probe_warnings = await _probe_audio(prepare_source.path, self.settings)
                warnings.extend(probe_warnings)
                regions, silence_warnings = await _detect_nonsilent_regions(
                    prepare_source.path,
                    probe.duration_seconds,
                    self.settings,
                )
                warnings.extend(silence_warnings)
                ranked_sources.append(
                    RankedPrepareSource(
                        source=prepare_source,
                        probe=probe,
                        regions=regions,
                    )
                )
            self._finish_progress_phase(job_id, detect_speech_phase_id, detail=_prepare_sources_detail(prepare_sources))

            rank_phase_id = _prepare_voice_phase_id(job_id, "rank-candidates")
            ranked_with_windows: list[RankedPrepareSource] = []
            self._start_progress_phase(job_id, rank_phase_id, detail=_prepare_sources_detail(prepare_sources))
            for ranked_source in ranked_sources:
                self._update_progress_phase_detail(job_id, rank_phase_id, ranked_source.source.speaker_label)
                windows = _rank_candidate_windows(ranked_source.regions, ranked_source.probe.duration_seconds)
                ranked_with_windows.append(replace(ranked_source, windows=windows))
            self._finish_progress_phase(job_id, rank_phase_id, detail=_prepare_sources_detail(prepare_sources))

            trim_phase_id = _prepare_voice_phase_id(job_id, "trim-normalize-candidates")
            candidates: list[PreparedSampleCandidate] = []
            candidate_steps: dict[str, tuple[VoiceProcessingStep, ...]] = {}
            self._start_progress_phase(job_id, trim_phase_id, detail=_prepare_sources_detail(prepare_sources))
            for ranked_source in ranked_with_windows:
                self._update_progress_phase_detail(job_id, trim_phase_id, ranked_source.source.speaker_label)
                source_candidates = await self._write_prepare_candidates(
                    job_id=job_id,
                    job_dir=job_dir,
                    source=ranked_source.source,
                    windows=ranked_source.windows,
                    options=options,
                )
                for candidate in source_candidates:
                    candidates.append(candidate)
                    candidate_steps[candidate.candidate_id] = (
                        VoiceProcessingStep(
                            id=job_id,
                            label="Prepare Voice",
                            operation_id="prepareVoice",
                            created_at=_utc_now(),
                            source_sha256=source_sample.sha256,
                            result_sha256=candidate.sha256,
                            engine=self._prepare_voice_engine(options),
                            speaker_id=candidate.speaker_id,
                            speaker_label=candidate.speaker_label,
                        ),
                    )
            self._finish_progress_phase(job_id, trim_phase_id, detail=_prepared_candidate_count_label(len(candidates)))

            if not candidates:
                raise SampleProcessingServiceError("Prepare Voice did not produce any candidates.", 422)
            complete_phase_id = _prepare_voice_phase_id(job_id, "complete")
            self._start_progress_phase(job_id, complete_phase_id, detail=_prepared_candidate_count_label(len(candidates)))
            self._finish_progress_phase(job_id, complete_phase_id, detail=_prepared_candidate_count_label(len(candidates)))
            result = PreparedSamplesResult(
                kind="preparedSamples",
                candidates=tuple(candidates),
                warnings=tuple(dict.fromkeys(warnings)),
            )
            self._prepared_candidate_processing_steps[job_id] = candidate_steps
            self._finish_step(job_id, step.id, result_sha256=_aggregate_prepared_candidate_sha256(result))
            self._update_job(job_id, status="success", result=result, active_step_id=None, active_progress_phase_id=None)
        except asyncio.CancelledError:
            self._cancel_job_state(job_id)
            raise
        except SampleProcessingServiceError as exc:
            self._fail_active_step(job_id, exc.detail)
            self._fail_active_progress_phase(job_id, exc.detail)
            self._update_job(job_id, status="error", error=exc.detail, active_step_id=None, active_progress_phase_id=None)
        except Exception:
            self._fail_active_step(job_id, "Prepare Voice failed.")
            self._fail_active_progress_phase(job_id, "Prepare Voice failed.")
            self._update_job(
                job_id,
                status="error",
                error="Prepare Voice failed.",
                active_step_id=None,
                active_progress_phase_id=None,
            )
        finally:
            self._tasks.pop(job_id, None)

    async def _prepare_sources_for_ranking(
        self,
        *,
        job_id: str,
        job_dir: Path,
        source_path: Path,
        source_sample: VoiceSample,
        options: PrepareVoiceOptions,
        warnings: list[str],
    ) -> tuple[PrepareSource, ...]:
        if options.detect_speakers:
            phase_id = _prepare_voice_phase_id(job_id, "detect-speakers")
            self._start_progress_phase(job_id, phase_id)
            speaker_operation = self._enabled_operation("separateSpeakers")
            speaker_request = SampleProcessingRequest(
                job_id=job_id,
                operation_id="separateSpeakers",
                source_path=source_path,
                output_path=job_dir / "prepare-speakers.wav",
                job_dir=job_dir,
                source=source_sample,
                processing_preset_id=speaker_operation.default_processing_preset_id,
                processing_preset_label=_processing_preset_label(
                    speaker_operation.default_processing_preset_id,
                    speaker_operation,
                ),
                max_output_bytes=self.settings.max_source_upload_bytes,
            )
            try:
                speaker_result = await self.processor.process(speaker_request)
            except SampleProcessingServiceError as exc:
                if exc.detail != "Speaker diarization did not detect any speakers.":
                    raise
                warnings.append("Speaker diarization did not detect any speakers; returned single-speaker candidates.")
                self._finish_progress_phase(job_id, phase_id, detail="Single Speaker")
            else:
                if not isinstance(speaker_result, SpeakerSeparationResult):
                    raise SampleProcessingServiceError("Speaker Separation returned an unsupported result.", 500)
                if not speaker_result.speakers:
                    warnings.append("Speaker diarization did not detect any speakers; returned single-speaker candidates.")
                    self._finish_progress_phase(job_id, phase_id, detail="Single Speaker")
                else:
                    self._validate_speaker_separation_result(speaker_result)
                    sources: list[PrepareSource] = []
                    for speaker in speaker_result.speakers:
                        if speaker.result is None:
                            continue
                        speaker_path = self._result_path(speaker.result)
                        speaker_sample = load_sample_file(speaker_path, speaker.result.content_type)
                        sources.append(
                            PrepareSource(
                                path=speaker_path,
                                sample=speaker_sample,
                                speaker_id=speaker.id,
                                speaker_label=speaker.assigned_name or speaker.label,
                            )
                        )
                    if sources:
                        self._finish_progress_phase(job_id, phase_id, detail=_prepare_sources_detail(tuple(sources)))
                        return tuple(sources)
                    warnings.append("Speaker detection did not produce speaker audio; returned single-speaker candidates.")
                    self._finish_progress_phase(job_id, phase_id, detail="Single Speaker")
        elif options.speaker_detection_requested:
            warnings.append("Speaker detection is unavailable; returned single-speaker candidates.")

        return (
            PrepareSource(
                path=source_path,
                sample=source_sample,
                speaker_id="speaker-1",
                speaker_label="Speaker 1",
            ),
        )

    async def _write_prepare_candidates(
        self,
        *,
        job_id: str,
        job_dir: Path,
        source: PrepareSource,
        windows: tuple[CandidateWindow, ...],
        options: PrepareVoiceOptions,
    ) -> tuple[PreparedSampleCandidate, ...]:
        candidates: list[PreparedSampleCandidate] = []
        for rank, window in enumerate(windows[:PREPARE_MAX_CANDIDATES_PER_SPEAKER], start=1):
            candidate_id = f"{source.speaker_id}-candidate-{rank}"
            output_path = job_dir / f"{candidate_id}.wav"
            await _write_prepared_candidate_audio(
                source.path,
                output_path,
                window,
                self.settings,
                trim_candidates=options.trim_candidates,
            )
            sample = load_sample_file(output_path, RESULT_CONTENT_TYPE)
            candidates.append(
                PreparedSampleCandidate(
                    candidate_id=candidate_id,
                    rank=rank,
                    score=window.score,
                    speaker_id=source.speaker_id,
                    speaker_label=source.speaker_label,
                    source_start_seconds=window.start_seconds,
                    source_end_seconds=window.end_seconds,
                    duration_seconds=max(0.0, window.end_seconds - window.start_seconds),
                    sample_rate_hz=PREPARED_SAMPLE_RATE_HZ,
                    content_type=sample.content_type,
                    sha256=sample.sha256,
                    warnings=window.warnings,
                    result=SampleProcessingResult(
                        path=output_path.relative_to(self.processing_dir).as_posix(),
                        filename=output_path.name,
                        content_type=sample.content_type,
                        sha256=sample.sha256,
                    ),
                )
            )
        return tuple(candidates)

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

    def _start_progress_phase(self, job_id: str, phase_id: str, *, detail: str | None = None) -> None:
        now = _utc_now()
        self._update_progress_phase(
            job_id,
            phase_id,
            status="running",
            started_at=now,
            completed_at=None,
            error=None,
            detail=detail,
        )
        self._update_job(job_id, active_progress_phase_id=phase_id)

    def _update_progress_phase_detail(self, job_id: str, phase_id: str, detail: str | None) -> None:
        self._update_progress_phase(job_id, phase_id, detail=detail)

    def _finish_progress_phase(self, job_id: str, phase_id: str, *, detail: str | None = None) -> None:
        phase = _progress_phase_by_id(self.get_job(job_id), phase_id)
        self._update_progress_phase(
            job_id,
            phase_id,
            status="success",
            started_at=phase.started_at or _utc_now(),
            completed_at=_utc_now(),
            error=None,
            detail=detail,
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

    def _fail_active_progress_phase(self, job_id: str, error: str) -> None:
        job = self.get_job(job_id)
        if job.active_progress_phase_id is None:
            return
        self._update_progress_phase(
            job_id,
            job.active_progress_phase_id,
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
        self._cancel_progress_phases(job_id)
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

    def _update_progress_phase(self, job_id: str, phase_id: str, **changes: object) -> None:
        job = self.get_job(job_id)
        phases = tuple(replace(phase, **changes) if phase.id == phase_id else phase for phase in job.progress_phases)
        self._update_job(job_id, progress_phases=phases)

    def _cancel_progress_phases(self, job_id: str) -> None:
        job = self.get_job(job_id)
        if not job.progress_phases:
            return
        now = _utc_now()
        phases = tuple(
            replace(
                phase,
                status="canceled",
                completed_at=phase.completed_at or now,
                error=phase.error or "Sample processing was canceled.",
            )
            if phase.status in {"pending", "running"}
            else phase
            for phase in job.progress_phases
        )
        self._update_job(job_id, progress_phases=phases, active_progress_phase_id=None)

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

    def _operation_enabled(self, operation_id: SampleProcessingOperationId) -> bool:
        return any(operation.id == operation_id and operation.enabled for operation in self.operations())

    def _prepare_voice_options(
        self,
        *,
        clean_voice: bool | None,
        detect_speakers: bool | None,
        trim_candidates: bool | None,
    ) -> PrepareVoiceOptions:
        isolation_available = self._operation_enabled("isolateVoice")
        speaker_detection_available = self._operation_enabled("separateSpeakers")
        isolation_requested = isolation_available if clean_voice is None else clean_voice
        speaker_detection_requested = speaker_detection_available if detect_speakers is None else detect_speakers
        return PrepareVoiceOptions(
            clean_voice=isolation_requested and isolation_available,
            detect_speakers=speaker_detection_requested and speaker_detection_available,
            trim_candidates=True if trim_candidates is None else trim_candidates,
            isolation_requested=isolation_requested,
            speaker_detection_requested=speaker_detection_requested,
        )

    def _prepare_voice_engine(self, options: PrepareVoiceOptions) -> str:
        engines = ["ffmpeg"]
        if options.clean_voice:
            engines.insert(0, self.processor.engine_name_for_operation("isolateVoice"))
        if options.detect_speakers:
            engines.insert(-1, self.processor.engine_name_for_operation("separateSpeakers"))
        return "+".join(dict.fromkeys(engines))

    def _operation_label(self, operation_id: SampleProcessingOperationId) -> str:
        for operation in self.operations():
            if operation.id == operation_id:
                return operation.label
        return operation_id

    def _prepared_samples_result(self, job: SampleProcessingJob) -> PreparedSamplesResult:
        if job.status != "success" or job.result is None:
            raise SampleProcessingServiceError("Prepared sample candidates are not ready.", 409)
        if not isinstance(job.result, PreparedSamplesResult):
            raise SampleProcessingServiceError("Sample processing job is not a prepared samples result.", 409)
        return job.result

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

    def _validate_prepared_candidate_voice_selections(
        self,
        result: PreparedSamplesResult,
        voices: tuple[PreparedCandidateVoiceSelection, ...],
    ) -> tuple[tuple[PreparedCandidateVoiceSelection, PreparedSampleCandidate], ...]:
        if not voices:
            raise SampleProcessingServiceError("Choose at least one candidate to save.", 422)
        existing_assets = self.voice_library.list_assets()
        existing_ids = {asset.id for asset in existing_assets}
        existing_names = {slugify_voice_name(asset.name) for asset in existing_assets}
        seen_candidate_ids: set[str] = set()
        seen_names: set[str] = set()
        normalized: list[tuple[PreparedCandidateVoiceSelection, PreparedSampleCandidate]] = []
        for selection in voices:
            if selection.candidate_id in seen_candidate_ids:
                raise SampleProcessingServiceError("Candidate can only be selected once.", 422)
            seen_candidate_ids.add(selection.candidate_id)
            candidate = _prepared_candidate_by_id(result, selection.candidate_id)
            display_name = selection.name.strip()
            if not display_name:
                raise SampleProcessingServiceError("Voice name is required.", 422)
            normalized_name = slugify_voice_name(display_name)
            if normalized_name in seen_names:
                raise SampleProcessingServiceError("Prepared voice names must be unique.", 409)
            if normalized_name in existing_ids or normalized_name in existing_names:
                raise SampleProcessingServiceError("A voice with that name already exists.", 409)
            if selection.voice_preset_id not in (None, "", *VOICE_PRESET_IDS):
                raise SampleProcessingServiceError("Voice preset must be standardNarration or animatedDialogue.", 422)
            seen_names.add(normalized_name)
            normalized.append(
                (
                    PreparedCandidateVoiceSelection(
                        candidate_id=selection.candidate_id,
                        name=display_name,
                        voice_preset_id=selection.voice_preset_id,
                    ),
                    candidate,
                )
            )
        return tuple(normalized)

    async def _source_from_upload(
        self,
        job_dir: Path,
        upload: UploadFile,
    ) -> tuple[Path, VoiceSample, str]:
        source_path = job_dir / f"source{Path(upload.filename or '').suffix.lower() or '.wav'}"
        source_file = await save_uploaded_sample_stream(
            upload,
            source_path,
            self.settings,
            max_bytes=self.settings.max_source_upload_bytes,
        )
        source_sample = VoiceSample(
            content=b"",
            filename=source_file.filename,
            content_type=source_file.content_type,
            sha256=source_file.sha256,
        )
        source_name = Path(source_sample.filename).stem or "Uploaded Source"
        return source_path, source_sample, source_name

    def _source_from_voice(
        self,
        voice_id: str,
        source_preference: SampleProcessingSourcePreference,
    ) -> tuple[Path, VoiceSample, str]:
        if not voice_id:
            raise SampleProcessingServiceError("Source voice is required.", 422)
        asset = self.voice_library.get_asset(voice_id)
        source_path, uses_retained_source = self._voice_source_path(asset, source_preference)
        content_type = asset.source_content_type if uses_retained_source else asset.content_type
        if uses_retained_source and asset.source_sha256:
            sample = VoiceSample(
                content=b"",
                filename=source_path.name,
                content_type=content_type or asset.content_type,
                sha256=asset.source_sha256,
            )
        else:
            sample = load_sample_file(source_path, content_type or asset.content_type)
        return source_path, sample, asset.name

    def _voice_source_path(
        self,
        asset: VoiceAsset,
        source_preference: SampleProcessingSourcePreference,
    ) -> tuple[Path, bool]:
        if source_preference == "original" and asset.source_file_path:
            source_path = (self.voice_library.assets_dir / asset.source_file_path).resolve()
            _require_relative_path(source_path, self.voice_library.assets_dir)
            if source_path.exists():
                return source_path, True
        return self.voice_library.resolve_asset_path(asset), False

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


def _initial_prepare_voice_progress_phases(
    job_id: str,
    options: PrepareVoiceOptions,
) -> tuple[SampleProcessingProgressPhase, ...]:
    phases: list[tuple[str, str]] = []
    if options.clean_voice:
        phases.append(("clean-voice", "Clean Voice"))
    if options.detect_speakers:
        phases.append(("detect-speakers", "Detect Speakers"))
    phases.extend(
        (
            ("detect-speech", "Detect Speech Regions"),
            ("rank-candidates", "Rank Candidate Windows"),
            ("trim-normalize-candidates", "Trim And Normalize Candidates"),
            ("complete", "Complete"),
        )
    )
    return tuple(
        SampleProcessingProgressPhase(
            id=_prepare_voice_phase_id(job_id, phase_id),
            label=label,
            status="pending",
        )
        for phase_id, label in phases
    )


def _prepare_voice_phase_id(job_id: str, phase_id: str) -> str:
    return f"{job_id}-phase-{phase_id}"


def _progress_phase_by_id(job: SampleProcessingJob, phase_id: str) -> SampleProcessingProgressPhase:
    for phase in job.progress_phases:
        if phase.id == phase_id:
            return phase
    raise SampleProcessingServiceError("Sample processing progress phase was not found.", 500)


def _prepare_sources_detail(sources: tuple[PrepareSource, ...]) -> str:
    if len(sources) == 1:
        return sources[0].speaker_label
    return f"{len(sources)} Speakers"


def _prepared_candidate_count_label(candidate_count: int) -> str:
    return f"{candidate_count} Candidate{'s' if candidate_count != 1 else ''}"


def _estimate_prepare_voice_duration(
    source_size_bytes: int | None,
    options: PrepareVoiceOptions,
) -> SampleProcessingDurationRange:
    source_mib = max(0.1, (source_size_bytes or BYTES_PER_MEBIBYTE) / BYTES_PER_MEBIBYTE)
    min_seconds = 10 + source_mib * 0.08
    max_seconds = 25 + source_mib * 0.18

    if options.clean_voice:
        min_seconds += 20 + source_mib * 0.18
        max_seconds += 60 + source_mib * 0.35
    if options.detect_speakers:
        min_seconds += 30 + source_mib * 0.18
        max_seconds += 90 + source_mib * 0.45
    if options.trim_candidates:
        min_seconds += 15 + source_mib * 0.08
        max_seconds += 45 + source_mib * 0.18

    rounded_min = max(10, round(min_seconds))
    rounded_max = max(rounded_min + 30, round(max_seconds))
    return SampleProcessingDurationRange(
        min_seconds=rounded_min,
        max_seconds=rounded_max,
    )


def _path_size_bytes(path: Path) -> int | None:
    try:
        return path.stat().st_size
    except OSError:
        return None


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


def _processing_preset_label(
    value: SampleProcessingPresetId | None,
    operation: SampleProcessingOperation,
) -> str | None:
    if value is None:
        return None
    for preset in operation.processing_presets:
        if preset.id == value:
            return preset.label
    return None


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


def _command_available(command: str) -> bool:
    command_path = Path(command)
    if command_path.is_absolute() or command_path.parent != Path("."):
        return command_path.exists()
    return shutil.which(command) is not None


async def _probe_audio(path: Path, settings: Settings) -> tuple[AudioProbe, tuple[str, ...]]:
    try:
        stdout, _ = await _run_capture_command(
            [
                settings.sample_processing_ffprobe_command,
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "format=duration:stream=sample_rate",
                "-of",
                "json",
                str(path),
            ],
            "ffprobe",
            settings.sample_processing_timeout_seconds,
        )
        payload = json.loads(stdout.decode("utf-8"))
    except (SampleProcessingServiceError, json.JSONDecodeError):
        return AudioProbe(), ("FFprobe metadata was unavailable; ranking used fallback duration metadata.",)

    duration_seconds = _positive_float_from_payload(payload.get("format", {}), "duration")
    sample_rate_hz: int | None = None
    streams = payload.get("streams")
    if isinstance(streams, list) and streams:
        sample_rate = _positive_float_from_payload(streams[0], "sample_rate")
        sample_rate_hz = int(sample_rate) if sample_rate is not None else None
    return AudioProbe(duration_seconds=duration_seconds, sample_rate_hz=sample_rate_hz), ()


async def _detect_nonsilent_regions(
    path: Path,
    duration_seconds: float | None,
    settings: Settings,
) -> tuple[tuple[SpeechRegion, ...], tuple[str, ...]]:
    try:
        _, stderr = await _run_capture_command(
            [
                settings.sample_processing_ffmpeg_command,
                "-hide_banner",
                "-nostats",
                "-i",
                str(path),
                "-af",
                "silencedetect=noise=-45dB:d=0.35",
                "-f",
                "null",
                "-",
            ],
            "ffmpeg",
            settings.sample_processing_timeout_seconds,
        )
    except SampleProcessingServiceError:
        return _fallback_speech_regions(duration_seconds), (
            "Nonsilent speech detection was unavailable; ranking used the full source window.",
        )

    parsed = _speech_regions_from_silencedetect(stderr.decode("utf-8", errors="replace"), duration_seconds)
    if parsed:
        return parsed, ()
    return _fallback_speech_regions(duration_seconds), (
        "Nonsilent speech detection did not find speech regions; ranking used the full source window.",
    )


def _speech_regions_from_silencedetect(
    log_output: str,
    duration_seconds: float | None,
) -> tuple[SpeechRegion, ...]:
    regions: list[SpeechRegion] = []
    cursor = 0.0
    last_observed = duration_seconds or 0.0
    in_silence = False
    for line in log_output.splitlines():
        if "silence_start:" in line:
            silence_start = _float_after_marker(line, "silence_start:")
            if silence_start is None:
                continue
            last_observed = max(last_observed, silence_start)
            if silence_start > cursor:
                regions.append(SpeechRegion(cursor, silence_start))
            cursor = max(cursor, silence_start)
            in_silence = True
        elif "silence_end:" in line:
            silence_end = _float_after_marker(line, "silence_end:")
            if silence_end is None:
                continue
            last_observed = max(last_observed, silence_end)
            cursor = max(cursor, silence_end)
            in_silence = False
    final_end = duration_seconds or last_observed
    if not in_silence and final_end > cursor:
        regions.append(SpeechRegion(cursor, final_end))
    return tuple(region for region in regions if region.end_seconds - region.start_seconds >= 0.25)


def _fallback_speech_regions(duration_seconds: float | None) -> tuple[SpeechRegion, ...]:
    if duration_seconds is None:
        fallback_duration = PREPARE_MAX_WINDOW_SECONDS
    else:
        fallback_duration = max(0.0, min(duration_seconds, PREPARE_MAX_WINDOW_SECONDS))
    return (SpeechRegion(0.0, fallback_duration),)


def _rank_candidate_windows(
    regions: tuple[SpeechRegion, ...],
    duration_seconds: float | None,
) -> tuple[CandidateWindow, ...]:
    if not regions:
        regions = _fallback_speech_regions(duration_seconds)
    candidates: dict[tuple[float, float], CandidateWindow] = {}
    sorted_regions = tuple(sorted(regions, key=lambda region: (region.start_seconds, region.end_seconds)))
    source_end = duration_seconds or max(region.end_seconds for region in sorted_regions)
    for index, region in enumerate(sorted_regions):
        for window_start in _candidate_window_starts(region, source_end):
            window_end = min(source_end, window_start + PREPARE_MAX_WINDOW_SECONDS)
            if duration_seconds is not None:
                window_end = min(window_end, duration_seconds)
            speech_seconds = _speech_overlap_seconds(sorted_regions, window_start, window_end)
            candidate = _candidate_window(window_start, window_end, speech_seconds)
            candidates[(round(candidate.start_seconds, 3), round(candidate.end_seconds, 3))] = candidate

        merged_start = max(0.0, sorted_regions[0].start_seconds if index == 0 else region.start_seconds)
        merged_end = min(source_end, merged_start + PREPARE_MAX_WINDOW_SECONDS)
        if duration_seconds is not None:
            merged_end = min(merged_end, duration_seconds)
        merged_speech = _speech_overlap_seconds(sorted_regions, merged_start, merged_end)
        merged = _candidate_window(merged_start, merged_end, merged_speech)
        candidates[(round(merged.start_seconds, 3), round(merged.end_seconds, 3))] = merged

    return tuple(
        sorted(
            candidates.values(),
            key=lambda window: (
                -window.score,
                -(window.end_seconds - window.start_seconds),
                window.start_seconds,
            ),
        )
    )


def _candidate_window_starts(region: SpeechRegion, source_end: float) -> tuple[float, ...]:
    start = max(0.0, region.start_seconds)
    region_end = min(source_end, max(region.end_seconds, start + 1.0))
    latest_full_start = max(start, region_end - PREPARE_MAX_WINDOW_SECONDS)
    starts: list[float] = []
    cursor = start
    while cursor <= latest_full_start:
        starts.append(cursor)
        cursor += PREPARE_MAX_WINDOW_SECONDS
    if not starts or abs(starts[-1] - latest_full_start) > 0.001:
        starts.append(latest_full_start)
    return tuple(starts)


def _candidate_window(start_seconds: float, end_seconds: float, speech_seconds: float) -> CandidateWindow:
    duration_seconds = max(0.01, end_seconds - start_seconds)
    speech_density = max(0.0, min(1.0, speech_seconds / duration_seconds))
    duration_fit = max(0.0, min(1.0, duration_seconds / PREPARE_MAX_WINDOW_SECONDS))
    continuity = 1.0 if speech_density >= 0.8 else max(0.2, speech_density)
    level_quality = 1.0
    clipping_quality = 1.0
    score = round(
        100.0
        * (
            0.42 * speech_density
            + 0.22 * duration_fit
            + 0.16 * continuity
            + 0.10 * level_quality
            + 0.10 * clipping_quality
        ),
        2,
    )
    warnings: list[str] = []
    if duration_seconds < 15.0:
        warnings.append("Candidate is shorter than the recommended provider sample duration.")
    if speech_density < 0.4:
        warnings.append("Candidate contains a high amount of nonspeech audio.")
    return CandidateWindow(start_seconds, end_seconds, speech_seconds, score, tuple(warnings))


def _speech_overlap_seconds(regions: tuple[SpeechRegion, ...], start_seconds: float, end_seconds: float) -> float:
    total = 0.0
    for region in regions:
        total += max(0.0, min(end_seconds, region.end_seconds) - max(start_seconds, region.start_seconds))
    return total


async def _write_prepared_candidate_audio(
    source_path: Path,
    output_path: Path,
    window: CandidateWindow,
    settings: Settings,
    *,
    trim_candidates: bool,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    args = [
        settings.sample_processing_ffmpeg_command,
        "-y",
        "-ss",
        _seconds_arg(window.start_seconds),
        "-t",
        _seconds_arg(max(0.01, window.end_seconds - window.start_seconds)),
        "-i",
        str(source_path),
    ]
    if trim_candidates:
        args.extend(["-af", PREPARE_FINAL_TRIM_FILTER])
    args.extend(
        [
            "-ac",
            "1",
            "-ar",
            str(PREPARED_SAMPLE_RATE_HZ),
            "-vn",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            str(output_path),
        ]
    )
    await _run_capture_command(args, "ffmpeg", settings.sample_processing_timeout_seconds)
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise SampleProcessingServiceError("FFmpeg did not produce a prepared candidate sample.", 502)
    if output_path.stat().st_size > settings.max_upload_bytes:
        output_path.unlink(missing_ok=True)
        raise SampleProcessingServiceError(
            f"Prepared candidate sample must be {_bytes_label(settings.max_upload_bytes)} or smaller.",
            413,
        )


async def _run_capture_command(
    args: list[str],
    label: str,
    timeout_seconds: float,
) -> tuple[bytes, bytes]:
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise SampleProcessingServiceError(f"{label} command was not found.", 503) from exc

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except asyncio.CancelledError:
        _kill_process(process)
        await process.communicate()
        raise
    except TimeoutError as exc:
        _kill_process(process)
        await process.communicate()
        raise SampleProcessingServiceError(f"{label} timed out.", 504) from exc

    if process.returncode != 0:
        message = " ".join(stderr.decode("utf-8", errors="replace").split())[-500:]
        detail = f"{label} failed with exit code {process.returncode}."
        if message:
            detail = f"{detail} {message}"
        raise SampleProcessingServiceError(detail, 502)
    return stdout, stderr


def _kill_process(process: asyncio.subprocess.Process) -> None:
    try:
        process.kill()
    except ProcessLookupError:
        pass


def _prepared_candidate_by_id(result: PreparedSamplesResult, candidate_id: str) -> PreparedSampleCandidate:
    for candidate in result.candidates:
        if candidate.candidate_id == candidate_id:
            return candidate
    raise SampleProcessingServiceError("Prepared sample candidate was not found.", 404)


def _aggregate_prepared_candidate_sha256(result: PreparedSamplesResult) -> str | None:
    hashes = [candidate.sha256 for candidate in result.candidates]
    if not hashes:
        return None
    return sample_hash("|".join(hashes).encode("utf-8"))


def _positive_float_from_payload(payload: object, key: str) -> float | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get(key)
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return parsed


def _float_after_marker(line: str, marker: str) -> float | None:
    try:
        raw_value = line.split(marker, 1)[1].strip().split(" ", 1)[0]
        return float(raw_value)
    except (IndexError, ValueError):
        return None


def _seconds_arg(value: float) -> str:
    return f"{max(0.0, value):.3f}".rstrip("0").rstrip(".") or "0"


def _bytes_label(max_bytes: int) -> str:
    if max_bytes < 1024 * 1024:
        return f"{max_bytes} bytes"
    mebibytes = max_bytes / (1024 * 1024)
    if mebibytes.is_integer():
        return f"{int(mebibytes)} MB"
    return f"{mebibytes:.1f} MB"


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
