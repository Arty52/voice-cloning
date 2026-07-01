from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, cast
from uuid import uuid4
import re

from ..models import VOICE_PRESET_IDS, VoicePresetId
from ..persistence.database import SessionFactory, unit_of_work
from ..persistence.tuning_presets import (
    SqlAlchemyVoiceTuningPresetRepository,
    VoiceTuningPreset,
    utcnow_iso,
)
from ..providers import ProviderError, ProviderRegistry


SAFE_PRESET_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
MAX_PRESET_NAME_LENGTH = 120
SECRET_SETTING_MARKERS = ("apikey", "api_key", "secret", "token")


@dataclass(frozen=True)
class UserTuningPresetList:
    presets: list[VoiceTuningPreset]


class UserTuningPresetError(Exception):
    def __init__(self, detail: str, status_code: int = 422) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class UserTuningPresetService:
    def __init__(self, session_factory: SessionFactory, provider_registry: ProviderRegistry) -> None:
        self.session_factory = session_factory
        self.provider_registry = provider_registry

    def list_presets(self) -> UserTuningPresetList:
        with unit_of_work(self.session_factory) as session:
            presets = SqlAlchemyVoiceTuningPresetRepository(session).list_presets()
        return UserTuningPresetList(presets=presets)

    def create_preset(
        self,
        *,
        preset_id: str | None,
        name: str,
        provider_id: str,
        voice_preset_id: str | None,
        settings: Mapping[str, Any],
    ) -> VoiceTuningPreset:
        normalized_id = _normalize_preset_id(preset_id) if preset_id is not None else _new_preset_id()
        normalized = self._normalize_input(
            name=name,
            provider_id=provider_id,
            voice_preset_id=voice_preset_id,
            settings=settings,
        )
        now = utcnow_iso()
        preset = VoiceTuningPreset(
            id=normalized_id,
            name=normalized.name,
            provider_id=normalized.provider_id,
            voice_preset_id=normalized.voice_preset_id,
            settings=normalized.settings,
            created_at=now,
            updated_at=now,
        )
        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyVoiceTuningPresetRepository(session)
            if repository.get(normalized_id) is not None:
                raise UserTuningPresetError(f"Voice tuning preset already exists: {normalized_id}.", status_code=409)
            repository.save(preset)
        return preset

    def update_preset(
        self,
        preset_id: str,
        *,
        name: str,
        provider_id: str,
        voice_preset_id: str | None,
        settings: Mapping[str, Any],
    ) -> VoiceTuningPreset:
        normalized_id = _normalize_preset_id(preset_id)
        normalized = self._normalize_input(
            name=name,
            provider_id=provider_id,
            voice_preset_id=voice_preset_id,
            settings=settings,
        )
        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyVoiceTuningPresetRepository(session)
            existing = repository.get(normalized_id)
            if existing is None:
                raise UserTuningPresetError("Voice tuning preset was not found.", status_code=404)
            preset = VoiceTuningPreset(
                id=existing.id,
                name=normalized.name,
                provider_id=normalized.provider_id,
                voice_preset_id=normalized.voice_preset_id,
                settings=normalized.settings,
                created_at=existing.created_at,
                updated_at=utcnow_iso(),
            )
            repository.save(preset)
        return preset

    def delete_preset(self, preset_id: str) -> bool:
        normalized_id = _normalize_preset_id(preset_id)
        with unit_of_work(self.session_factory) as session:
            deleted = SqlAlchemyVoiceTuningPresetRepository(session).delete(normalized_id)
        return deleted

    def _normalize_input(
        self,
        *,
        name: str,
        provider_id: str,
        voice_preset_id: str | None,
        settings: Mapping[str, Any],
    ) -> "_NormalizedPresetInput":
        normalized_name = _normalize_name(name)
        normalized_provider_id = _normalize_provider_id(provider_id)
        normalized_voice_preset_id = _normalize_voice_preset_id(voice_preset_id)
        if not isinstance(settings, Mapping):
            raise UserTuningPresetError("Preset settings must be an object.")
        _reject_secret_settings(settings)
        try:
            provider = self.provider_registry.get(normalized_provider_id)
            normalized_settings = provider.normalize_voice_settings(settings)
        except ProviderError as exc:
            raise UserTuningPresetError(str(exc), status_code=exc.status_code) from exc
        return _NormalizedPresetInput(
            name=normalized_name,
            provider_id=provider.id,
            voice_preset_id=normalized_voice_preset_id,
            settings=dict(normalized_settings),
        )


@dataclass(frozen=True)
class _NormalizedPresetInput:
    name: str
    provider_id: str
    voice_preset_id: VoicePresetId | None
    settings: dict[str, Any]


def _normalize_preset_id(value: str) -> str:
    preset_id = value.strip()
    if not SAFE_PRESET_ID_PATTERN.match(preset_id):
        raise UserTuningPresetError("Voice tuning preset id must be 1-128 safe id characters.")
    return preset_id


def _new_preset_id() -> str:
    return f"preset-{uuid4().hex}"


def _normalize_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise UserTuningPresetError("Voice tuning preset name is required.")
    if len(name) > MAX_PRESET_NAME_LENGTH:
        raise UserTuningPresetError(f"Voice tuning preset name must be {MAX_PRESET_NAME_LENGTH} characters or fewer.")
    return name


def _normalize_provider_id(value: str) -> str:
    provider_id = value.strip()
    if not provider_id:
        raise UserTuningPresetError("Provider id is required.")
    return provider_id


def _normalize_voice_preset_id(value: str | None) -> VoicePresetId | None:
    if value is None:
        return None
    voice_preset_id = value.strip()
    if not voice_preset_id:
        return None
    if voice_preset_id not in VOICE_PRESET_IDS:
        raise UserTuningPresetError("Voice preset must be standardNarration or animatedDialogue.")
    return cast(VoicePresetId, voice_preset_id)


def _reject_secret_settings(settings: Mapping[str, Any]) -> None:
    for key in settings:
        normalized_key = str(key).replace("-", "_").lower()
        if any(marker in normalized_key for marker in SECRET_SETTING_MARKERS):
            raise UserTuningPresetError("Secret preset settings cannot be persisted.")
