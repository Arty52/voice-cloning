from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
import shutil
from typing import Protocol
from uuid import uuid4

from fastapi import UploadFile

from ..config import Settings
from ..models import (
    SampleProcessingJob,
    SampleProcessingOperation,
    SampleProcessingOperationId,
    SampleProcessingPreset,
    SampleProcessingPresetId,
    SampleProcessingResult,
    SampleProcessingSourcePreference,
    VoiceAsset,
    VoiceProcessingStep,
    VoiceSample,
)
from ..samples import load_sample_file, load_uploaded_sample, save_sample_file
from ..voice_library import VoiceLibrary


RESULT_FILENAME = "result.wav"
RESULT_CONTENT_TYPE = "audio/wav"
DEFAULT_ISOLATION_PROCESSING_PRESET_ID: SampleProcessingPresetId = "balanced"

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


class SampleProcessor(Protocol):
    @property
    def engine_name(self) -> str: ...

    def operations(self) -> tuple[SampleProcessingOperation, ...]: ...

    async def process(self, request: SampleProcessingRequest) -> None: ...


class UnavailableSampleProcessor:
    @property
    def engine_name(self) -> str:
        return "unavailable"

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

    async def create_job(
        self,
        *,
        operation_id: str,
        processing_preset_id: str | None = None,
        source_preference: str | None,
        source_voice_id: str | None = None,
        source_upload: UploadFile | None = None,
    ) -> SampleProcessingJob:
        resolved_operation_id = _normalize_operation_id(operation_id)
        resolved_source_preference = _normalize_source_preference(source_preference)
        operation = self._enabled_operation(resolved_operation_id)
        resolved_processing_preset_id, resolved_processing_preset_label = _normalize_processing_preset(
            processing_preset_id,
            operation,
        )

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
            job = SampleProcessingJob(
                id=job_id,
                operation_id=operation.id,
                status="pending",
                source_name=source_name,
                source_filename=source_sample.filename,
                source_content_type=source_sample.content_type,
                source_sha256=source_sample.sha256,
                source_preference=resolved_source_preference,
                created_at=now,
                updated_at=now,
                engine=self.processor.engine_name,
                processing_preset_id=resolved_processing_preset_id,
                processing_preset_label=resolved_processing_preset_label,
            )
            self._jobs[job_id] = job
            request = SampleProcessingRequest(
                job_id=job_id,
                operation_id=operation.id,
                source_path=source_path,
                output_path=job_dir / RESULT_FILENAME,
                job_dir=job_dir,
                source=source_sample,
                processing_preset_id=resolved_processing_preset_id,
                processing_preset_label=resolved_processing_preset_label,
            )
            self._tasks[job_id] = asyncio.create_task(self._run_job(job_id, request))
            return job
        except Exception:
            self._jobs.pop(job_id, None)
            self._tasks.pop(job_id, None)
            if job_dir_created:
                shutil.rmtree(job_dir, ignore_errors=True)
            raise

    def get_job(self, job_id: str) -> SampleProcessingJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise SampleProcessingServiceError("Sample processing job was not found.", 404)
        return job

    def result_path(self, job_id: str) -> Path:
        job = self.get_job(job_id)
        if job.status != "success" or job.result is None:
            raise SampleProcessingServiceError("Sample processing result is not ready.", 409)
        path = (self.processing_dir / job.result.path).resolve()
        _require_relative_path(path, self.processing_dir)
        if not path.exists():
            raise SampleProcessingServiceError("Sample processing result is missing.", 404)
        return path

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
        step = VoiceProcessingStep(
            id=job.id,
            label=self._operation_label(job.operation_id),
            operation_id=job.operation_id,
            created_at=_utc_now(),
            source_sha256=job.source_sha256,
            result_sha256=sample.sha256,
            engine=job.engine,
            processing_preset_id=job.processing_preset_id,
            processing_preset_label=job.processing_preset_label,
        )
        return self.voice_library.add_processed_sample(
            name,
            sample,
            processing_steps=(step,),
            voice_preset_id=voice_preset_id,
        )

    async def _run_job(self, job_id: str, request: SampleProcessingRequest) -> None:
        self._update_job(job_id, status="running")
        try:
            await self.processor.process(request)
            sample = load_sample_file(request.output_path, RESULT_CONTENT_TYPE)
            result = SampleProcessingResult(
                path=request.output_path.relative_to(self.processing_dir).as_posix(),
                filename=request.output_path.name,
                content_type=sample.content_type,
                sha256=sample.sha256,
            )
            self._update_job(job_id, status="success", result=result)
        except SampleProcessingServiceError as exc:
            self._update_job(job_id, status="error", error=exc.detail)
        except Exception:
            self._update_job(job_id, status="error", error="Sample processing failed.")
        finally:
            self._tasks.pop(job_id, None)

    def _update_job(self, job_id: str, **changes: object) -> None:
        job = self.get_job(job_id)
        self._jobs[job_id] = replace(job, updated_at=_utc_now(), **changes)

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


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
