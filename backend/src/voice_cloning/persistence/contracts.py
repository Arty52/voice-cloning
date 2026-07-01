from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from ..models import VoiceAsset


class VoiceRepository(Protocol):
    def list_assets(self) -> list[VoiceAsset]:
        ...

    def get_asset(self, voice_id: str) -> VoiceAsset | None:
        ...

    def save_asset(self, asset: VoiceAsset) -> None:
        ...

    def delete_asset(self, voice_id: str) -> None:
        ...

    def get_default_voice_id(self) -> str | None:
        ...

    def set_default_voice_id(self, voice_id: str | None) -> None:
        ...


class GeneratedAudioRepository(Protocol):
    def exists(self, audio_id: str) -> bool:
        ...

    def delete(self, audio_id: str) -> None:
        ...


class SettingsRepository(Protocol):
    def get(self, key: str) -> Mapping[str, Any] | None:
        ...

    def set(self, key: str, value: Mapping[str, Any]) -> None:
        ...


class JobRepository(Protocol):
    def get_status(self, job_id: str) -> str | None:
        ...

    def set_status(self, job_id: str, status: str) -> None:
        ...


class UnitOfWork(Protocol):
    voices: VoiceRepository
    generated_audio: GeneratedAudioRepository
    settings: SettingsRepository
    jobs: JobRepository

    def commit(self) -> None:
        ...

    def rollback(self) -> None:
        ...
