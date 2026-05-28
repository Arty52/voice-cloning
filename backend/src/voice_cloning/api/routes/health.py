from __future__ import annotations

from fastapi import APIRouter

from ...config import Settings
from ...voice_library import VoiceLibrary


def create_health_router(settings: Settings, voice_library: VoiceLibrary) -> APIRouter:
    router = APIRouter()

    @router.get("/api/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "defaultSampleAvailable": settings.default_sample_path.exists(),
            "defaultVoiceId": voice_library.default_voice_id(),
            "model": settings.elevenlabs_model_id,
        }

    return router
