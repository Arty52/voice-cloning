from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query

from ...config import Settings
from ...providers import ProviderError, ProviderRegistry, VOICE_PROVIDER_KEY_HEADER
from ..serializers import (
    model_payload,
    models_error_payload,
    providers_payload,
    subscription_error_payload,
    subscription_payload,
)


def create_metadata_router(settings: Settings, provider_registry: ProviderRegistry) -> APIRouter:
    router = APIRouter()

    @router.get("/api/providers")
    async def providers() -> dict[str, object]:
        return providers_payload(
            provider_registry.default_provider_id,
            provider_registry.descriptors(),
            provider_registry.server_key_configured_by_provider(),
            max_upload_bytes=settings.max_upload_bytes,
            max_source_upload_bytes=settings.max_source_upload_bytes,
        )

    @router.get("/api/subscription")
    async def subscription(
        provider_id: str | None = Query(default=None, alias="providerId"),
        provider_key: str | None = Header(default=None, alias=VOICE_PROVIDER_KEY_HEADER),
    ) -> dict[str, object]:
        try:
            provider = provider_registry.get(provider_id)
            key_context = provider.resolve_key(provider_key)
            summary = await provider.get_subscription(api_key=key_context.api_key)
        except ProviderError as exc:
            if exc.status_code == 404:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
            return subscription_error_payload(str(exc))
        except RuntimeError as exc:
            return subscription_error_payload(str(exc))
        return subscription_payload(summary)

    @router.get("/api/models")
    async def models(
        provider_id: str | None = Query(default=None, alias="providerId"),
        provider_key: str | None = Header(default=None, alias=VOICE_PROVIDER_KEY_HEADER),
    ) -> dict[str, object]:
        try:
            provider = provider_registry.get(provider_id)
            key_context = provider.resolve_key(provider_key)
            model_list = await provider.list_models(api_key=key_context.api_key)
        except ProviderError as exc:
            if exc.status_code == 404:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
            return models_error_payload(_default_model_id(provider_registry, provider_id), str(exc))
        except RuntimeError as exc:
            return models_error_payload(_default_model_id(provider_registry, provider_id), str(exc))
        return {
            "available": True,
            "error": None,
            "defaultModelId": provider.default_model_id,
            "models": [model_payload(model) for model in model_list],
        }

    return router


def _default_model_id(provider_registry: ProviderRegistry, provider_id: str | None) -> str:
    try:
        return provider_registry.get(provider_id).default_model_id
    except ProviderError:
        return provider_registry.get().default_model_id
