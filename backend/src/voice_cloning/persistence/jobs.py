from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, replace
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    PreparedSampleCandidate,
    PreparedSamplesResult,
    SampleProcessingDurationRange,
    SampleProcessingJob,
    SampleProcessingJobResult,
    SampleProcessingJobStatus,
    SampleProcessingJobStep,
    SampleProcessingOperationId,
    SampleProcessingPresetId,
    SampleProcessingProgressPhase,
    SampleProcessingResult,
    SampleProcessingSourcePreference,
    SampleProcessingSourceRange,
    SampleProcessingSourceSelection,
    SampleProcessingStepStatus,
    SampleProcessingWorkflowMode,
    SpeakerSeparationResult,
    SpeakerSeparationSpeaker,
    SpeakerSeparationTranscript,
    SpeakerTranscriptItem,
    SpeechJob,
    SpeechJobSegment,
    SpeechJobStatus,
    SpeechSegmentAssignmentKind,
    SpeechSegmentStatus,
)
from .models import SampleProcessingJobRecord, SpeechGenerationJobRecord


ACTIVE_JOB_STATUSES = {"pending", "running"}
INTERRUPTED_STATUS = "interrupted"
INTERRUPTED_MESSAGE = "Job was interrupted by application restart."


class SqlAlchemySampleProcessingJobRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def save_job(self, job: SampleProcessingJob) -> None:
        record = self.session.get(SampleProcessingJobRecord, job.id)
        if record is None:
            record = SampleProcessingJobRecord(id=job.id, request_payload={})
            self.session.add(record)
        record.status = job.status
        record.source_voice_id = _source_voice_id(job)
        record.created_at = _datetime_from_iso(job.created_at)
        record.updated_at = _datetime_from_iso(job.updated_at)
        record.request_payload = _sample_processing_request_payload(job)
        record.result_payload = {"job": _json_payload(job)}
        record.error_message = job.error

    def get_job(self, job_id: str) -> SampleProcessingJob | None:
        record = self.session.get(SampleProcessingJobRecord, job_id)
        if record is None:
            return None
        job_payload = _job_payload(record.result_payload)
        if job_payload is None:
            return None
        job = _sample_processing_job_from_payload(job_payload)
        return replace(
            job,
            status=cast(SampleProcessingJobStatus, record.status),
            updated_at=_isoformat(record.updated_at),
            error=record.error_message,
            active_step_id=None if record.status == INTERRUPTED_STATUS else job.active_step_id,
            active_progress_phase_id=None if record.status == INTERRUPTED_STATUS else job.active_progress_phase_id,
        )

    def mark_active_jobs_interrupted(self) -> int:
        records = self.session.scalars(
            select(SampleProcessingJobRecord).where(SampleProcessingJobRecord.status.in_(ACTIVE_JOB_STATUSES))
        ).all()
        now = datetime.now(UTC)
        for record in records:
            record.status = INTERRUPTED_STATUS
            record.updated_at = now
            record.error_message = INTERRUPTED_MESSAGE
            record.result_payload = _interrupted_result_payload(record.result_payload, now, active_field="active_step_id")
        return len(records)


class SqlAlchemySpeechGenerationJobRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def save_job(self, job: SpeechJob, *, result_audio_id: str | None = None) -> None:
        record = self.session.get(SpeechGenerationJobRecord, job.id)
        if record is None:
            record = SpeechGenerationJobRecord(id=job.id, request_payload={})
            self.session.add(record)
        record.status = job.status
        record.provider_id = job.provider_id
        record.result_audio_id = result_audio_id
        record.created_at = _datetime_from_iso(job.created_at)
        record.updated_at = _datetime_from_iso(job.updated_at)
        record.request_payload = _speech_generation_request_payload(job)
        record.result_payload = {"job": _json_payload(job)}
        record.error_message = job.error

    def get_job(self, job_id: str) -> SpeechJob | None:
        record = self.session.get(SpeechGenerationJobRecord, job_id)
        if record is None:
            return None
        job_payload = _job_payload(record.result_payload)
        if job_payload is None:
            return None
        job = _speech_job_from_payload(job_payload)
        return replace(
            job,
            status=cast(SpeechJobStatus, record.status),
            updated_at=_isoformat(record.updated_at),
            error=record.error_message,
            active_segment_id=None if record.status == INTERRUPTED_STATUS else job.active_segment_id,
        )

    def mark_active_jobs_interrupted(self) -> int:
        records = self.session.scalars(
            select(SpeechGenerationJobRecord).where(SpeechGenerationJobRecord.status.in_(ACTIVE_JOB_STATUSES))
        ).all()
        now = datetime.now(UTC)
        for record in records:
            record.status = INTERRUPTED_STATUS
            record.updated_at = now
            record.error_message = INTERRUPTED_MESSAGE
            record.result_payload = _interrupted_result_payload(
                record.result_payload,
                now,
                active_field="active_segment_id",
            )
        return len(records)


def _sample_processing_request_payload(job: SampleProcessingJob) -> dict[str, Any]:
    return {
        "operationId": job.operation_id,
        "processingPresetId": job.processing_preset_id,
        "sourcePreference": job.source_preference,
        "sourceSha256": job.source_sha256,
        "workflowMode": job.workflow_mode,
    }


def _speech_generation_request_payload(job: SpeechJob) -> dict[str, Any]:
    return {
        "defaultVoiceId": job.default_voice_id,
        "modelId": job.model_id,
        "providerId": job.provider_id,
        "segmentGapMs": job.segment_gap_ms,
        "text": job.text,
        "voiceSettings": job.voice_settings,
    }


def _source_voice_id(job: SampleProcessingJob) -> str | None:
    if job.source_preference == "active":
        return None
    return None


def _json_payload(job: SampleProcessingJob | SpeechJob) -> dict[str, Any]:
    return asdict(job)


def _job_payload(result_payload: Any) -> Mapping[str, Any] | None:
    if not isinstance(result_payload, Mapping):
        return None
    job_payload = result_payload.get("job")
    if not isinstance(job_payload, Mapping):
        return None
    return job_payload


def _interrupted_result_payload(value: Any, updated_at: datetime, *, active_field: str) -> dict[str, Any]:
    result_payload = dict(value) if isinstance(value, Mapping) else {}
    job_payload = result_payload.get("job")
    if isinstance(job_payload, Mapping):
        next_job_payload = dict(job_payload)
        next_job_payload["status"] = INTERRUPTED_STATUS
        next_job_payload["updated_at"] = _isoformat(updated_at)
        next_job_payload["error"] = INTERRUPTED_MESSAGE
        next_job_payload[active_field] = None
        result_payload["job"] = next_job_payload
    result_payload["interrupted"] = True
    result_payload["interruptedReason"] = INTERRUPTED_MESSAGE
    return result_payload


def _sample_processing_job_from_payload(payload: Mapping[str, Any]) -> SampleProcessingJob:
    return SampleProcessingJob(
        id=str(payload["id"]),
        operation_id=cast(SampleProcessingOperationId, payload["operation_id"]),
        status=cast(SampleProcessingJobStatus, payload["status"]),
        source_name=str(payload["source_name"]),
        source_filename=str(payload["source_filename"]),
        source_content_type=str(payload["source_content_type"]),
        source_sha256=str(payload["source_sha256"]),
        source_size_bytes=_optional_int(payload.get("source_size_bytes")),
        source_preference=cast(SampleProcessingSourcePreference, payload["source_preference"]),
        created_at=str(payload["created_at"]),
        updated_at=str(payload["updated_at"]),
        error=_optional_str(payload.get("error")),
        result=_sample_processing_result_from_payload(payload.get("result")),
        engine=_optional_str(payload.get("engine")),
        processing_preset_id=cast(SampleProcessingPresetId, payload.get("processing_preset_id")),
        processing_preset_label=_optional_str(payload.get("processing_preset_label")),
        workflow_mode=cast(SampleProcessingWorkflowMode, payload.get("workflow_mode", "single")),
        steps=tuple(_sample_processing_step_from_payload(step) for step in _mapping_items(payload.get("steps"))),
        active_step_id=_optional_str(payload.get("active_step_id")),
        estimated_duration_range_seconds=_duration_range_from_payload(
            payload.get("estimated_duration_range_seconds")
        ),
        progress_phases=tuple(
            _progress_phase_from_payload(phase) for phase in _mapping_items(payload.get("progress_phases"))
        ),
        active_progress_phase_id=_optional_str(payload.get("active_progress_phase_id")),
        source_selection=_source_selection_from_payload(payload.get("source_selection")),
    )


def _sample_processing_step_from_payload(payload: Mapping[str, Any]) -> SampleProcessingJobStep:
    return SampleProcessingJobStep(
        id=str(payload["id"]),
        operation_id=cast(SampleProcessingOperationId, payload["operation_id"]),
        operation_label=str(payload["operation_label"]),
        status=cast(SampleProcessingStepStatus, payload["status"]),
        engine=_optional_str(payload.get("engine")),
        processing_preset_id=cast(SampleProcessingPresetId, payload.get("processing_preset_id")),
        processing_preset_label=_optional_str(payload.get("processing_preset_label")),
        started_at=_optional_str(payload.get("started_at")),
        completed_at=_optional_str(payload.get("completed_at")),
        error=_optional_str(payload.get("error")),
        source_sha256=_optional_str(payload.get("source_sha256")),
        result_sha256=_optional_str(payload.get("result_sha256")),
    )


def _duration_range_from_payload(value: Any) -> SampleProcessingDurationRange | None:
    if not isinstance(value, Mapping):
        return None
    return SampleProcessingDurationRange(
        min_seconds=int(value["min_seconds"]),
        max_seconds=int(value["max_seconds"]),
    )


def _progress_phase_from_payload(payload: Mapping[str, Any]) -> SampleProcessingProgressPhase:
    return SampleProcessingProgressPhase(
        id=str(payload["id"]),
        label=str(payload["label"]),
        status=cast(SampleProcessingStepStatus, payload["status"]),
        started_at=_optional_str(payload.get("started_at")),
        completed_at=_optional_str(payload.get("completed_at")),
        error=_optional_str(payload.get("error")),
        detail=_optional_str(payload.get("detail")),
    )


def _source_selection_from_payload(value: Any) -> SampleProcessingSourceSelection | None:
    if not isinstance(value, Mapping):
        return None
    return SampleProcessingSourceSelection(
        source_media_id=str(value["source_media_id"]),
        ranges=tuple(_source_range_from_payload(item) for item in _mapping_items(value.get("ranges"))),
    )


def _source_range_from_payload(payload: Mapping[str, Any]) -> SampleProcessingSourceRange:
    return SampleProcessingSourceRange(
        start_seconds=float(payload["start_seconds"]),
        end_seconds=float(payload["end_seconds"]),
        duration_seconds=float(payload["duration_seconds"]),
        label=_optional_str(payload.get("label")),
    )


def _sample_processing_result_from_payload(value: Any) -> SampleProcessingJobResult | None:
    if not isinstance(value, Mapping):
        return None
    if value.get("kind") == "speakerSeparation":
        return SpeakerSeparationResult(
            kind="speakerSeparation",
            speakers=tuple(_speaker_from_payload(item) for item in _mapping_items(value.get("speakers"))),
            transcript=SpeakerSeparationTranscript(
                items=tuple(
                    _transcript_item_from_payload(item)
                    for item in _mapping_items(_mapping_value(value.get("transcript")).get("items"))
                ),
            ),
        )
    if value.get("kind") == "preparedSamples":
        return PreparedSamplesResult(
            kind="preparedSamples",
            candidates=tuple(_prepared_candidate_from_payload(item) for item in _mapping_items(value.get("candidates"))),
            warnings=tuple(str(item) for item in _sequence_items(value.get("warnings"))),
        )
    return SampleProcessingResult(
        path=str(value["path"]),
        filename=str(value["filename"]),
        content_type=str(value["content_type"]),
        sha256=str(value["sha256"]),
    )


def _speaker_from_payload(payload: Mapping[str, Any]) -> SpeakerSeparationSpeaker:
    result = _sample_processing_result_from_payload(payload.get("result"))
    return SpeakerSeparationSpeaker(
        id=str(payload["id"]),
        label=str(payload["label"]),
        transcript_item_ids=tuple(str(item) for item in _sequence_items(payload.get("transcript_item_ids"))),
        assigned_name=_optional_str(payload.get("assigned_name")),
        result=result if isinstance(result, SampleProcessingResult) else None,
    )


def _transcript_item_from_payload(payload: Mapping[str, Any]) -> SpeakerTranscriptItem:
    return SpeakerTranscriptItem(
        id=str(payload["id"]),
        text=str(payload["text"]),
        start_seconds=float(payload["start_seconds"]),
        end_seconds=float(payload["end_seconds"]),
        speaker_id=str(payload["speaker_id"]),
    )


def _prepared_candidate_from_payload(payload: Mapping[str, Any]) -> PreparedSampleCandidate:
    return PreparedSampleCandidate(
        candidate_id=str(payload["candidate_id"]),
        rank=int(payload["rank"]),
        score=float(payload["score"]),
        speaker_id=str(payload["speaker_id"]),
        speaker_label=str(payload["speaker_label"]),
        source_start_seconds=float(payload["source_start_seconds"]),
        source_end_seconds=float(payload["source_end_seconds"]),
        duration_seconds=float(payload["duration_seconds"]),
        sample_rate_hz=int(payload["sample_rate_hz"]),
        content_type=str(payload["content_type"]),
        sha256=str(payload["sha256"]),
        warnings=tuple(str(item) for item in _sequence_items(payload.get("warnings"))),
        result=SampleProcessingResult(
            path=str(_mapping_value(payload.get("result"))["path"]),
            filename=str(_mapping_value(payload.get("result"))["filename"]),
            content_type=str(_mapping_value(payload.get("result"))["content_type"]),
            sha256=str(_mapping_value(payload.get("result"))["sha256"]),
        ),
    )


def _speech_job_from_payload(payload: Mapping[str, Any]) -> SpeechJob:
    return SpeechJob(
        id=str(payload["id"]),
        status=cast(SpeechJobStatus, payload["status"]),
        text=str(payload["text"]),
        default_voice_id=str(payload["default_voice_id"]),
        segment_gap_ms=int(payload["segment_gap_ms"]),
        segments=tuple(_speech_segment_from_payload(segment) for segment in _mapping_items(payload.get("segments"))),
        created_at=str(payload["created_at"]),
        updated_at=str(payload["updated_at"]),
        provider_id=_optional_str(payload.get("provider_id")),
        model_id=_optional_str(payload.get("model_id")),
        voice_settings=_optional_dict(payload.get("voice_settings")),
        active_segment_id=_optional_str(payload.get("active_segment_id")),
        result_sha256=_optional_str(payload.get("result_sha256")),
        error=_optional_str(payload.get("error")),
    )


def _speech_segment_from_payload(payload: Mapping[str, Any]) -> SpeechJobSegment:
    return SpeechJobSegment(
        id=str(payload["id"]),
        index=int(payload["index"]),
        text=str(payload["text"]),
        voice_id=str(payload["voice_id"]),
        voice_name=str(payload["voice_name"]),
        assignment_kind=cast(SpeechSegmentAssignmentKind, payload["assignment_kind"]),
        voice_settings=_optional_dict(payload.get("voice_settings")),
        status=cast(SpeechSegmentStatus, payload.get("status", "pending")),
        generation_count=int(payload.get("generation_count", 0)),
        character_count=_optional_int(payload.get("character_count")),
        request_id=_optional_str(payload.get("request_id")),
        cache_state=_optional_str(payload.get("cache_state")),
        result_sha256=_optional_str(payload.get("result_sha256")),
        error=_optional_str(payload.get("error")),
    )


def _mapping_value(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    return {}


def _mapping_items(value: Any) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _sequence_items(value: Any) -> tuple[Any, ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(value)


def _optional_dict(value: Any) -> dict[str, object] | None:
    if not isinstance(value, Mapping):
        return None
    return dict(value)


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _datetime_from_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _isoformat(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()
