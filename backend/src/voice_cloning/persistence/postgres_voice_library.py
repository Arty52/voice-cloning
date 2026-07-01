from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime
import logging
from pathlib import Path
import shutil
from typing import Mapping
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from ..config import Settings
from ..models import VoiceAsset, VoiceProcessingStep, VoiceSample
from ..samples import (
    StoredSampleFile,
    load_sample_file,
    load_uploaded_sample,
    save_sample_file,
    save_uploaded_sample,
    slugify_voice_name,
)
from ..voice_library import (
    PreparedUploadPlan,
    VoiceLibrary,
    _normalize_sample_mode,
    _normalize_voice_preset_id,
    _normalize_window_metadata,
    _unlink_if_exists,
)
from .database import SessionFactory, unit_of_work
from .voices import SqlAlchemyVoiceRepository


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VoiceManifestImportReport:
    imported: int = 0
    already_imported: int = 0
    renamed_conflicts: int = 0
    skipped_missing_files: int = 0
    default_voice_id: str = ""

    @property
    def total(self) -> int:
        return self.imported + self.already_imported + self.renamed_conflicts + self.skipped_missing_files


class PostgresVoiceLibrary(VoiceLibrary):
    def __init__(self, settings: Settings, session_factory: SessionFactory) -> None:
        super().__init__(settings)
        self.session_factory = session_factory

    def list_payload(self) -> dict[str, object]:
        return {
            "defaultVoiceId": self.default_voice_id(),
            "voices": [self._asset_to_payload(asset) for asset in self.list_assets()],
        }

    def list_assets(self) -> list[VoiceAsset]:
        with unit_of_work(self.session_factory) as session:
            return SqlAlchemyVoiceRepository(session).list_assets()

    def default_voice_id(self) -> str:
        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyVoiceRepository(session)
            assets = repository.list_assets()
            asset_ids = {asset.id for asset in assets}
            default_voice_id = repository.get_default_voice_id()
            if default_voice_id in asset_ids:
                return default_voice_id or ""
            next_default = assets[0].id if assets else None
            repository.set_default_voice_id(next_default)
            return next_default or ""

    def get_asset(self, voice_id: str) -> VoiceAsset:
        with unit_of_work(self.session_factory) as session:
            asset = SqlAlchemyVoiceRepository(session).get_asset(voice_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="Voice asset was not found.")
        return asset

    def get_sample(self, voice_id: str) -> VoiceSample:
        asset = self.get_asset(voice_id)
        return load_sample_file(self.resolve_asset_path(asset), asset.content_type)

    async def add_upload(
        self,
        name: str,
        upload: UploadFile,
        sample_mode: str | None = None,
        source_upload: UploadFile | None = None,
        window_start_seconds: float | None = None,
        window_duration_seconds: float | None = None,
        voice_preset_id: str | None = None,
    ) -> VoiceAsset:
        plan = self.validate_prepared_upload(
            name,
            upload.filename,
            sample_mode=sample_mode,
            source_filename=source_upload.filename if source_upload is not None else None,
            source_file_available=source_upload is not None,
            window_start_seconds=window_start_seconds,
            window_duration_seconds=window_duration_seconds,
            voice_preset_id=voice_preset_id,
        )
        staged_sample = self._staged_path(plan.destination)
        staged_source = self._staged_path(plan.source_destination) if plan.source_destination is not None else None
        try:
            saved = await save_uploaded_sample(upload, staged_sample, self.settings)
            saved_source: VoiceSample | None = None
            if staged_source is not None and source_upload is not None:
                source_sample = await load_uploaded_sample(
                    source_upload,
                    self.settings,
                    max_bytes=self.settings.max_source_upload_bytes,
                )
                saved_source = save_sample_file(source_sample, staged_source)
            asset = self._asset_from_plan(plan, saved, saved_source)
            return self._save_new_asset(asset, [(staged_sample, plan.destination), *self._source_move(staged_source, plan)])
        except Exception:
            _unlink_if_exists(staged_sample)
            if staged_source is not None:
                _unlink_if_exists(staged_source)
            raise

    def add_prepared_upload(
        self,
        name: str,
        sample: VoiceSample,
        sample_mode: str | None = None,
        source_file: StoredSampleFile | None = None,
        window_start_seconds: float | None = None,
        window_duration_seconds: float | None = None,
        voice_preset_id: str | None = None,
    ) -> VoiceAsset:
        plan = self.validate_prepared_upload(
            name,
            sample.filename,
            sample_mode=sample_mode,
            source_filename=source_file.filename if source_file is not None else None,
            source_file_available=source_file is not None,
            window_start_seconds=window_start_seconds,
            window_duration_seconds=window_duration_seconds,
            voice_preset_id=voice_preset_id,
        )
        staged_sample = self._staged_path(plan.destination)
        staged_source = self._staged_path(plan.source_destination) if plan.source_destination is not None else None
        try:
            saved = save_sample_file(sample, staged_sample)
            saved_source: VoiceSample | None = None
            if staged_source is not None and source_file is not None:
                staged_source.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source_file.path), str(staged_source))
                saved_source = VoiceSample(
                    content=b"",
                    filename=staged_source.name,
                    content_type=source_file.content_type,
                    sha256=source_file.sha256,
                )
            asset = self._asset_from_plan(plan, saved, saved_source)
            return self._save_new_asset(asset, [(staged_sample, plan.destination), *self._source_move(staged_source, plan)])
        except Exception:
            _unlink_if_exists(staged_sample)
            if staged_source is not None:
                _unlink_if_exists(staged_source)
            raise

    def validate_prepared_upload(
        self,
        name: str,
        sample_filename: str | None,
        *,
        sample_mode: str | None = None,
        source_filename: str | None = None,
        source_file_available: bool = False,
        window_start_seconds: float | None = None,
        window_duration_seconds: float | None = None,
        voice_preset_id: str | None = None,
    ) -> PreparedUploadPlan:
        display_name = name.strip()
        if not display_name:
            raise HTTPException(status_code=422, detail="Voice name is required.")

        resolved_sample_mode = _normalize_sample_mode(sample_mode)
        resolved_window_start, resolved_window_duration = _normalize_window_metadata(
            resolved_sample_mode,
            object() if source_file_available else None,
            window_start_seconds,
            window_duration_seconds,
        )
        resolved_voice_preset_id = _normalize_voice_preset_id(voice_preset_id)
        voice_id = slugify_voice_name(display_name)
        self._ensure_available_voice_id(voice_id, display_name)

        destination = self.assets_dir / f"{voice_id}{Path(sample_filename or '').suffix.lower() or '.wav'}"
        if destination.exists():
            raise HTTPException(status_code=409, detail="A voice asset file with that name already exists.")

        source_destination: Path | None = None
        if resolved_sample_mode == "sourceWindow":
            source_destination = self.assets_dir / "sources" / f"{voice_id}{Path(source_filename or '').suffix.lower() or '.wav'}"
            if source_destination.exists():
                raise HTTPException(status_code=409, detail="A source audio file with that name already exists.")

        return PreparedUploadPlan(
            display_name=display_name,
            voice_id=voice_id,
            destination=destination,
            resolved_sample_mode=resolved_sample_mode,
            resolved_window_start=resolved_window_start,
            resolved_window_duration=resolved_window_duration,
            resolved_voice_preset_id=resolved_voice_preset_id,
            source_destination=source_destination,
        )

    def add_processed_sample(
        self,
        name: str,
        sample: VoiceSample,
        processing_steps: tuple[VoiceProcessingStep, ...],
        voice_preset_id: str | None = None,
    ) -> VoiceAsset:
        display_name = name.strip()
        if not display_name:
            raise HTTPException(status_code=422, detail="Voice name is required.")
        resolved_voice_preset_id = _normalize_voice_preset_id(voice_preset_id)
        voice_id = slugify_voice_name(display_name)
        self._ensure_available_voice_id(voice_id, display_name)

        destination = self.assets_dir / f"{voice_id}{Path(sample.filename or '').suffix.lower() or '.wav'}"
        if destination.exists():
            raise HTTPException(status_code=409, detail="A voice asset file with that name already exists.")

        staged_sample = self._staged_path(destination)
        try:
            saved = save_sample_file(sample, staged_sample)
            asset = VoiceAsset(
                id=voice_id,
                name=display_name,
                file_path=destination.relative_to(self.assets_dir).as_posix(),
                content_type=saved.content_type,
                sha256=saved.sha256,
                source="upload",
                created_at=datetime.now(UTC).isoformat(),
                sample_mode="excerpt",
                voice_preset_id=resolved_voice_preset_id,
                processing_steps=processing_steps,
            )
            return self._save_new_asset(asset, [(staged_sample, destination)])
        except Exception:
            _unlink_if_exists(staged_sample)
            raise

    def update_asset(
        self,
        voice_id: str,
        *,
        name: str | None = None,
        provider_id: str | None = None,
        voice_preset_id: str | None = None,
        voice_settings: Mapping[str, object] | None = None,
    ) -> dict[str, object]:
        if name is None and voice_preset_id is None and voice_settings is None:
            raise HTTPException(status_code=422, detail="Voice name, preset, or settings are required.")
        display_name = name.strip() if name is not None else None
        if display_name == "":
            raise HTTPException(status_code=422, detail="Voice name is required.")
        normalized_provider_id = provider_id.strip() if provider_id is not None else None
        if voice_settings is not None and not normalized_provider_id:
            raise HTTPException(status_code=422, detail="Provider id is required to save voice settings.")
        resolved_voice_preset_id = _normalize_voice_preset_id(voice_preset_id) if voice_preset_id is not None else None

        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyVoiceRepository(session)
            asset = repository.get_asset(voice_id)
            if asset is None:
                raise HTTPException(status_code=404, detail="Voice asset was not found.")
            if display_name is not None:
                normalized_name = slugify_voice_name(display_name)
                for existing in repository.list_assets():
                    if existing.id != voice_id and slugify_voice_name(existing.name) == normalized_name:
                        raise HTTPException(status_code=409, detail="A voice with that name already exists.")
                asset = replace(asset, name=display_name)
            if resolved_voice_preset_id is not None:
                asset = replace(asset, voice_preset_id=resolved_voice_preset_id)
            if voice_settings is not None and normalized_provider_id is not None:
                settings_by_provider = dict(asset.voice_settings_by_provider)
                settings_by_provider[normalized_provider_id] = dict(voice_settings)
                asset = replace(asset, voice_settings_by_provider=settings_by_provider)
            repository.save_asset(asset)
        return self.list_payload()

    def delete_asset(self, voice_id: str) -> dict[str, object]:
        asset = self.get_asset(voice_id)
        tombstone_dir = self.assets_dir / ".deleted" / uuid4().hex
        moved_paths = self._move_asset_files_to_tombstone(asset, tombstone_dir)
        try:
            with unit_of_work(self.session_factory) as session:
                repository = SqlAlchemyVoiceRepository(session)
                repository.delete_asset(voice_id)
                next_assets = repository.list_assets()
                if repository.get_default_voice_id() == voice_id:
                    repository.set_default_voice_id(next_assets[0].id if next_assets else None)
            shutil.rmtree(tombstone_dir, ignore_errors=True)
        except Exception:
            self._restore_tombstone_paths(moved_paths)
            raise
        return self.list_payload()

    def set_default(self, voice_id: str) -> dict[str, object]:
        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyVoiceRepository(session)
            if repository.get_asset(voice_id) is None:
                raise HTTPException(status_code=404, detail="Voice asset was not found.")
            repository.set_default_voice_id(voice_id)
        return self.list_payload()

    def import_manifest(self) -> VoiceManifestImportReport:
        manifest_library = VoiceLibrary(self.settings)
        imported = already_imported = renamed_conflicts = skipped_missing_files = 0
        default_id_by_manifest_id: dict[str, str] = {}
        for asset in manifest_library.list_assets():
            active_path = manifest_library.resolve_asset_path(asset)
            if not active_path.exists():
                skipped_missing_files += 1
                continue
            staged_moves: list[tuple[Path, Path]] = []
            try:
                with unit_of_work(self.session_factory) as session:
                    repository = SqlAlchemyVoiceRepository(session)
                    existing = repository.get_asset(asset.id)
                    if existing is not None and existing.sha256 == asset.sha256:
                        already_imported += 1
                        default_id_by_manifest_id[asset.id] = asset.id
                        continue
                    target_asset = asset
                    if existing is not None and existing.sha256 != asset.sha256:
                        target_asset, staged_moves = self._renamed_manifest_conflict(asset, active_path)
                        renamed_conflicts += 1
                    else:
                        imported += 1
                    repository.save_asset(target_asset)
                    for staged_path, final_path in staged_moves:
                        final_path.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(staged_path), str(final_path))
                    default_id_by_manifest_id[asset.id] = target_asset.id
            except Exception:
                for staged_path, final_path in staged_moves:
                    _unlink_if_exists(staged_path)
                    _unlink_if_exists(final_path)
                raise

        manifest_default = manifest_library.default_voice_id()
        default_voice_id = default_id_by_manifest_id.get(manifest_default, "")
        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyVoiceRepository(session)
            assets = repository.list_assets()
            if default_voice_id:
                repository.set_default_voice_id(default_voice_id)
            elif repository.get_default_voice_id() is None and assets:
                default_voice_id = assets[0].id
                repository.set_default_voice_id(default_voice_id)

        report = VoiceManifestImportReport(
            imported=imported,
            already_imported=already_imported,
            renamed_conflicts=renamed_conflicts,
            skipped_missing_files=skipped_missing_files,
            default_voice_id=default_voice_id,
        )
        if report.total:
            logger.info(
                "Voice manifest import completed: imported=%s already_imported=%s renamed_conflicts=%s skipped_missing_files=%s default_voice_id=%s",
                report.imported,
                report.already_imported,
                report.renamed_conflicts,
                report.skipped_missing_files,
                report.default_voice_id,
            )
        return report

    def _save_new_asset(self, asset: VoiceAsset, staged_moves: list[tuple[Path, Path]]) -> VoiceAsset:
        final_paths = [final_path for _, final_path in staged_moves]
        try:
            with unit_of_work(self.session_factory) as session:
                repository = SqlAlchemyVoiceRepository(session)
                repository.save_asset(asset)
                if not repository.get_default_voice_id():
                    repository.set_default_voice_id(asset.id)
                for staged_path, final_path in staged_moves:
                    final_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(staged_path), str(final_path))
        except Exception:
            for path in final_paths:
                _unlink_if_exists(path)
            raise
        return asset

    def _ensure_available_voice_id(self, voice_id: str, display_name: str) -> None:
        normalized_display_id = slugify_voice_name(display_name)
        for asset in self.list_assets():
            if asset.id == voice_id or slugify_voice_name(asset.name) == normalized_display_id:
                raise HTTPException(status_code=409, detail="A voice with that name already exists.")

    def _asset_from_plan(
        self,
        plan: PreparedUploadPlan,
        saved: VoiceSample,
        saved_source: VoiceSample | None,
    ) -> VoiceAsset:
        return VoiceAsset(
            id=plan.voice_id,
            name=plan.display_name,
            file_path=plan.destination.relative_to(self.assets_dir).as_posix(),
            content_type=saved.content_type,
            sha256=saved.sha256,
            source="upload",
            created_at=datetime.now(UTC).isoformat(),
            sample_mode=plan.resolved_sample_mode,
            window_start_seconds=plan.resolved_window_start,
            window_duration_seconds=plan.resolved_window_duration,
            source_file_path=plan.source_destination.relative_to(self.assets_dir).as_posix()
            if plan.source_destination is not None
            else None,
            source_content_type=saved_source.content_type if saved_source is not None else None,
            source_sha256=saved_source.sha256 if saved_source is not None else None,
            voice_preset_id=plan.resolved_voice_preset_id,
        )

    def _source_move(
        self,
        staged_source: Path | None,
        plan: PreparedUploadPlan,
    ) -> list[tuple[Path, Path]]:
        if staged_source is None or plan.source_destination is None:
            return []
        return [(staged_source, plan.source_destination)]

    def _staged_path(self, destination: Path | None) -> Path:
        if destination is None:
            raise ValueError("Destination is required.")
        return self.assets_dir / ".staged" / uuid4().hex / destination.name

    def _renamed_manifest_conflict(self, asset: VoiceAsset, active_path: Path) -> tuple[VoiceAsset, list[tuple[Path, Path]]]:
        new_id = f"{asset.id}-import-{asset.sha256[:8]}"
        destination = self.assets_dir / f"{new_id}{active_path.suffix.lower() or '.wav'}"
        staged_active = self._staged_path(destination)
        staged_active.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(active_path, staged_active)
        staged_moves = [(staged_active, destination)]
        source_file_path = asset.source_file_path
        source_content_type = asset.source_content_type
        source_sha256 = asset.source_sha256
        if asset.source_file_path:
            source_path = (self.assets_dir / asset.source_file_path).resolve()
            if source_path.exists():
                source_destination = self.assets_dir / "sources" / f"{new_id}{source_path.suffix.lower() or '.wav'}"
                staged_source = self._staged_path(source_destination)
                staged_source.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, staged_source)
                staged_moves.append((staged_source, source_destination))
                source_file_path = source_destination.relative_to(self.assets_dir).as_posix()
            else:
                source_file_path = None
                source_content_type = None
                source_sha256 = None
        return (
            replace(
                asset,
                id=new_id,
                file_path=destination.relative_to(self.assets_dir).as_posix(),
                source_file_path=source_file_path,
                source_content_type=source_content_type,
                source_sha256=source_sha256,
            ),
            staged_moves,
        )

    def _move_asset_files_to_tombstone(self, asset: VoiceAsset, tombstone_dir: Path) -> list[tuple[Path, Path]]:
        moved_paths: list[tuple[Path, Path]] = []
        for path in self._asset_paths(asset):
            if not path.exists():
                continue
            relative_path = path.relative_to(self.assets_dir)
            tombstone_path = tombstone_dir / relative_path
            tombstone_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(tombstone_path))
            moved_paths.append((tombstone_path, path))
        return moved_paths

    def _restore_tombstone_paths(self, moved_paths: list[tuple[Path, Path]]) -> None:
        for tombstone_path, original_path in reversed(moved_paths):
            if tombstone_path.exists():
                original_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(tombstone_path), str(original_path))

    def _asset_paths(self, asset: VoiceAsset) -> list[Path]:
        paths = [self.resolve_asset_path(asset)]
        if asset.source_file_path:
            source_path = (self.assets_dir / asset.source_file_path).resolve()
            try:
                source_path.relative_to(self.assets_dir.resolve())
            except ValueError as exc:
                raise HTTPException(status_code=500, detail="Voice asset path is invalid.") from exc
            paths.append(source_path)
        return paths
