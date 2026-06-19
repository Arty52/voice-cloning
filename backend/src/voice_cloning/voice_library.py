from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

from .config import Settings
from .models import (
    DEFAULT_VOICE_PRESET_ID,
    VOICE_PRESET_IDS,
    VoiceAsset,
    VoicePresetId,
    VoiceProcessingStep,
    VoiceSample,
    VoiceSampleMode,
)
from .samples import (
    load_default_sample,
    load_sample_file,
    load_uploaded_sample,
    save_sample_file,
    save_uploaded_sample,
    slugify_voice_name,
)


class VoiceLibrary:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.assets_dir = settings.voice_assets_dir
        self.manifest_path = settings.voice_manifest_path
        self.assets_dir.mkdir(parents=True, exist_ok=True)

    def list_payload(self) -> dict[str, object]:
        manifest = self._read_manifest()
        return {
            "defaultVoiceId": manifest["defaultVoiceId"],
            "voices": manifest["voices"],
        }

    def list_assets(self) -> list[VoiceAsset]:
        manifest = self._read_manifest()
        return [self._asset_from_payload(item) for item in manifest["voices"]]

    def default_voice_id(self) -> str:
        return str(self._read_manifest()["defaultVoiceId"])

    def get_asset(self, voice_id: str) -> VoiceAsset:
        for asset in self.list_assets():
            if asset.id == voice_id:
                return asset
        raise HTTPException(status_code=404, detail="Voice asset was not found.")

    def get_sample(self, voice_id: str) -> VoiceSample:
        asset = self.get_asset(voice_id)
        return load_sample_file(self.resolve_asset_path(asset), asset.content_type)

    def resolve_asset_path(self, asset: VoiceAsset) -> Path:
        path = (self.assets_dir / asset.file_path).resolve()
        try:
            path.relative_to(self.assets_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=500, detail="Voice asset path is invalid.") from exc
        return path

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
        display_name = name.strip()
        if not display_name:
            raise HTTPException(status_code=422, detail="Voice name is required.")

        resolved_sample_mode = _normalize_sample_mode(sample_mode)
        resolved_window_start, resolved_window_duration = _normalize_window_metadata(
            resolved_sample_mode,
            source_upload,
            window_start_seconds,
            window_duration_seconds,
        )
        resolved_voice_preset_id = _normalize_voice_preset_id(voice_preset_id)

        manifest = self._read_manifest()
        voice_id = slugify_voice_name(display_name)
        if any(
            isinstance(item, dict)
            and (item.get("id") == voice_id or slugify_voice_name(str(item.get("name", ""))) == voice_id)
            for item in manifest["voices"]
        ):
            raise HTTPException(status_code=409, detail="A voice with that name already exists.")

        extension = Path(upload.filename or "").suffix.lower() or ".mp3"
        destination = self.assets_dir / f"{voice_id}{extension}"
        if destination.exists():
            raise HTTPException(status_code=409, detail="A voice asset file with that name already exists.")

        source_destination: Path | None = None
        source_sample: VoiceSample | None = None
        if resolved_sample_mode == "sourceWindow":
            if source_upload is None:
                raise HTTPException(status_code=422, detail="Source file is required for sourceWindow samples.")
            source_extension = Path(source_upload.filename or "").suffix.lower() or ".mp3"
            source_destination = self.assets_dir / "sources" / f"{voice_id}{source_extension}"
            if source_destination.exists():
                raise HTTPException(status_code=409, detail="A source audio file with that name already exists.")
            source_sample = await load_uploaded_sample(
                source_upload,
                self.settings,
                max_bytes=self.settings.max_source_upload_bytes,
            )

        saved_source: VoiceSample | None = None
        try:
            saved = await save_uploaded_sample(upload, destination, self.settings)
            if source_destination is not None and source_sample is not None:
                saved_source = save_sample_file(source_sample, source_destination)
        except Exception:
            _unlink_if_exists(destination)
            if source_destination is not None:
                _unlink_if_exists(source_destination)
            raise
        asset = VoiceAsset(
            id=voice_id,
            name=display_name,
            file_path=destination.relative_to(self.assets_dir).as_posix(),
            content_type=saved.content_type,
            sha256=saved.sha256,
            source="upload",
            created_at=datetime.now(UTC).isoformat(),
            sample_mode=resolved_sample_mode,
            window_start_seconds=resolved_window_start,
            window_duration_seconds=resolved_window_duration,
            source_file_path=source_destination.relative_to(self.assets_dir).as_posix()
            if source_destination is not None
            else None,
            source_content_type=saved_source.content_type if saved_source is not None else None,
            source_sha256=saved_source.sha256 if saved_source is not None else None,
            voice_preset_id=resolved_voice_preset_id,
        )
        manifest["voices"].append(self._asset_to_payload(asset))
        if not manifest.get("defaultVoiceId"):
            manifest["defaultVoiceId"] = asset.id
        self._write_manifest(manifest)
        return asset

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
        manifest = self._read_manifest()
        voice_id = slugify_voice_name(display_name)
        if any(
            isinstance(item, dict)
            and (item.get("id") == voice_id or slugify_voice_name(str(item.get("name", ""))) == voice_id)
            for item in manifest["voices"]
        ):
            raise HTTPException(status_code=409, detail="A voice with that name already exists.")

        extension = Path(sample.filename or "").suffix.lower() or ".wav"
        destination = self.assets_dir / f"{voice_id}{extension}"
        if destination.exists():
            raise HTTPException(status_code=409, detail="A voice asset file with that name already exists.")

        saved = save_sample_file(sample, destination)
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
        manifest["voices"].append(self._asset_to_payload(asset))
        if not manifest.get("defaultVoiceId"):
            manifest["defaultVoiceId"] = asset.id
        self._write_manifest(manifest)
        return asset

    def rename_asset(self, voice_id: str, name: str) -> dict[str, object]:
        return self.update_asset(voice_id, name=name)

    def update_asset(
        self,
        voice_id: str,
        *,
        name: str | None = None,
        voice_preset_id: str | None = None,
    ) -> dict[str, object]:
        if name is None and voice_preset_id is None:
            raise HTTPException(status_code=422, detail="Voice name or preset is required.")

        display_name = name.strip() if name is not None else None
        if display_name == "":
            raise HTTPException(status_code=422, detail="Voice name is required.")
        resolved_voice_preset_id = (
            _normalize_voice_preset_id(voice_preset_id) if voice_preset_id is not None else None
        )

        manifest = self._read_manifest()
        voices = manifest["voices"]
        voice_index = self._find_voice_index(voices, voice_id)
        if display_name is not None:
            normalized_name = slugify_voice_name(display_name)
            if any(
                index != voice_index and slugify_voice_name(str(item.get("name", ""))) == normalized_name
                for index, item in enumerate(voices)
                if isinstance(item, dict)
            ):
                raise HTTPException(status_code=409, detail="A voice with that name already exists.")

            voices[voice_index]["name"] = display_name
        if resolved_voice_preset_id is not None:
            voices[voice_index]["voicePresetId"] = resolved_voice_preset_id

        self._write_manifest(manifest)
        return {
            "defaultVoiceId": manifest["defaultVoiceId"],
            "voices": manifest["voices"],
        }

    def delete_asset(self, voice_id: str) -> dict[str, object]:
        manifest = self._read_manifest()
        voices = manifest["voices"]
        voice_index = self._find_voice_index(voices, voice_id)
        asset = self._asset_from_payload(voices[voice_index])

        path = self.resolve_asset_path(asset)
        if path.exists():
            path.unlink()

        del voices[voice_index]
        if manifest.get("defaultVoiceId") == voice_id:
            manifest["defaultVoiceId"] = voices[0].get("id") if voices and isinstance(voices[0], dict) else ""

        self._write_manifest(manifest)
        return {
            "defaultVoiceId": manifest["defaultVoiceId"],
            "voices": manifest["voices"],
        }

    def set_default(self, voice_id: str) -> dict[str, object]:
        manifest = self._read_manifest()
        if not any(item.get("id") == voice_id for item in manifest["voices"]):
            raise HTTPException(status_code=404, detail="Voice asset was not found.")
        manifest["defaultVoiceId"] = voice_id
        self._write_manifest(manifest)
        return {
            "defaultVoiceId": manifest["defaultVoiceId"],
            "voices": manifest["voices"],
        }

    def _read_manifest(self) -> dict[str, Any]:
        if not self.manifest_path.exists():
            manifest = self._bootstrap_manifest()
            self._write_manifest(manifest)
            return manifest

        try:
            payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}

        if not isinstance(payload, dict) or not isinstance(payload.get("voices"), list):
            payload = self._bootstrap_manifest()
            self._write_manifest(payload)
            return payload

        default_voice_id = payload.get("defaultVoiceId")
        voices = payload["voices"]
        migrated = False
        for item in voices:
            if isinstance(item, dict) and self._normalize_voice_payload(item):
                migrated = True
        if not isinstance(default_voice_id, str) or not any(item.get("id") == default_voice_id for item in voices if isinstance(item, dict)):
            payload["defaultVoiceId"] = voices[0].get("id") if voices and isinstance(voices[0], dict) else ""
            migrated = True
        if migrated:
            self._write_manifest(payload)
        return payload

    def _bootstrap_manifest(self) -> dict[str, Any]:
        if not self.settings.default_sample_path.exists():
            return {
                "version": 1,
                "defaultVoiceId": "",
                "voices": [],
            }

        default_sample = load_default_sample(self.settings)
        asset = VoiceAsset(
            id="default",
            name="Default voice",
            file_path=self.settings.default_sample_path.relative_to(self.assets_dir).as_posix(),
            content_type=default_sample.content_type,
            sha256=default_sample.sha256,
            source="default",
            created_at=datetime.now(UTC).isoformat(),
        )
        return {
            "version": 1,
            "defaultVoiceId": asset.id,
            "voices": [self._asset_to_payload(asset)],
        }

    def _write_manifest(self, payload: dict[str, Any]) -> None:
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.manifest_path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        temp_path.replace(self.manifest_path)

    @staticmethod
    def _find_voice_index(voices: list[object], voice_id: str) -> int:
        for index, item in enumerate(voices):
            if isinstance(item, dict) and item.get("id") == voice_id:
                return index
        raise HTTPException(status_code=404, detail="Voice asset was not found.")

    @staticmethod
    def _asset_from_payload(payload: dict[str, Any]) -> VoiceAsset:
        sample_mode = payload.get("sampleMode")
        resolved_sample_mode: VoiceSampleMode = "sourceWindow" if sample_mode == "sourceWindow" else "excerpt"
        return VoiceAsset(
            id=str(payload["id"]),
            name=str(payload["name"]),
            file_path=str(payload["filePath"]),
            content_type=str(payload["contentType"]),
            sha256=str(payload["sha256"]),
            source="default" if payload.get("source") == "default" else "upload",
            created_at=str(payload["createdAt"]),
            sample_mode=resolved_sample_mode,
            window_start_seconds=_optional_float(payload.get("windowStartSeconds")),
            window_duration_seconds=_optional_float(payload.get("windowDurationSeconds")),
            source_file_path=_optional_str(payload.get("sourceFilePath")),
            source_content_type=_optional_str(payload.get("sourceContentType")),
            source_sha256=_optional_str(payload.get("sourceSha256")),
            voice_preset_id=_normalize_voice_preset_id(payload.get("voicePresetId")),
            processing_steps=_processing_steps_from_payload(payload.get("processingSteps")),
        )

    @staticmethod
    def _asset_to_payload(asset: VoiceAsset) -> dict[str, object]:
        return {
            "id": asset.id,
            "name": asset.name,
            "filePath": asset.file_path,
            "contentType": asset.content_type,
            "sha256": asset.sha256,
            "source": asset.source,
            "createdAt": asset.created_at,
            "sampleMode": asset.sample_mode,
            "windowStartSeconds": asset.window_start_seconds,
            "windowDurationSeconds": asset.window_duration_seconds,
            "sourceFilePath": asset.source_file_path,
            "sourceContentType": asset.source_content_type,
            "sourceSha256": asset.source_sha256,
            "voicePresetId": asset.voice_preset_id,
            "processingSteps": [_processing_step_to_payload(step) for step in asset.processing_steps],
        }

    @staticmethod
    def _normalize_voice_payload(payload: dict[str, Any]) -> bool:
        migrated = False
        defaults: dict[str, object | None] = {
            "sampleMode": "excerpt",
            "windowStartSeconds": None,
            "windowDurationSeconds": None,
            "sourceFilePath": None,
            "sourceContentType": None,
            "sourceSha256": None,
            "voicePresetId": DEFAULT_VOICE_PRESET_ID,
            "processingSteps": [],
        }
        for key, value in defaults.items():
            if key not in payload:
                payload[key] = value
                migrated = True
        if payload.get("sampleMode") not in {"excerpt", "sourceWindow"}:
            payload["sampleMode"] = "excerpt"
            migrated = True
        if payload.get("voicePresetId") not in VOICE_PRESET_IDS:
            payload["voicePresetId"] = DEFAULT_VOICE_PRESET_ID
            migrated = True
        if not isinstance(payload.get("processingSteps"), list):
            payload["processingSteps"] = []
            migrated = True
        return migrated


def _optional_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _optional_str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _processing_steps_from_payload(value: Any) -> tuple[VoiceProcessingStep, ...]:
    if not isinstance(value, list):
        return ()
    steps: list[VoiceProcessingStep] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        operation_id = item.get("operationId")
        if operation_id not in {"isolateVoice", "trimSilence", "separateSpeakers"}:
            continue
        step_id = _optional_str(item.get("id"))
        label = _optional_str(item.get("label"))
        created_at = _optional_str(item.get("createdAt"))
        source_sha256 = _optional_str(item.get("sourceSha256"))
        result_sha256 = _optional_str(item.get("resultSha256"))
        if not step_id or not label or not created_at or not source_sha256 or not result_sha256:
            continue
        steps.append(
            VoiceProcessingStep(
                id=step_id,
                label=label,
                operation_id=operation_id,  # type: ignore[arg-type]
                created_at=created_at,
                source_sha256=source_sha256,
                result_sha256=result_sha256,
                engine=_optional_str(item.get("engine")),
            )
        )
    return tuple(steps)


def _processing_step_to_payload(step: VoiceProcessingStep) -> dict[str, object]:
    return {
        "id": step.id,
        "label": step.label,
        "operationId": step.operation_id,
        "createdAt": step.created_at,
        "sourceSha256": step.source_sha256,
        "resultSha256": step.result_sha256,
        "engine": step.engine,
    }


def _normalize_sample_mode(value: str | None) -> VoiceSampleMode:
    normalized = (value or "excerpt").strip()
    if normalized in {"excerpt", "sourceWindow"}:
        return "sourceWindow" if normalized == "sourceWindow" else "excerpt"
    raise HTTPException(status_code=422, detail="Sample mode must be excerpt or sourceWindow.")


def _normalize_voice_preset_id(value: Any) -> VoicePresetId:
    if value is None or value == "":
        return DEFAULT_VOICE_PRESET_ID
    if isinstance(value, str) and value in VOICE_PRESET_IDS:
        return value  # type: ignore[return-value]
    raise HTTPException(status_code=422, detail="Voice preset must be standardNarration or animatedDialogue.")


def _normalize_window_metadata(
    sample_mode: VoiceSampleMode,
    source_upload: UploadFile | None,
    window_start_seconds: float | None,
    window_duration_seconds: float | None,
) -> tuple[float | None, float | None]:
    has_window_start = window_start_seconds is not None
    has_window_duration = window_duration_seconds is not None
    if has_window_start != has_window_duration:
        raise HTTPException(status_code=422, detail="Window start and duration must be provided together.")

    if sample_mode != "sourceWindow" and source_upload is not None:
        raise HTTPException(status_code=422, detail="Source file is only accepted for sourceWindow samples.")

    if sample_mode == "sourceWindow":
        if source_upload is None:
            raise HTTPException(status_code=422, detail="Source file is required for sourceWindow samples.")
        if window_start_seconds is None or window_duration_seconds is None:
            raise HTTPException(status_code=422, detail="Window start and duration are required for sourceWindow samples.")

    if window_start_seconds is None or window_duration_seconds is None:
        return None, None

    if window_start_seconds < 0:
        raise HTTPException(status_code=422, detail="Window start must be zero or greater.")
    if window_duration_seconds <= 0:
        raise HTTPException(status_code=422, detail="Window duration must be greater than zero.")
    return window_start_seconds, window_duration_seconds


def _unlink_if_exists(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except FileNotFoundError:
        pass
