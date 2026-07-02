from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
from typing import Any, Protocol

from ..persistence.generated_audio import GeneratedAudioMetadata
from ..persistence.generated_audio_exports import (
    GeneratedAudioExportLedgerEntry,
    SqlAlchemyGeneratedAudioExportLedgerRepository,
)
from ..persistence.database import SessionFactory, unit_of_work
from .generated_audio_archive import GeneratedAudioArchiveError, GeneratedAudioArchiveService


ARCHIVE_ROOT_NAME = "Voice Clone Lab Archive"
EXPORT_TARGET_ID_LOCAL_FILESYSTEM = "local-filesystem"
EXPORT_SCHEMA_VERSION = 1
EXPORT_TMP_DIR = ".tmp"
GENERATED_AUDIO_EXPORT_DIR = "generated-audio"
GENERATED_AUDIO_INDEX_DIR = "index"
GENERATED_AUDIO_INDEX_FILENAME = "generated-audio.jsonl"
CONTENT_TYPE_EXPORT_EXTENSION = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
}


@dataclass(frozen=True)
class ArchiveExportWriteResult:
    filename: str
    exported_at: str
    sidecar_filename: str
    index_filename: str
    already_exported: bool = False


class ArchiveExportTarget(Protocol):
    target_id: str

    def ensure_ready(self) -> None:
        ...

    def export_item(self, item: GeneratedAudioMetadata, source_path: Path) -> ArchiveExportWriteResult:
        ...


class ArchiveExportTargetError(Exception):
    pass


class GeneratedAudioExportError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass(frozen=True)
class GeneratedAudioExportResult:
    entry: GeneratedAudioExportLedgerEntry
    already_exported: bool = False


@dataclass(frozen=True)
class GeneratedAudioExportAllResult:
    items: list[GeneratedAudioExportResult]

    @property
    def exported_count(self) -> int:
        return sum(1 for item in self.items if item.entry.status == "exported")

    @property
    def failed_count(self) -> int:
        return sum(1 for item in self.items if item.entry.status == "failed")


class GeneratedAudioExportService:
    def __init__(
        self,
        session_factory: SessionFactory,
        archive_service: GeneratedAudioArchiveService,
        export_target: ArchiveExportTarget | None,
    ) -> None:
        self.session_factory = session_factory
        self.archive_service = archive_service
        self.export_target = export_target

    def export_item(self, audio_id: str) -> GeneratedAudioExportResult:
        target = self._require_target()
        try:
            item = self.archive_service.get_item(audio_id)
            source_path = self.archive_service.resolve_audio_path(item)
        except GeneratedAudioArchiveError as exc:
            raise GeneratedAudioExportError(exc.detail, exc.status_code) from exc
        if not source_path.exists():
            entry = self._save_entry(
                item,
                target.target_id,
                status="failed",
                filename=default_export_filename(item),
                last_error="Generated audio file is missing.",
            )
            return GeneratedAudioExportResult(entry=entry)
        try:
            write_result = target.export_item(item, source_path)
        except ArchiveExportTargetError as exc:
            entry = self._save_entry(
                item,
                target.target_id,
                status="failed",
                filename=default_export_filename(item),
                last_error=str(exc),
            )
            return GeneratedAudioExportResult(entry=entry)
        entry = self._save_entry(
            item,
            target.target_id,
            status="exported",
            filename=write_result.filename,
            exported_at=write_result.exported_at,
        )
        return GeneratedAudioExportResult(entry=entry, already_exported=write_result.already_exported)

    def export_all(self) -> GeneratedAudioExportAllResult:
        target = self._require_target()
        items, _usage = self.archive_service.list_items()
        results: list[GeneratedAudioExportResult] = []
        for item in items:
            try:
                results.append(self.export_item(item.id))
            except GeneratedAudioExportError as exc:
                entry = self._save_entry(
                    item,
                    target.target_id,
                    status="failed",
                    filename=default_export_filename(item),
                    last_error=exc.detail,
                )
                results.append(GeneratedAudioExportResult(entry=entry))
        return GeneratedAudioExportAllResult(items=results)

    def list_status(self) -> tuple[bool, str | None, list[GeneratedAudioExportLedgerEntry]]:
        if self.export_target is None:
            return False, None, []
        with unit_of_work(self.session_factory) as session:
            entries = SqlAlchemyGeneratedAudioExportLedgerRepository(session).list_for_target(
                self.export_target.target_id
            )
        return True, self.export_target.target_id, entries

    def _save_entry(
        self,
        item: GeneratedAudioMetadata,
        target_id: str,
        *,
        status: str,
        filename: str,
        exported_at: str | None = None,
        last_error: str | None = None,
    ) -> GeneratedAudioExportLedgerEntry:
        entry = GeneratedAudioExportLedgerEntry(
            target_id=target_id,
            audio_id=item.id,
            sha256=item.sha256,
            filename=filename,
            status=status,
            exported_at=exported_at,
            last_error=last_error,
            updated_at=datetime.now(UTC).isoformat(),
        )
        with unit_of_work(self.session_factory) as session:
            SqlAlchemyGeneratedAudioExportLedgerRepository(session).save(entry)
        return entry

    def _require_target(self) -> ArchiveExportTarget:
        if self.export_target is None:
            raise GeneratedAudioExportError("Generated audio export directory is not configured.", 503)
        return self.export_target


@dataclass(frozen=True)
class LocalArchiveExportTarget:
    root: Path
    target_id: str = EXPORT_TARGET_ID_LOCAL_FILESYSTEM

    @property
    def archive_root(self) -> Path:
        return self.root / ARCHIVE_ROOT_NAME

    def ensure_ready(self) -> None:
        self.archive_root.mkdir(parents=True, exist_ok=True)
        (self.archive_root / GENERATED_AUDIO_EXPORT_DIR).mkdir(parents=True, exist_ok=True)
        (self.archive_root / GENERATED_AUDIO_INDEX_DIR).mkdir(parents=True, exist_ok=True)
        (self.archive_root / EXPORT_TMP_DIR).mkdir(parents=True, exist_ok=True)

    def export_item(self, item: GeneratedAudioMetadata, source_path: Path) -> ArchiveExportWriteResult:
        try:
            if not source_path.exists():
                raise ArchiveExportTargetError("Generated audio source file is missing.")
            self.ensure_ready()
            exported_at = datetime.now(UTC).isoformat()
            descriptor = build_generated_audio_export_descriptor(item)
            audio_path, already_exported = self._write_audio_file(item, source_path, descriptor)
            sidecar_path = audio_path.with_suffix(".json")
            index_path = self.archive_root / GENERATED_AUDIO_INDEX_DIR / GENERATED_AUDIO_INDEX_FILENAME
            audio_filename = self._relative_export_path(audio_path)
            if already_exported:
                exported_at = self._sidecar_exported_at(sidecar_path) or exported_at
            else:
                sidecar_payload = build_generated_audio_export_sidecar(item, audio_filename, exported_at)
                self._write_json(sidecar_path, sidecar_payload)
                self._append_index_line(index_path, sidecar_payload)
            return ArchiveExportWriteResult(
                already_exported=already_exported,
                exported_at=exported_at,
                filename=audio_filename,
                index_filename=self._relative_export_path(index_path),
                sidecar_filename=self._relative_export_path(sidecar_path),
            )
        except ArchiveExportTargetError:
            raise
        except (OSError, shutil.Error) as exc:
            raise ArchiveExportTargetError(
                "Generated audio export could not write to the configured export directory."
            ) from exc

    def _write_audio_file(
        self,
        item: GeneratedAudioMetadata,
        source_path: Path,
        descriptor: "GeneratedAudioExportDescriptor",
    ) -> tuple[Path, bool]:
        for filename in export_filename_candidates(descriptor):
            destination = self._resolve_export_path(descriptor.year, descriptor.month, filename)
            if destination.exists():
                if _sha256_file(destination) == item.sha256 and self._sidecar_matches_audio_id(
                    destination.with_suffix(".json"),
                    item.id,
                ):
                    return destination, True
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            temp_path = self.archive_root / EXPORT_TMP_DIR / f"{descriptor.id_slug}-{descriptor.sha8}.part"
            self._assert_under_archive_root(temp_path)
            try:
                shutil.copyfile(source_path, temp_path)
                shutil.move(str(temp_path), str(destination))
            finally:
                temp_path.unlink(missing_ok=True)
            return destination, False
        raise ArchiveExportTargetError("Unable to allocate a generated audio export filename.")

    def _sidecar_exported_at(self, path: Path) -> str | None:
        payload = self._read_sidecar(path)
        exported_at = payload.get("exportedAt")
        return exported_at if isinstance(exported_at, str) else None

    def _sidecar_matches_audio_id(self, path: Path, audio_id: str) -> bool:
        return self._read_sidecar(path).get("id") == audio_id

    def _read_sidecar(self, path: Path) -> dict[str, Any]:
        self._assert_under_archive_root(path)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return payload if isinstance(payload, dict) else {}

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        self._assert_under_archive_root(path)
        temp_path = self.archive_root / EXPORT_TMP_DIR / f"{path.stem}.json.part"
        try:
            temp_path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")
            shutil.move(str(temp_path), str(path))
        finally:
            temp_path.unlink(missing_ok=True)

    def _append_index_line(self, path: Path, payload: dict[str, Any]) -> None:
        self._assert_under_archive_root(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as output:
            output.write(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n")

    def _resolve_export_path(self, year: str, month: str, filename: str) -> Path:
        path = self.archive_root / GENERATED_AUDIO_EXPORT_DIR / year / month / filename
        self._assert_under_archive_root(path)
        return path

    def _relative_export_path(self, path: Path) -> str:
        self._assert_under_archive_root(path)
        return path.relative_to(self.archive_root).as_posix()

    def _assert_under_archive_root(self, path: Path) -> None:
        try:
            path.resolve().relative_to(self.archive_root.resolve())
        except ValueError as exc:
            raise ArchiveExportTargetError("Export path escapes the configured export root.") from exc


@dataclass(frozen=True)
class GeneratedAudioExportDescriptor:
    compact_created_at: str
    extension: str
    id_slug: str
    model_slug: str
    month: str
    sha8: str
    voice_slug: str
    year: str


def create_local_archive_export_target(root: Path | None) -> LocalArchiveExportTarget | None:
    if root is None:
        return None
    return LocalArchiveExportTarget(root=root.resolve())


def build_generated_audio_export_descriptor(item: GeneratedAudioMetadata) -> GeneratedAudioExportDescriptor:
    created_at = _created_at_datetime(item.created_at)
    return GeneratedAudioExportDescriptor(
        compact_created_at=created_at.strftime("%Y%m%dT%H%M%SZ"),
        extension=_extension_for_item(item),
        id_slug=_slug(item.id, "audio"),
        model_slug=_slug(item.model_id, "model"),
        month=created_at.strftime("%m"),
        sha8=item.sha256[:8],
        voice_slug=_slug(item.voice_name or item.app_voice_id or item.provider_voice_id, "voice"),
        year=created_at.strftime("%Y"),
    )


def build_generated_audio_export_sidecar(
    item: GeneratedAudioMetadata,
    filename: str,
    exported_at: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": EXPORT_SCHEMA_VERSION,
        "id": item.id,
        "createdAt": item.created_at,
        "exportedAt": exported_at,
        "filename": filename,
        "sha256": item.sha256,
        "sizeBytes": item.size_bytes,
        "contentType": item.content_type,
        "providerId": item.provider_id,
        "modelId": item.model_id,
        "voiceId": item.provider_voice_id,
        "appVoiceId": item.app_voice_id,
        "voiceName": item.voice_name,
        "cacheState": item.cache_state,
        "requestId": item.request_id,
        "characterCount": item.character_count,
        "generationElapsedMs": item.generation_elapsed_ms,
        "tuningMetadata": item.tuning_metadata,
        "multiVoiceMetadata": item.multi_voice_metadata,
    }


def export_filename_candidates(descriptor: GeneratedAudioExportDescriptor) -> list[str]:
    base = (
        f"{descriptor.compact_created_at}--{descriptor.voice_slug}--"
        f"{descriptor.model_slug}--{descriptor.sha8}"
    )
    return [
        f"{base}{descriptor.extension}",
        f"{base}--{descriptor.id_slug}{descriptor.extension}",
        *[f"{base}--{descriptor.id_slug}-{index}{descriptor.extension}" for index in range(2, 1000)],
    ]


def default_export_filename(item: GeneratedAudioMetadata) -> str:
    descriptor = build_generated_audio_export_descriptor(item)
    return (
        f"{GENERATED_AUDIO_EXPORT_DIR}/{descriptor.year}/{descriptor.month}/"
        f"{export_filename_candidates(descriptor)[0]}"
    )


def _created_at_datetime(value: str) -> datetime:
    created_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return created_at.astimezone(UTC)


def _extension_for_item(item: GeneratedAudioMetadata) -> str:
    content_type = item.content_type.split(";", 1)[0].strip().lower()
    if content_type in CONTENT_TYPE_EXPORT_EXTENSION:
        return CONTENT_TYPE_EXPORT_EXTENSION[content_type]
    suffix = Path(item.file_path).suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        return suffix
    return ".mp3"


def _slug(value: str | None, fallback: str) -> str:
    normalized = (value or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return normalized[:64].strip("-") or fallback


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
