from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Form, Header, HTTPException, Request
from fastapi.responses import Response

from ...cache import VoiceCache
from ...config import Settings
from ...elevenlabs_client import ElevenLabsClient
from ...models import VoiceSettings
from ...providers import VOICE_PROVIDER_KEY_HEADER
from ...services.cancellation import SpeechGenerationCanceled
from ...services.speech import SpeechServiceError, generate_speech
from ...voice_library import VoiceLibrary
from ..serializers import audio_response


def create_speech_router(
    settings: Settings,
    elevenlabs_client: ElevenLabsClient,
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
        stability: Annotated[float, Form(ge=0, le=1)] = 0.5,
        similarityBoost: Annotated[float, Form(ge=0, le=1)] = 0.75,
        style: Annotated[float, Form(ge=0, le=1)] = 0,
        speed: Annotated[float, Form(ge=0.7, le=1.2)] = 1,
        useSpeakerBoost: bool = Form(True),
        provider_key: str | None = Header(default=None, alias=VOICE_PROVIDER_KEY_HEADER),
    ) -> Response:
        voice_settings = VoiceSettings(
            stability=stability,
            similarity_boost=similarityBoost,
            style=style,
            speed=speed,
            use_speaker_boost=useSpeakerBoost,
        )
        try:
            speech = await generate_speech(
                text=text,
                voice_id=voiceId,
                model_id=modelId,
                provider_key=provider_key,
                voice_settings=voice_settings,
                settings=settings,
                elevenlabs_client=elevenlabs_client,
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
