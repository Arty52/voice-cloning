from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping

from ..cache import VoiceCache
from ..config import Settings
from ..models import CachedVoice, VoiceSample
from ..providers import ProviderError, ProviderKeyContext, VoiceProvider
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
    voice_settings: Mapping[str, Any] | None,
    settings: Settings,
    provider: VoiceProvider,
    voice_cache: VoiceCache,
    voice_library: VoiceLibrary,
    is_disconnected: Callable[[], Awaitable[bool]],
    provider_key: str | None = None,
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
        key_context = provider.resolve_key(provider_key)
        normalized_voice_settings = provider.normalize_voice_settings(voice_settings)
    except (RuntimeError, ProviderError) as exc:
        status_code = exc.status_code if isinstance(exc, ProviderError) else 500
        raise SpeechServiceError(str(exc), status_code) from exc

    try:
        sample = voice_library.get_sample(app_voice_id)
    except ValueError as exc:
        raise SpeechServiceError(str(exc), 422) from exc

    selected_model_id = model_id.strip() if model_id and model_id.strip() else provider.default_model_id
    cached_voice = voice_cache.get(sample.sha256, namespace=key_context.cache_namespace)
    cache_state = "hit"
    if cached_voice is None:
        cached_voice = _migrate_legacy_server_cache_entry(voice_cache, sample, key_context)
    if cached_voice is None:
        cache_state = "miss"
        try:
            clone = await await_or_cancel_on_disconnect(
                is_disconnected,
                lambda: provider.create_voice(sample, api_key=key_context.api_key),
            )
        except ProviderError as exc:
            raise SpeechServiceError(str(exc), exc.status_code) from exc
        cached_voice = voice_cache.set(sample, clone, namespace=key_context.cache_namespace)

    try:
        speech = await await_or_cancel_on_disconnect(
            is_disconnected,
            lambda: provider.create_speech(
                cached_voice.voice_id,
                normalized_text,
                normalized_voice_settings,
                selected_model_id,
                api_key=key_context.api_key,
            ),
        )
    except ProviderError as exc:
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


def _migrate_legacy_server_cache_entry(
    voice_cache: VoiceCache,
    sample: VoiceSample,
    key_context: ProviderKeyContext,
) -> CachedVoice | None:
    if key_context.source != "server":
        return None
    legacy_voice = voice_cache.get(sample.sha256)
    if legacy_voice is None:
        return None
    return voice_cache.set_cached(sample.sha256, legacy_voice, namespace=key_context.cache_namespace)
