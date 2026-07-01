from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import (
    DEFAULT_VOICE_PRESET_ID,
    SampleProcessingOperationId,
    SampleProcessingPresetId,
    VoiceAsset,
    VoicePresetId,
    VoiceProcessingStep,
)
from .models import VoiceLibraryStateRecord, VoiceProcessingStepRecord, VoiceRecord


VOICE_LIBRARY_STATE_ID = "voice-library"


class SqlAlchemyVoiceRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_assets(self) -> list[VoiceAsset]:
        records = self.session.scalars(select(VoiceRecord).order_by(VoiceRecord.created_at, VoiceRecord.id)).all()
        return [self._asset_from_record(record) for record in records]

    def get_asset(self, voice_id: str) -> VoiceAsset | None:
        record = self.session.get(VoiceRecord, voice_id)
        if record is None:
            return None
        return self._asset_from_record(record)

    def save_asset(self, asset: VoiceAsset) -> None:
        record = self.session.get(VoiceRecord, asset.id)
        if record is None:
            record = VoiceRecord(id=asset.id)
            self.session.add(record)
        record.name = asset.name
        record.file_path = asset.file_path
        record.content_type = asset.content_type
        record.sha256 = asset.sha256
        record.source = asset.source
        record.created_at = _datetime_from_iso(asset.created_at)
        record.sample_mode = asset.sample_mode
        record.window_start_seconds = asset.window_start_seconds
        record.window_duration_seconds = asset.window_duration_seconds
        record.source_file_path = asset.source_file_path
        record.source_content_type = asset.source_content_type
        record.source_sha256 = asset.source_sha256
        record.voice_preset_id = asset.voice_preset_id
        record.voice_settings_by_provider = dict(asset.voice_settings_by_provider)

        self.session.flush()
        self.session.execute(delete(VoiceProcessingStepRecord).where(VoiceProcessingStepRecord.voice_id == asset.id))
        for position, step in enumerate(asset.processing_steps):
            self.session.add(_step_record_from_domain(asset.id, position, step))

    def delete_asset(self, voice_id: str) -> None:
        record = self.session.get(VoiceRecord, voice_id)
        if record is not None:
            self.session.delete(record)

    def get_default_voice_id(self) -> str | None:
        state = self.session.get(VoiceLibraryStateRecord, VOICE_LIBRARY_STATE_ID)
        return state.default_voice_id if state is not None else None

    def set_default_voice_id(self, voice_id: str | None) -> None:
        state = self.session.get(VoiceLibraryStateRecord, VOICE_LIBRARY_STATE_ID)
        if state is None:
            state = VoiceLibraryStateRecord(id=VOICE_LIBRARY_STATE_ID)
            self.session.add(state)
        state.default_voice_id = voice_id or None

    def _asset_from_record(self, record: VoiceRecord) -> VoiceAsset:
        steps = self.session.scalars(
            select(VoiceProcessingStepRecord)
            .where(VoiceProcessingStepRecord.voice_id == record.id)
            .order_by(VoiceProcessingStepRecord.position, VoiceProcessingStepRecord.step_id)
        ).all()
        return VoiceAsset(
            id=record.id,
            name=record.name,
            file_path=record.file_path,
            content_type=record.content_type,
            sha256=record.sha256,
            source="default" if record.source == "default" else "upload",
            created_at=_isoformat(record.created_at),
            sample_mode="sourceWindow" if record.sample_mode == "sourceWindow" else "excerpt",
            window_start_seconds=record.window_start_seconds,
            window_duration_seconds=record.window_duration_seconds,
            source_file_path=record.source_file_path,
            source_content_type=record.source_content_type,
            source_sha256=record.source_sha256,
            voice_preset_id=_voice_preset_id(record.voice_preset_id),
            voice_settings_by_provider=_voice_settings_by_provider(record.voice_settings_by_provider),
            processing_steps=tuple(_processing_step_from_record(step) for step in steps),
        )


def _datetime_from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _isoformat(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _step_record_from_domain(voice_id: str, position: int, step: VoiceProcessingStep) -> VoiceProcessingStepRecord:
    return VoiceProcessingStepRecord(
        voice_id=voice_id,
        step_id=step.id,
        position=position,
        label=step.label,
        operation_id=step.operation_id,
        created_at=_datetime_from_iso(step.created_at),
        source_sha256=step.source_sha256,
        result_sha256=step.result_sha256,
        engine=step.engine,
        processing_preset_id=step.processing_preset_id,
        processing_preset_label=step.processing_preset_label,
        speaker_id=step.speaker_id,
        speaker_label=step.speaker_label,
    )


def _processing_step_from_record(record: VoiceProcessingStepRecord) -> VoiceProcessingStep:
    return VoiceProcessingStep(
        id=record.step_id,
        label=record.label,
        operation_id=cast(SampleProcessingOperationId, record.operation_id),
        created_at=_isoformat(record.created_at),
        source_sha256=record.source_sha256,
        result_sha256=record.result_sha256,
        engine=record.engine,
        processing_preset_id=cast(SampleProcessingPresetId, record.processing_preset_id)
        if record.processing_preset_id is not None
        else None,
        processing_preset_label=record.processing_preset_label,
        speaker_id=record.speaker_id,
        speaker_label=record.speaker_label,
    )


def _voice_preset_id(value: str) -> VoicePresetId:
    if value in {"standardNarration", "animatedDialogue"}:
        return cast(VoicePresetId, value)
    return DEFAULT_VOICE_PRESET_ID


def _voice_settings_by_provider(value: Any) -> dict[str, dict[str, object]]:
    if not isinstance(value, dict):
        return {}
    settings_by_provider: dict[str, dict[str, object]] = {}
    for provider_id, settings in value.items():
        if isinstance(provider_id, str) and provider_id.strip() and isinstance(settings, dict):
            settings_by_provider[provider_id] = dict(settings)
    return settings_by_provider
