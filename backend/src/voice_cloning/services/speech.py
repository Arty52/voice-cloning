from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from ..cache import VoiceCache
from ..config import Settings
from ..elevenlabs_client import ElevenLabsClient, ElevenLabsError
from ..models import CachedVoice, VoiceSample, VoiceSettings
from ..voice_library import VoiceLibrary
from .cancellation import await_or_cancel_on_disconnect


@dataclass(frozen=True)
class SpeechGeneration:
    audio: bytes
    sample: VoiceSample
    cached_voice: CachedVoice
    cache_state: str
    app_voice_id: str
    model_id: str
    character_count: int | None
    request_id: str | None


class SpeechServiceError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


async def generate_speech(
    *,
    text: str,
    voice_id: str | None,
    model_id: str | None,
    voice_settings: VoiceSettings,
    settings: Settings,
    elevenlabs_client: ElevenLabsClient,
    voice_cache: VoiceCache,
    voice_library: VoiceLibrary,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> SpeechGeneration:
    normalized_text = text.strip()
    if not normalized_text:
        raise SpeechServiceError("Text is required.", 422)
    if len(normalized_text) > settings.max_text_chars:
        raise SpeechServiceError(f"Text must be {settings.max_text_chars} characters or fewer.", 422)

    app_voice_id = (voice_id or voice_library.default_voice_id()).strip()
    if not app_voice_id:
        raise SpeechServiceError("Add or select a voice before generating speech.", 422)

    try:
        settings.require_api_key()
    except RuntimeError as exc:
        raise SpeechServiceError(str(exc), 500) from exc

    sample = voice_library.get_sample(app_voice_id)
    selected_model_id = model_id.strip() if model_id and model_id.strip() else settings.elevenlabs_model_id
    cached_voice = voice_cache.get(sample.sha256)
    cache_state = "hit"
    if cached_voice is None:
        cache_state = "miss"
        try:
            clone = await await_or_cancel_on_disconnect(is_disconnected, lambda: elevenlabs_client.create_voice(sample))
        except ElevenLabsError as exc:
            raise SpeechServiceError(str(exc), exc.status_code) from exc
        cached_voice = voice_cache.set(sample, clone)

    try:
        speech = await await_or_cancel_on_disconnect(
            is_disconnected,
            lambda: elevenlabs_client.create_speech(
                cached_voice.voice_id,
                normalized_text,
                voice_settings,
                selected_model_id,
            ),
        )
    except ElevenLabsError as exc:
        raise SpeechServiceError(str(exc), exc.status_code) from exc

    return SpeechGeneration(
        audio=speech.audio,
        sample=sample,
        cached_voice=cached_voice,
        cache_state=cache_state,
        app_voice_id=app_voice_id,
        model_id=selected_model_id,
        character_count=speech.character_count,
        request_id=speech.request_id,
    )
