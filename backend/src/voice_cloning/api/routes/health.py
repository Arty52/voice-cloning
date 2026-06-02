from __future__ import annotations

from fastapi import APIRouter

from ...config import Settings
from ...providers import ProviderRegistry
from ...voice_library import VoiceLibrary


def create_health_router(settings: Settings, voice_library: VoiceLibrary, provider_registry: ProviderRegistry) -> APIRouter:
    router = APIRouter()

    @router.get("/api/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "defaultSampleAvailable": settings.default_sample_path.exists(),
            "defaultVoiceId": voice_library.default_voice_id(),
            "model": provider_registry.get().default_model_id,
        }

    return router
