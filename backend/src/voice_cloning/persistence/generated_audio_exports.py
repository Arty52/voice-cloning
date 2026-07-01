from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import GeneratedAudioExportLedgerRecord


@dataclass(frozen=True)
class GeneratedAudioExportLedgerEntry:
    target_id: str
    audio_id: str
    sha256: str
    filename: str
    status: str
    exported_at: str | None = None
    last_error: str | None = None
    updated_at: str | None = None


class SqlAlchemyGeneratedAudioExportLedgerRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_entries(self) -> list[GeneratedAudioExportLedgerEntry]:
        records = self.session.scalars(
            select(GeneratedAudioExportLedgerRecord).order_by(
                GeneratedAudioExportLedgerRecord.updated_at.desc(),
                GeneratedAudioExportLedgerRecord.target_id,
                GeneratedAudioExportLedgerRecord.audio_id,
            )
        ).all()
        return [_entry_from_record(record) for record in records]

    def list_for_target(self, target_id: str) -> list[GeneratedAudioExportLedgerEntry]:
        records = self.session.scalars(
            select(GeneratedAudioExportLedgerRecord)
            .where(GeneratedAudioExportLedgerRecord.target_id == target_id)
            .order_by(
                GeneratedAudioExportLedgerRecord.updated_at.desc(),
                GeneratedAudioExportLedgerRecord.audio_id,
            )
        ).all()
        return [_entry_from_record(record) for record in records]

    def get(self, target_id: str, audio_id: str, sha256: str) -> GeneratedAudioExportLedgerEntry | None:
        record = self.session.get(
            GeneratedAudioExportLedgerRecord,
            {
                "target_id": target_id,
                "audio_id": audio_id,
                "sha256": sha256,
            },
        )
        if record is None:
            return None
        return _entry_from_record(record)

    def save(self, entry: GeneratedAudioExportLedgerEntry) -> None:
        record = self.session.get(
            GeneratedAudioExportLedgerRecord,
            {
                "target_id": entry.target_id,
                "audio_id": entry.audio_id,
                "sha256": entry.sha256,
            },
        )
        if record is None:
            record = GeneratedAudioExportLedgerRecord(
                target_id=entry.target_id,
                audio_id=entry.audio_id,
                sha256=entry.sha256,
            )
            self.session.add(record)
        record.filename = entry.filename
        record.status = entry.status
        record.exported_at = _datetime_from_iso_or_none(entry.exported_at)
        record.last_error = entry.last_error
        record.updated_at = _datetime_from_iso_or_none(entry.updated_at) or datetime.now(UTC)


def _entry_from_record(record: GeneratedAudioExportLedgerRecord) -> GeneratedAudioExportLedgerEntry:
    return GeneratedAudioExportLedgerEntry(
        target_id=record.target_id,
        audio_id=record.audio_id,
        sha256=record.sha256,
        filename=record.filename,
        status=record.status,
        exported_at=_isoformat_or_none(record.exported_at),
        last_error=record.last_error,
        updated_at=_isoformat_or_none(record.updated_at),
    )


def _datetime_from_iso_or_none(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value)


def _isoformat_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()
