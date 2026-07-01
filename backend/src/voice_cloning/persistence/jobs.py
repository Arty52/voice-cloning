from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SampleProcessingJob, SpeechJob
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

    def mark_active_jobs_interrupted(self) -> int:
        records = self.session.scalars(
            select(SampleProcessingJobRecord).where(SampleProcessingJobRecord.status.in_(ACTIVE_JOB_STATUSES))
        ).all()
        now = datetime.now(UTC)
        for record in records:
            record.status = INTERRUPTED_STATUS
            record.updated_at = now
            record.error_message = INTERRUPTED_MESSAGE
            result_payload = dict(record.result_payload or {})
            result_payload["interrupted"] = True
            result_payload["interruptedReason"] = INTERRUPTED_MESSAGE
            record.result_payload = result_payload
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

    def mark_active_jobs_interrupted(self) -> int:
        records = self.session.scalars(
            select(SpeechGenerationJobRecord).where(SpeechGenerationJobRecord.status.in_(ACTIVE_JOB_STATUSES))
        ).all()
        now = datetime.now(UTC)
        for record in records:
            record.status = INTERRUPTED_STATUS
            record.updated_at = now
            record.error_message = INTERRUPTED_MESSAGE
            result_payload = dict(record.result_payload or {})
            result_payload["interrupted"] = True
            result_payload["interruptedReason"] = INTERRUPTED_MESSAGE
            record.result_payload = result_payload
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


def _datetime_from_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed
