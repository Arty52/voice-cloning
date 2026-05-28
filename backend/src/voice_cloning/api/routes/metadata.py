from __future__ import annotations

from fastapi import APIRouter

from ...config import Settings
from ...elevenlabs_client import ElevenLabsClient, ElevenLabsError
from ..serializers import model_payload, models_error_payload, subscription_error_payload, subscription_payload


def create_metadata_router(settings: Settings, elevenlabs_client: ElevenLabsClient) -> APIRouter:
    router = APIRouter()

    @router.get("/api/subscription")
    async def subscription() -> dict[str, object]:
        try:
            summary = await elevenlabs_client.get_subscription()
        except RuntimeError as exc:
            return subscription_error_payload(str(exc))
        except ElevenLabsError as exc:
            return subscription_error_payload(str(exc))
        return subscription_payload(summary)

    @router.get("/api/models")
    async def models() -> dict[str, object]:
        try:
            model_list = await elevenlabs_client.list_models()
        except RuntimeError as exc:
            return models_error_payload(settings.elevenlabs_model_id, str(exc))
        except ElevenLabsError as exc:
            return models_error_payload(settings.elevenlabs_model_id, str(exc))
        return {
            "available": True,
            "error": None,
            "defaultModelId": settings.elevenlabs_model_id,
            "models": [model_payload(model) for model in model_list],
        }

    return router
