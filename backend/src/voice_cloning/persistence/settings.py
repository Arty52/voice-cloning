from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AppSettingRecord


GENERATED_AUDIO_STORAGE_LIMIT_KEY = "generatedAudioStorageLimit"


class SqlAlchemyAppSettingsRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_settings(self) -> dict[str, dict[str, Any]]:
        records = self.session.scalars(select(AppSettingRecord).order_by(AppSettingRecord.key)).all()
        return {record.key: dict(record.value) for record in records if isinstance(record.value, dict)}

    def get(self, key: str) -> Mapping[str, Any] | None:
        record = self.session.get(AppSettingRecord, key)
        if record is None or not isinstance(record.value, dict):
            return None
        return dict(record.value)

    def set(self, key: str, value: Mapping[str, Any]) -> None:
        record = self.session.get(AppSettingRecord, key)
        if record is None:
            record = AppSettingRecord(key=key, value={})
            self.session.add(record)
        record.value = dict(value)
        record.updated_at = datetime.now(UTC)

    def get_generated_audio_storage_limit(self) -> int | None:
        value = self.get(GENERATED_AUDIO_STORAGE_LIMIT_KEY)
        limit_bytes = value.get("limitBytes") if value else None
        if isinstance(limit_bytes, int) and limit_bytes > 0:
            return limit_bytes
        return None

    def set_generated_audio_storage_limit(self, limit_bytes: int) -> None:
        self.set(GENERATED_AUDIO_STORAGE_LIMIT_KEY, {"limitBytes": limit_bytes})
