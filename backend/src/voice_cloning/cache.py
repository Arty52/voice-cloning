from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path

from .models import CachedVoice, VoiceClone, VoiceSample


class VoiceCache:
    def __init__(self, cache_path: Path) -> None:
        self.cache_path = cache_path
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)

    def get(self, sample_hash: str, namespace: str = "default") -> CachedVoice | None:
        payload = self._read()
        value = self._voices_for_namespace(payload, namespace).get(sample_hash)
        if not isinstance(value, dict):
            return None
        voice_id = value.get("voice_id")
        sample_name = value.get("sample_name")
        created_at = value.get("created_at")
        requires_verification = value.get("requires_verification", False)
        if not isinstance(voice_id, str) or not isinstance(sample_name, str) or not isinstance(created_at, str):
            return None
        return CachedVoice(
            voice_id=voice_id,
            sample_name=sample_name,
            created_at=created_at,
            requires_verification=bool(requires_verification),
        )

    def set(self, sample: VoiceSample, clone: VoiceClone, namespace: str = "default") -> CachedVoice:
        payload = self._read()
        voices = self._voices_for_namespace(payload, namespace)
        cached = CachedVoice(
            voice_id=clone.voice_id,
            sample_name=sample.filename,
            created_at=datetime.now(UTC).isoformat(),
            requires_verification=clone.requires_verification,
        )
        voices[sample.sha256] = {
            "voice_id": cached.voice_id,
            "sample_name": cached.sample_name,
            "created_at": cached.created_at,
            "requires_verification": cached.requires_verification,
        }
        self._write(payload)
        return cached

    def _read(self) -> dict:
        if not self.cache_path.exists():
            return {"version": 2, "voices": {}, "providers": {}}
        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"version": 2, "voices": {}, "providers": {}}
        if not isinstance(payload, dict):
            return {"version": 2, "voices": {}, "providers": {}}
        if not isinstance(payload.get("voices"), dict):
            payload["voices"] = {}
        if not isinstance(payload.get("providers"), dict):
            payload["providers"] = {}
        payload["version"] = 2
        return payload

    def _write(self, payload: dict) -> None:
        temp_path = self.cache_path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        temp_path.replace(self.cache_path)

    def _voices_for_namespace(self, payload: dict, namespace: str) -> dict:
        if namespace == "default":
            voices = payload.setdefault("voices", {})
        else:
            providers = payload.setdefault("providers", {})
            voices = providers.setdefault(namespace, {})
        if not isinstance(voices, dict):
            voices = {}
            if namespace == "default":
                payload["voices"] = voices
            else:
                payload.setdefault("providers", {})[namespace] = voices
        return voices
