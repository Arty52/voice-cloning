from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import GeneratedAudioRecord
from .settings import GENERATED_AUDIO_STORAGE_LIMIT_KEY, SqlAlchemyAppSettingsRepository


@dataclass(frozen=True)
class GeneratedAudioMetadata:
    id: str
    file_path: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: str
    cache_state: str | None = None
    provider_id: str = "elevenlabs"
    provider_voice_id: str | None = None
    app_voice_id: str | None = None
    voice_name: str | None = None
    model_id: str | None = None
    character_count: int | None = None
    request_id: str | None = None
    generation_elapsed_ms: int | None = None
    multi_voice_metadata: dict[str, Any] | None = None
    tuning_metadata: dict[str, Any] | None = None


class SqlAlchemyGeneratedAudioRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_items(self) -> list[GeneratedAudioMetadata]:
        records = self.session.scalars(
            select(GeneratedAudioRecord).order_by(GeneratedAudioRecord.created_at.desc(), GeneratedAudioRecord.id)
        ).all()
        return [_metadata_from_record(record) for record in records]

    def list_oldest_first(self) -> list[GeneratedAudioMetadata]:
        records = self.session.scalars(
            select(GeneratedAudioRecord).order_by(GeneratedAudioRecord.created_at, GeneratedAudioRecord.id)
        ).all()
        return [_metadata_from_record(record) for record in records]

    def get(self, audio_id: str) -> GeneratedAudioMetadata | None:
        record = self.session.get(GeneratedAudioRecord, audio_id)
        if record is None:
            return None
        return _metadata_from_record(record)

    def save(self, metadata: GeneratedAudioMetadata) -> None:
        record = self.session.get(GeneratedAudioRecord, metadata.id)
        if record is None:
            record = GeneratedAudioRecord(id=metadata.id)
            self.session.add(record)
        record.file_path = metadata.file_path
        record.content_type = metadata.content_type
        record.size_bytes = metadata.size_bytes
        record.sha256 = metadata.sha256
        record.created_at = _datetime_from_iso(metadata.created_at)
        record.cache_state = metadata.cache_state
        record.provider_id = metadata.provider_id
        record.provider_voice_id = metadata.provider_voice_id
        record.app_voice_id = metadata.app_voice_id
        record.voice_name = metadata.voice_name
        record.model_id = metadata.model_id
        record.character_count = metadata.character_count
        record.request_id = metadata.request_id
        record.generation_elapsed_ms = metadata.generation_elapsed_ms
        record.multi_voice_metadata = metadata.multi_voice_metadata
        record.tuning_metadata = metadata.tuning_metadata

    def delete(self, audio_id: str) -> None:
        record = self.session.get(GeneratedAudioRecord, audio_id)
        if record is not None:
            self.session.delete(record)

    def clear(self) -> None:
        self.session.execute(delete(GeneratedAudioRecord))


def _metadata_from_record(record: GeneratedAudioRecord) -> GeneratedAudioMetadata:
    return GeneratedAudioMetadata(
        id=record.id,
        file_path=record.file_path,
        content_type=record.content_type,
        size_bytes=record.size_bytes,
        sha256=record.sha256,
        created_at=_isoformat(record.created_at),
        cache_state=record.cache_state,
        provider_id=record.provider_id,
        provider_voice_id=record.provider_voice_id,
        app_voice_id=record.app_voice_id,
        voice_name=record.voice_name,
        model_id=record.model_id,
        character_count=record.character_count,
        request_id=record.request_id,
        generation_elapsed_ms=record.generation_elapsed_ms,
        multi_voice_metadata=record.multi_voice_metadata,
        tuning_metadata=record.tuning_metadata,
    )


def _datetime_from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _isoformat(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()
