from __future__ import annotations

import json
from typing import Annotated
from typing import Any

from fastapi import APIRouter, Form, Header, HTTPException, Request
from fastapi.responses import Response

from ...cache import VoiceCache
from ...config import Settings
from ...providers import ProviderError, ProviderRegistry, VoiceProvider, VOICE_PROVIDER_KEY_HEADER
from ...services.cancellation import SpeechGenerationCanceled
from ...services.speech import SpeechServiceError, generate_speech
from ...voice_library import VoiceLibrary
from ..serializers import audio_response


def create_speech_router(
    settings: Settings,
    provider_registry: ProviderRegistry,
    voice_cache: VoiceCache,
    voice_library: VoiceLibrary,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/speech")
    async def create_speech(
        request: Request,
        text: str = Form(...),
        voiceId: str | None = Form(None),
        modelId: str | None = Form(None),
        providerId: str | None = Form(None),
        voiceSettings: str | None = Form(None),
        stability: Annotated[float | None, Form(ge=0, le=1)] = None,
        similarityBoost: Annotated[float | None, Form(ge=0, le=1)] = None,
        style: Annotated[float | None, Form(ge=0, le=1)] = None,
        speed: Annotated[float | None, Form(ge=0.7, le=1.2)] = None,
        useSpeakerBoost: bool | None = Form(None),
        provider_key: str | None = Header(default=None, alias=VOICE_PROVIDER_KEY_HEADER),
    ) -> Response:
        try:
            provider = provider_registry.get(providerId)
            voice_settings = _parse_voice_settings(
                provider=provider,
                voiceSettings=voiceSettings,
                stability=stability,
                similarityBoost=similarityBoost,
                style=style,
                speed=speed,
                useSpeakerBoost=useSpeakerBoost,
            )
        except ProviderError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        try:
            speech = await generate_speech(
                text=text,
                voice_id=voiceId,
                model_id=modelId,
                provider_key=provider_key,
                voice_settings=voice_settings,
                settings=settings,
                provider=provider,
                voice_cache=voice_cache,
                voice_library=voice_library,
                is_disconnected=request.is_disconnected,
            )
        except SpeechGenerationCanceled as exc:
            raise HTTPException(status_code=499, detail="Speech generation was canceled.") from exc
        except SpeechServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        return audio_response(
            speech.audio,
            speech.sample,
            speech.cached_voice,
            speech.cache_state,
            speech.app_voice_id,
            speech.model_id,
            speech.character_count,
            speech.request_id,
        )

    return router


def _parse_voice_settings(
    *,
    provider: VoiceProvider,
    voiceSettings: str | None,
    stability: float | None,
    similarityBoost: float | None,
    style: float | None,
    speed: float | None,
    useSpeakerBoost: bool | None,
) -> dict[str, Any] | None:
    if voiceSettings is not None and voiceSettings.strip():
        try:
            payload = json.loads(voiceSettings)
        except json.JSONDecodeError as exc:
            raise ValueError("voiceSettings must be valid JSON.") from exc
        if not isinstance(payload, dict):
            raise ValueError("voiceSettings must be a JSON object.")
        return payload

    legacy_settings: dict[str, Any] = {}
    if stability is not None:
        legacy_settings["stability"] = stability
    if similarityBoost is not None:
        legacy_settings["similarityBoost"] = similarityBoost
    if style is not None:
        legacy_settings["style"] = style
    if speed is not None:
        legacy_settings["speed"] = speed
    if useSpeakerBoost is not None:
        legacy_settings["useSpeakerBoost"] = useSpeakerBoost

    if not legacy_settings:
        return None

    supported_control_ids = {control.id for control in provider.descriptor.tuning.controls}
    filtered_settings = {
        setting_id: value for setting_id, value in legacy_settings.items() if setting_id in supported_control_ids
    }
    return filtered_settings or None
