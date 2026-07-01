from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
from typing import Any
from uuid import uuid4

from fastapi import UploadFile

from ..persistence.database import SessionFactory, unit_of_work
from ..persistence.file_store import FileStoreError, LocalFileStore
from ..persistence.generated_audio import (
    GeneratedAudioMetadata,
    SqlAlchemyAppSettingsRepository,
    SqlAlchemyGeneratedAudioRepository,
)


BYTES_PER_MEBIBYTE = 1024 * 1024
DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES = 100 * BYTES_PER_MEBIBYTE
UPLOAD_CHUNK_SIZE_BYTES = 1024 * 1024
GENERATED_AUDIO_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
CONTENT_TYPE_EXTENSION_BY_PREFIX = {
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
class GeneratedAudioUsage:
    item_count: int
    limit_bytes: int
    remaining_bytes: int
    used_bytes: int


@dataclass(frozen=True)
class GeneratedAudioSaveResult:
    item: GeneratedAudioMetadata
    usage: GeneratedAudioUsage
    pruned_ids: list[str]
    already_existed: bool = False


@dataclass(frozen=True)
class GeneratedAudioMutationResult:
    usage: GeneratedAudioUsage
    pruned_ids: list[str]


@dataclass(frozen=True)
class StagedAudioUpload:
    path: Path
    upload_id: str
    content_type: str
    size_bytes: int
    sha256: str


class GeneratedAudioArchiveError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class GeneratedAudioArchiveService:
    def __init__(self, session_factory: SessionFactory, file_store: LocalFileStore) -> None:
        self.session_factory = session_factory
        self.file_store = file_store
        self.file_store.ensure_ready()

    def list_items(self) -> tuple[list[GeneratedAudioMetadata], GeneratedAudioUsage]:
        with unit_of_work(self.session_factory) as session:
            items = SqlAlchemyGeneratedAudioRepository(session).list_items()
            limit_bytes = _storage_limit(SqlAlchemyAppSettingsRepository(session))
        return items, _usage(items, limit_bytes)

    def get_item(self, audio_id: str) -> GeneratedAudioMetadata:
        _validate_audio_id(audio_id)
        with unit_of_work(self.session_factory) as session:
            item = SqlAlchemyGeneratedAudioRepository(session).get(audio_id)
        if item is None:
            raise GeneratedAudioArchiveError("Generated audio was not found.", 404)
        return item

    def resolve_audio_path(self, item: GeneratedAudioMetadata) -> Path:
        try:
            return self.file_store.resolve_path(item.file_path)
        except FileStoreError as exc:
            raise GeneratedAudioArchiveError("Generated audio file path is invalid.", 500) from exc

    async def save_upload(
        self,
        *,
        audio_id: str,
        upload: UploadFile,
        created_at: str | None,
        cache_state: str | None,
        provider_id: str | None,
        provider_voice_id: str | None,
        app_voice_id: str | None,
        voice_name: str | None,
        model_id: str | None,
        character_count: int | None,
        request_id: str | None,
        generation_elapsed_ms: int | None,
        multi_voice_metadata: dict[str, Any] | None,
        tuning_metadata: dict[str, Any] | None,
        ) -> GeneratedAudioSaveResult:
        _validate_audio_id(audio_id)
        limit_bytes = self.get_storage_limit()
        staged_upload = await self._stage_upload(upload, limit_bytes)
        moved_final_path: Path | None = None
        pruned_tombstones: list[tuple[Path, Path]] = []
        try:
            with unit_of_work(self.session_factory) as session:
                audio_repository = SqlAlchemyGeneratedAudioRepository(session)
                existing = audio_repository.get(audio_id)
                if existing is not None:
                    staged_upload.path.unlink(missing_ok=True)
                    if existing.sha256 == staged_upload.sha256:
                        items = audio_repository.list_items()
                        return GeneratedAudioSaveResult(
                            item=existing,
                            usage=_usage(items, _storage_limit(SqlAlchemyAppSettingsRepository(session))),
                            pruned_ids=[],
                            already_existed=True,
                        )
                    raise GeneratedAudioArchiveError("Generated audio id already exists with different content.", 409)

                relative_path = self._relative_audio_path(audio_id, staged_upload)
                final_path = self.file_store.resolve_path(relative_path)
                final_path.parent.mkdir(parents=True, exist_ok=True)
                metadata = GeneratedAudioMetadata(
                    id=audio_id,
                    file_path=relative_path,
                    content_type=staged_upload.content_type,
                    size_bytes=staged_upload.size_bytes,
                    sha256=staged_upload.sha256,
                    created_at=_created_at(created_at),
                    cache_state=_optional_str(cache_state),
                    provider_id=_optional_str(provider_id) or "elevenlabs",
                    provider_voice_id=_optional_str(provider_voice_id),
                    app_voice_id=_optional_str(app_voice_id),
                    voice_name=_optional_str(voice_name),
                    model_id=_optional_str(model_id),
                    character_count=_non_negative_int_or_none(character_count),
                    request_id=_optional_str(request_id),
                    generation_elapsed_ms=_non_negative_int_or_none(generation_elapsed_ms),
                    multi_voice_metadata=multi_voice_metadata,
                    tuning_metadata=tuning_metadata,
                )
                audio_repository.save(metadata)
                session.flush()
                shutil.move(str(staged_upload.path), str(final_path))
                moved_final_path = final_path
                pruned_ids, pruned_tombstones = self._prune_to_limit(
                    audio_repository,
                    limit_bytes,
                    protected_ids={audio_id},
                )
                items = audio_repository.list_items()
                result = GeneratedAudioSaveResult(item=metadata, usage=_usage(items, limit_bytes), pruned_ids=pruned_ids)
        except Exception:
            staged_upload.path.unlink(missing_ok=True)
            if moved_final_path is not None:
                moved_final_path.unlink(missing_ok=True)
            self._restore_tombstone_paths(pruned_tombstones)
            raise
        self._remove_tombstones(pruned_tombstones)
        return result

    def delete(self, audio_id: str) -> GeneratedAudioMutationResult:
        _validate_audio_id(audio_id)
        moved_paths: list[tuple[Path, Path]] = []
        try:
            with unit_of_work(self.session_factory) as session:
                repository = SqlAlchemyGeneratedAudioRepository(session)
                item = repository.get(audio_id)
                if item is None:
                    raise GeneratedAudioArchiveError("Generated audio was not found.", 404)
                moved_paths = self._move_items_to_tombstone([item])
                repository.delete(audio_id)
                session.flush()
                items = repository.list_items()
                usage = _usage(items, _storage_limit(SqlAlchemyAppSettingsRepository(session)))
        except Exception:
            self._restore_tombstone_paths(moved_paths)
            raise
        self._remove_tombstones(moved_paths)
        return GeneratedAudioMutationResult(usage=usage, pruned_ids=[audio_id])

    def clear(self) -> GeneratedAudioMutationResult:
        moved_paths: list[tuple[Path, Path]] = []
        try:
            with unit_of_work(self.session_factory) as session:
                repository = SqlAlchemyGeneratedAudioRepository(session)
                items = repository.list_items()
                moved_paths = self._move_items_to_tombstone(items)
                repository.clear()
                session.flush()
                usage = _usage([], _storage_limit(SqlAlchemyAppSettingsRepository(session)))
        except Exception:
            self._restore_tombstone_paths(moved_paths)
            raise
        self._remove_tombstones(moved_paths)
        return GeneratedAudioMutationResult(usage=usage, pruned_ids=[item.id for item in items])

    def get_usage(self) -> GeneratedAudioUsage:
        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyGeneratedAudioRepository(session)
            items = repository.list_items()
            limit_bytes = _storage_limit(SqlAlchemyAppSettingsRepository(session))
        return _usage(items, limit_bytes)

    def get_storage_limit(self) -> int:
        with unit_of_work(self.session_factory) as session:
            return _storage_limit(SqlAlchemyAppSettingsRepository(session))

    def update_storage_limit(self, limit_bytes: int, *, prune: bool = True) -> GeneratedAudioMutationResult:
        resolved_limit = _positive_int(limit_bytes, "Storage limit must be positive.")
        pruned_tombstones: list[tuple[Path, Path]] = []
        try:
            with unit_of_work(self.session_factory) as session:
                settings_repository = SqlAlchemyAppSettingsRepository(session)
                settings_repository.set_generated_audio_storage_limit(resolved_limit)
                session.flush()
                audio_repository = SqlAlchemyGeneratedAudioRepository(session)
                if prune:
                    pruned_ids, pruned_tombstones = self._prune_to_limit(
                        audio_repository,
                        resolved_limit,
                        protected_ids=set(),
                    )
                else:
                    pruned_ids = []
                items = audio_repository.list_items()
                usage = _usage(items, resolved_limit)
        except Exception:
            self._restore_tombstone_paths(pruned_tombstones)
            raise
        self._remove_tombstones(pruned_tombstones)
        return GeneratedAudioMutationResult(usage=usage, pruned_ids=pruned_ids)

    async def _stage_upload(self, upload: UploadFile, limit_bytes: int) -> StagedAudioUpload:
        content_type = _audio_content_type(upload.content_type)
        upload_id = uuid4().hex
        staged_path = self.file_store.root / ".staged" / upload_id / f"upload{_extension_for_content_type(content_type)}"
        staged_path.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size_bytes = 0
        try:
            with staged_path.open("wb") as output:
                while True:
                    chunk = await upload.read(UPLOAD_CHUNK_SIZE_BYTES)
                    if not chunk:
                        break
                    size_bytes += len(chunk)
                    if size_bytes > limit_bytes:
                        raise GeneratedAudioArchiveError(
                            f"Generated audio is {size_bytes} bytes, which exceeds the {limit_bytes} byte storage cap.",
                            413,
                        )
                    digest.update(chunk)
                    output.write(chunk)
            if size_bytes == 0:
                raise GeneratedAudioArchiveError("Generated audio file is empty.", 422)
        except Exception:
            staged_path.unlink(missing_ok=True)
            raise
        return StagedAudioUpload(
            path=staged_path,
            upload_id=upload_id,
            content_type=content_type,
            size_bytes=size_bytes,
            sha256=digest.hexdigest(),
        )

    def _relative_audio_path(self, audio_id: str, staged_upload: StagedAudioUpload) -> str:
        extension = staged_upload.path.suffix or ".mp3"
        relative_path = f"{staged_upload.sha256[:2]}/{audio_id}-{staged_upload.upload_id[:12]}{extension}"
        candidate = self.file_store.resolve_path(relative_path)
        if not candidate.exists():
            return relative_path
        for index in range(2, 1000):
            relative_path = f"{staged_upload.sha256[:2]}/{audio_id}-{staged_upload.upload_id[:12]}-{index}{extension}"
            if not self.file_store.resolve_path(relative_path).exists():
                return relative_path
        raise GeneratedAudioArchiveError("Unable to allocate a generated audio file path.", 500)

    def _prune_to_limit(
        self,
        repository: SqlAlchemyGeneratedAudioRepository,
        limit_bytes: int,
        *,
        protected_ids: set[str],
    ) -> tuple[list[str], list[tuple[Path, Path]]]:
        items = repository.list_oldest_first()
        used_bytes = sum(item.size_bytes for item in items)
        if used_bytes <= limit_bytes:
            return [], []
        pruned_items: list[GeneratedAudioMetadata] = []
        for item in items:
            if used_bytes <= limit_bytes:
                break
            if item.id in protected_ids:
                continue
            pruned_items.append(item)
            used_bytes -= item.size_bytes
        moved_paths = self._move_items_to_tombstone(pruned_items)
        try:
            for item in pruned_items:
                repository.delete(item.id)
            repository.session.flush()
        except Exception:
            self._restore_tombstone_paths(moved_paths)
            raise
        return [item.id for item in pruned_items], moved_paths

    def _move_items_to_tombstone(self, items: list[GeneratedAudioMetadata]) -> list[tuple[Path, Path]]:
        moved_paths: list[tuple[Path, Path]] = []
        tombstone_root = self.file_store.root / ".deleted" / uuid4().hex
        for item in items:
            path = self.resolve_audio_path(item)
            if not path.exists():
                continue
            relative_path = path.relative_to(self.file_store.root)
            tombstone_path = tombstone_root / relative_path
            tombstone_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(tombstone_path))
            moved_paths.append((tombstone_path, path))
        return moved_paths

    def _restore_tombstone_paths(self, moved_paths: list[tuple[Path, Path]]) -> None:
        for tombstone_path, original_path in reversed(moved_paths):
            if tombstone_path.exists():
                original_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(tombstone_path), str(original_path))
        self._remove_tombstone_dirs(moved_paths)

    def _remove_tombstones(self, moved_paths: list[tuple[Path, Path]]) -> None:
        for tombstone_path, _ in moved_paths:
            tombstone_path.unlink(missing_ok=True)
        self._remove_tombstone_dirs(moved_paths)

    def _remove_tombstone_dirs(self, moved_paths: list[tuple[Path, Path]]) -> None:
        for tombstone_path, _ in moved_paths:
            operation_root = _tombstone_operation_root(tombstone_path)
            if operation_root is not None:
                shutil.rmtree(operation_root, ignore_errors=True)


def _usage(items: list[GeneratedAudioMetadata], limit_bytes: int) -> GeneratedAudioUsage:
    used_bytes = sum(item.size_bytes for item in items)
    return GeneratedAudioUsage(
        item_count=len(items),
        limit_bytes=limit_bytes,
        remaining_bytes=max(0, limit_bytes - used_bytes),
        used_bytes=used_bytes,
    )


def _storage_limit(repository: SqlAlchemyAppSettingsRepository) -> int:
    return repository.get_generated_audio_storage_limit() or DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES


def _validate_audio_id(value: str) -> None:
    if not GENERATED_AUDIO_ID_PATTERN.match(value):
        raise GeneratedAudioArchiveError("Generated audio id is invalid.", 422)


def _created_at(value: str | None) -> str:
    if not value:
        return datetime.now(UTC).isoformat()
    try:
        return datetime.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise GeneratedAudioArchiveError("createdAt must be an ISO datetime.", 422) from exc


def _audio_content_type(value: str | None) -> str:
    content_type = (value or "").split(";", 1)[0].strip().lower()
    if content_type not in CONTENT_TYPE_EXTENSION_BY_PREFIX:
        raise GeneratedAudioArchiveError("Generated audio content type is not supported.", 422)
    return content_type


def _extension_for_content_type(content_type: str) -> str:
    return CONTENT_TYPE_EXTENSION_BY_PREFIX[content_type]


def _tombstone_operation_root(tombstone_path: Path) -> Path | None:
    for parent in tombstone_path.parents:
        if parent.parent.name == ".deleted":
            return parent
    return None


def _optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _non_negative_int_or_none(value: int | None) -> int | None:
    if value is None:
        return None
    return max(0, int(value))


def _positive_int(value: int, detail: str) -> int:
    if value <= 0:
        raise GeneratedAudioArchiveError(detail, 422)
    return value


def parse_optional_json_object(value: str | None, field_name: str) -> dict[str, Any] | None:
    if value is None or not value.strip():
        return None
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise GeneratedAudioArchiveError(f"{field_name} must be valid JSON.", 422) from exc
    if not isinstance(payload, dict):
        raise GeneratedAudioArchiveError(f"{field_name} must be a JSON object.", 422)
    return payload
