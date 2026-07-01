from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import VoiceTuningPresetRecord


@dataclass(frozen=True)
class VoiceTuningPreset:
    id: str
    name: str
    provider_id: str
    voice_preset_id: str | None
    settings: dict[str, Any]
    created_at: str
    updated_at: str


class VoiceTuningPresetRepository(Protocol):
    def list_presets(self) -> list[VoiceTuningPreset]:
        ...

    def get(self, preset_id: str) -> VoiceTuningPreset | None:
        ...

    def save(self, preset: VoiceTuningPreset) -> None:
        ...

    def delete(self, preset_id: str) -> bool:
        ...


class SqlAlchemyVoiceTuningPresetRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_presets(self) -> list[VoiceTuningPreset]:
        records = self.session.scalars(
            select(VoiceTuningPresetRecord).order_by(
                VoiceTuningPresetRecord.provider_id,
                VoiceTuningPresetRecord.label,
                VoiceTuningPresetRecord.id,
            )
        ).all()
        return [_preset_from_record(record) for record in records]

    def get(self, preset_id: str) -> VoiceTuningPreset | None:
        record = self.session.get(VoiceTuningPresetRecord, preset_id)
        if record is None:
            return None
        return _preset_from_record(record)

    def save(self, preset: VoiceTuningPreset) -> None:
        record = self.session.get(VoiceTuningPresetRecord, preset.id)
        if record is None:
            record = VoiceTuningPresetRecord(id=preset.id)
            self.session.add(record)
        record.provider_id = preset.provider_id
        record.label = preset.name
        record.voice_preset_id = preset.voice_preset_id
        record.settings = dict(preset.settings)
        record.created_at = _datetime_from_iso(preset.created_at)
        record.updated_at = _datetime_from_iso(preset.updated_at)

    def delete(self, preset_id: str) -> bool:
        record = self.session.get(VoiceTuningPresetRecord, preset_id)
        if record is None:
            return False
        self.session.delete(record)
        return True


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _preset_from_record(record: VoiceTuningPresetRecord) -> VoiceTuningPreset:
    return VoiceTuningPreset(
        id=record.id,
        name=record.label,
        provider_id=record.provider_id,
        voice_preset_id=record.voice_preset_id,
        settings=dict(record.settings),
        created_at=_isoformat(record.created_at),
        updated_at=_isoformat(record.updated_at),
    )


def _datetime_from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _isoformat(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()
