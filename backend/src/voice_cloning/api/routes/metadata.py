from __future__ import annotations

from fastapi import APIRouter, Header

from ...config import Settings
from ...elevenlabs_client import ElevenLabsClient, ElevenLabsError
from ...providers import DEFAULT_PROVIDER_ID, VOICE_PROVIDER_KEY_HEADER, provider_descriptors, resolve_elevenlabs_key
from ..serializers import (
    model_payload,
    models_error_payload,
    providers_payload,
    subscription_error_payload,
    subscription_payload,
)


def create_metadata_router(settings: Settings, elevenlabs_client: ElevenLabsClient) -> APIRouter:
    router = APIRouter()

    @router.get("/api/providers")
    async def providers() -> dict[str, object]:
        return providers_payload(
            DEFAULT_PROVIDER_ID,
            provider_descriptors(),
            {DEFAULT_PROVIDER_ID: bool(settings.elevenlabs_api_key)},
        )

    @router.get("/api/subscription")
    async def subscription(
        provider_key: str | None = Header(default=None, alias=VOICE_PROVIDER_KEY_HEADER),
    ) -> dict[str, object]:
        try:
            key_context = resolve_elevenlabs_key(settings, provider_key)
            summary = await elevenlabs_client.get_subscription(api_key=key_context.api_key)
        except RuntimeError as exc:
            return subscription_error_payload(str(exc))
        except ElevenLabsError as exc:
            return subscription_error_payload(str(exc))
        return subscription_payload(summary)

    @router.get("/api/models")
    async def models(
        provider_key: str | None = Header(default=None, alias=VOICE_PROVIDER_KEY_HEADER),
    ) -> dict[str, object]:
        try:
            key_context = resolve_elevenlabs_key(settings, provider_key)
            model_list = await elevenlabs_client.list_models(api_key=key_context.api_key)
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
