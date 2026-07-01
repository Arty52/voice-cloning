from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
import re

from ..persistence.database import SessionFactory, unit_of_work
from ..persistence.settings import GENERATED_AUDIO_STORAGE_LIMIT_KEY, SqlAlchemyAppSettingsRepository


NATURAL_HANDOFFS_KEY = "naturalHandoffs"
SELECTED_MODEL_BY_PROVIDER_KEY = "selectedModelByProvider"
ALLOWED_APP_SETTING_KEYS = {
    GENERATED_AUDIO_STORAGE_LIMIT_KEY,
    NATURAL_HANDOFFS_KEY,
    SELECTED_MODEL_BY_PROVIDER_KEY,
}
SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


@dataclass(frozen=True)
class AppSettingsSnapshot:
    settings: dict[str, dict[str, Any]]


class AppSettingsError(Exception):
    def __init__(self, detail: str, status_code: int = 422) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class AppSettingsService:
    def __init__(self, session_factory: SessionFactory) -> None:
        self.session_factory = session_factory

    def get_settings(self) -> AppSettingsSnapshot:
        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyAppSettingsRepository(session)
            stored_settings = repository.list_settings()
        return AppSettingsSnapshot(settings=_snapshot_from(stored_settings))

    def update_settings(self, updates: Mapping[str, Any]) -> AppSettingsSnapshot:
        normalized_updates = _normalize_settings_update(updates)
        with unit_of_work(self.session_factory) as session:
            repository = SqlAlchemyAppSettingsRepository(session)
            current_settings = repository.list_settings()
            merged_settings = _snapshot_from(current_settings)
            for key, value in normalized_updates.items():
                if key == SELECTED_MODEL_BY_PROVIDER_KEY:
                    merged_settings[key] = {
                        **merged_settings.get(SELECTED_MODEL_BY_PROVIDER_KEY, {}),
                        **value,
                    }
                else:
                    merged_settings[key] = value
                repository.set(key, merged_settings[key])
        return AppSettingsSnapshot(settings=merged_settings)


def _snapshot_from(settings: Mapping[str, Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    snapshot: dict[str, dict[str, Any]] = {
        NATURAL_HANDOFFS_KEY: {"enabled": True},
        SELECTED_MODEL_BY_PROVIDER_KEY: {},
    }
    storage_limit = _normalize_generated_audio_storage_limit(settings.get(GENERATED_AUDIO_STORAGE_LIMIT_KEY))
    if storage_limit is not None:
        snapshot[GENERATED_AUDIO_STORAGE_LIMIT_KEY] = storage_limit
    natural_handoffs = _normalize_natural_handoffs(settings.get(NATURAL_HANDOFFS_KEY))
    if natural_handoffs is not None:
        snapshot[NATURAL_HANDOFFS_KEY] = natural_handoffs
    selected_models = _normalize_selected_model_by_provider(settings.get(SELECTED_MODEL_BY_PROVIDER_KEY))
    if selected_models is not None:
        snapshot[SELECTED_MODEL_BY_PROVIDER_KEY] = selected_models
    return snapshot


def _normalize_settings_update(settings: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    normalized: dict[str, dict[str, Any]] = {}
    for key, value in settings.items():
        if key not in ALLOWED_APP_SETTING_KEYS:
            raise AppSettingsError(f"Unsupported app setting: {key}.")
        if key.lower().endswith("apikey") or "secret" in key.lower() or "token" in key.lower():
            raise AppSettingsError("Secret settings cannot be persisted.")
        if key == NATURAL_HANDOFFS_KEY:
            normalized_value = _normalize_natural_handoffs(value)
        elif key == SELECTED_MODEL_BY_PROVIDER_KEY:
            normalized_value = _normalize_selected_model_by_provider(value)
        else:
            normalized_value = _normalize_generated_audio_storage_limit(value)
        if normalized_value is None:
            raise AppSettingsError(f"Invalid app setting value for {key}.")
        normalized[key] = normalized_value
    return normalized


def _normalize_natural_handoffs(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    enabled = value.get("enabled")
    if not isinstance(enabled, bool):
        return None
    return {"enabled": enabled}


def _normalize_selected_model_by_provider(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    selected_models: dict[str, str] = {}
    for provider_id, model_id in value.items():
        if not isinstance(provider_id, str) or not SAFE_ID_PATTERN.match(provider_id):
            return None
        if not isinstance(model_id, str) or not model_id.strip() or len(model_id.strip()) > 255:
            return None
        selected_models[provider_id] = model_id.strip()
    return selected_models


def _normalize_generated_audio_storage_limit(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    limit_bytes = value.get("limitBytes")
    if not isinstance(limit_bytes, int) or limit_bytes <= 0:
        return None
    return {"limitBytes": limit_bytes}
