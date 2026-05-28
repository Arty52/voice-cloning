from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import Response

from ...cache import VoiceCache
from ...config import Settings
from ...elevenlabs_client import ElevenLabsClient, ElevenLabsError
from ...models import VoiceSettings
from ...voice_library import VoiceLibrary
from ..disconnect import SpeechGenerationCanceled, _await_or_cancel_on_disconnect
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
    ) -> Response:
        normalized_text = text.strip()
        if not normalized_text:
            raise HTTPException(status_code=422, detail="Text is required.")
        if len(normalized_text) > settings.max_text_chars:
            raise HTTPException(
                status_code=422,
                detail=f"Text must be {settings.max_text_chars} characters or fewer.",
            )

        app_voice_id = (voiceId or voice_library.default_voice_id()).strip()
        if not app_voice_id:
            raise HTTPException(status_code=422, detail="Add or select a voice before generating speech.")

        try:
            settings.require_api_key()
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        sample = voice_library.get_sample(app_voice_id)
        selected_model_id = modelId.strip() if modelId and modelId.strip() else settings.elevenlabs_model_id
        voice_settings = VoiceSettings(
            stability=stability,
            similarity_boost=similarityBoost,
            style=style,
            speed=speed,
            use_speaker_boost=useSpeakerBoost,
        )
        cached_voice = voice_cache.get(sample.sha256)
        cache_state = "hit"
        if cached_voice is None:
            cache_state = "miss"
            try:
                clone = await _await_or_cancel_on_disconnect(request, lambda: elevenlabs_client.create_voice(sample))
            except SpeechGenerationCanceled as exc:
                raise HTTPException(status_code=499, detail="Speech generation was canceled.") from exc
            except ElevenLabsError as exc:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
            cached_voice = voice_cache.set(sample, clone)

        try:
            speech = await _await_or_cancel_on_disconnect(
                request,
                lambda: elevenlabs_client.create_speech(
                    cached_voice.voice_id,
                    normalized_text,
                    voice_settings,
                    selected_model_id,
                ),
            )
        except SpeechGenerationCanceled as exc:
            raise HTTPException(status_code=499, detail="Speech generation was canceled.") from exc
        except ElevenLabsError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

        return audio_response(
            speech.audio,
            sample,
            cached_voice,
            cache_state,
            app_voice_id,
            selected_model_id,
            speech.character_count,
            speech.request_id,
        )

    return router
