from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

from .config import Settings
from .models import VoiceAsset, VoiceSample
from .samples import load_default_sample, load_sample_file, save_uploaded_sample, slugify_voice_name


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

    async def add_upload(self, name: str, upload: UploadFile) -> VoiceAsset:
        display_name = name.strip()
        if not display_name:
            raise HTTPException(status_code=422, detail="Voice name is required.")

        manifest = self._read_manifest()
        voice_id = slugify_voice_name(display_name)
        if any(item.get("id") == voice_id for item in manifest["voices"]):
            raise HTTPException(status_code=409, detail="A voice with that name already exists.")

        extension = Path(upload.filename or "").suffix.lower() or ".mp3"
        destination = self.assets_dir / f"{voice_id}{extension}"
        if destination.exists():
            raise HTTPException(status_code=409, detail="A voice asset file with that name already exists.")

        saved = await save_uploaded_sample(upload, destination, self.settings)
        asset = VoiceAsset(
            id=voice_id,
            name=display_name,
            file_path=destination.relative_to(self.assets_dir).as_posix(),
            content_type=saved.content_type,
            sha256=saved.sha256,
            source="upload",
            created_at=datetime.now(UTC).isoformat(),
        )
        manifest["voices"].append(self._asset_to_payload(asset))
        self._write_manifest(manifest)
        return asset

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
        if not isinstance(default_voice_id, str) or not any(item.get("id") == default_voice_id for item in voices if isinstance(item, dict)):
            payload["defaultVoiceId"] = voices[0].get("id") if voices and isinstance(voices[0], dict) else ""
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
    def _asset_from_payload(payload: dict[str, Any]) -> VoiceAsset:
        return VoiceAsset(
            id=str(payload["id"]),
            name=str(payload["name"]),
            file_path=str(payload["filePath"]),
            content_type=str(payload["contentType"]),
            sha256=str(payload["sha256"]),
            source="default" if payload.get("source") == "default" else "upload",
            created_at=str(payload["createdAt"]),
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
        }
