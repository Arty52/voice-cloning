from __future__ import annotations

from fastapi.responses import Response

from ..models import CachedVoice, ModelSummary, SubscriptionSummary, VoiceAsset, VoiceSample
from ..providers import ProviderDescriptor


def audio_response(
    audio: bytes,
    sample: VoiceSample,
    cached_voice: CachedVoice,
    cache_state: str,
    app_voice_id: str,
    model_id: str,
    character_count: int | None,
    request_id: str | None,
) -> Response:
    headers = {
        "Content-Disposition": 'attachment; filename="voice-clone.mp3"',
        "X-App-Voice-Id": app_voice_id,
        "X-Sample-Sha256": sample.sha256,
        "X-Voice-Cache": cache_state,
        "X-Voice-Id": cached_voice.voice_id,
        "X-Model-Id": model_id,
    }
    if character_count is not None:
        headers["X-Character-Count"] = str(character_count)
    if request_id:
        headers["X-Request-Id"] = request_id
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers=headers,
    )


def subscription_payload(summary: SubscriptionSummary) -> dict[str, object]:
    return {
        "available": True,
        "error": None,
        "tier": summary.tier,
        "status": summary.status,
        "characterCount": summary.character_count,
        "characterLimit": summary.character_limit,
        "remainingCharacters": summary.remaining_characters,
        "canExtendCharacterLimit": summary.can_extend_character_limit,
        "maxCreditLimitExtension": summary.max_credit_limit_extension,
        "nextCharacterCountResetUnix": summary.next_character_count_reset_unix,
    }


def subscription_error_payload(error: str) -> dict[str, object]:
    return {
        "available": False,
        "error": error,
        "tier": "unknown",
        "status": "unavailable",
        "characterCount": 0,
        "characterLimit": 0,
        "remainingCharacters": 0,
        "canExtendCharacterLimit": False,
        "maxCreditLimitExtension": None,
        "nextCharacterCountResetUnix": None,
    }


def models_error_payload(default_model_id: str, error: str) -> dict[str, object]:
    return {
        "available": False,
        "error": error,
        "defaultModelId": default_model_id,
        "models": [],
    }


def providers_payload(
    default_provider_id: str,
    providers: list[ProviderDescriptor],
    server_key_configured_by_provider: dict[str, bool],
) -> dict[str, object]:
    return {
        "defaultProviderId": default_provider_id,
        "providers": [
            {
                "id": provider.id,
                "label": provider.label,
                "serverKeyConfigured": server_key_configured_by_provider.get(provider.id, False),
                "manageKeyUrl": provider.manage_key_url,
                "docsUrl": provider.docs_url,
            }
            for provider in providers
        ],
    }


def model_payload(model: ModelSummary) -> dict[str, object]:
    return {
        "modelId": model.model_id,
        "name": model.name,
        "description": model.description,
        "canUseStyle": model.can_use_style,
        "canUseSpeakerBoost": model.can_use_speaker_boost,
        "characterCostMultiplier": model.character_cost_multiplier,
        "maxCharactersRequestFreeUser": model.max_characters_request_free_user,
        "maxCharactersRequestSubscribedUser": model.max_characters_request_subscribed_user,
        "maximumTextLengthPerRequest": model.maximum_text_length_per_request,
    }


def voice_asset_payload(asset: VoiceAsset) -> dict[str, object]:
    return {
        "id": asset.id,
        "name": asset.name,
        "filePath": asset.file_path,
        "contentType": asset.content_type,
        "sha256": asset.sha256,
        "source": asset.source,
        "createdAt": asset.created_at,
    }
