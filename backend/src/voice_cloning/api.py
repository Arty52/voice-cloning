from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Annotated
from typing import Awaitable, Callable, TypeVar

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from .cache import VoiceCache
from .config import Settings
from .elevenlabs_client import ElevenLabsClient, ElevenLabsError
from .models import CachedVoice, ModelSummary, SubscriptionSummary, VoiceSample, VoiceSettings
from .voice_library import VoiceLibrary

T = TypeVar("T")


class DefaultVoiceRequest(BaseModel):
    voiceId: str


class RenameVoiceRequest(BaseModel):
    name: str


class SpeechGenerationCanceled(Exception):
    pass


def create_app(
    settings: Settings | None = None,
    elevenlabs_client: ElevenLabsClient | None = None,
    voice_cache: VoiceCache | None = None,
    voice_library: VoiceLibrary | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    resolved_cache = voice_cache or VoiceCache(resolved_settings.storage_dir / "voice-cache.json")
    resolved_client = elevenlabs_client or ElevenLabsClient(resolved_settings)
    resolved_library = voice_library or VoiceLibrary(resolved_settings)

    app = FastAPI(title="Local Voice Cloning API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
        expose_headers=[
            "Content-Disposition",
            "X-App-Voice-Id",
            "X-Sample-Sha256",
            "X-Character-Count",
            "X-Model-Id",
            "X-Request-Id",
            "X-Voice-Cache",
            "X-Voice-Id",
        ],
    )

    @app.get("/api/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "defaultSampleAvailable": resolved_settings.default_sample_path.exists(),
            "defaultVoiceId": resolved_library.default_voice_id(),
            "model": resolved_settings.elevenlabs_model_id,
        }

    @app.get("/api/samples/default")
    def default_sample() -> FileResponse:
        return voice_sample(resolved_library.default_voice_id())

    @app.get("/api/voices")
    def voices() -> dict[str, object]:
        return resolved_library.list_payload()

    @app.get("/api/subscription")
    async def subscription() -> dict[str, object]:
        try:
            summary = await resolved_client.get_subscription()
        except RuntimeError as exc:
            return _subscription_error_payload(str(exc))
        except ElevenLabsError as exc:
            return _subscription_error_payload(str(exc))
        return _subscription_payload(summary)

    @app.get("/api/models")
    async def models() -> dict[str, object]:
        try:
            model_list = await resolved_client.list_models()
        except RuntimeError as exc:
            return _models_error_payload(resolved_settings.elevenlabs_model_id, str(exc))
        except ElevenLabsError as exc:
            return _models_error_payload(resolved_settings.elevenlabs_model_id, str(exc))
        return {
            "available": True,
            "error": None,
            "defaultModelId": resolved_settings.elevenlabs_model_id,
            "models": [_model_payload(model) for model in model_list],
        }

    @app.get("/api/voices/{voice_id}/sample")
    def voice_sample(voice_id: str) -> FileResponse:
        asset = resolved_library.get_asset(voice_id)
        path = resolved_library.resolve_asset_path(asset)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Voice sample is missing.")
        return FileResponse(path, filename=path.name, media_type=asset.content_type)

    @app.post("/api/voices", status_code=201)
    async def add_voice(name: str = Form(...), sampleFile: UploadFile = File(...)) -> dict[str, object]:
        asset = await resolved_library.add_upload(name, sampleFile)
        return {"voice": VoiceLibrary._asset_to_payload(asset)}

    @app.patch("/api/voices/{voice_id}")
    def rename_voice(voice_id: str, request: RenameVoiceRequest) -> dict[str, object]:
        return resolved_library.rename_asset(voice_id, request.name)

    @app.delete("/api/voices/{voice_id}")
    def delete_voice(voice_id: str) -> dict[str, object]:
        return resolved_library.delete_asset(voice_id)

    @app.put("/api/voices/default")
    def set_default_voice(request: DefaultVoiceRequest) -> dict[str, object]:
        return resolved_library.set_default(request.voiceId)

    @app.post("/api/speech")
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
        if len(normalized_text) > resolved_settings.max_text_chars:
            raise HTTPException(
                status_code=422,
                detail=f"Text must be {resolved_settings.max_text_chars} characters or fewer.",
            )

        app_voice_id = (voiceId or resolved_library.default_voice_id()).strip()
        if not app_voice_id:
            raise HTTPException(status_code=422, detail="Add or select a voice before generating speech.")

        try:
            resolved_settings.require_api_key()
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        sample = resolved_library.get_sample(app_voice_id)
        selected_model_id = modelId.strip() if modelId and modelId.strip() else resolved_settings.elevenlabs_model_id
        voice_settings = VoiceSettings(
            stability=stability,
            similarity_boost=similarityBoost,
            style=style,
            speed=speed,
            use_speaker_boost=useSpeakerBoost,
        )
        cached_voice = resolved_cache.get(sample.sha256)
        cache_state = "hit"
        if cached_voice is None:
            cache_state = "miss"
            try:
                clone = await _await_or_cancel_on_disconnect(request, lambda: resolved_client.create_voice(sample))
            except SpeechGenerationCanceled as exc:
                raise HTTPException(status_code=499, detail="Speech generation was canceled.") from exc
            except ElevenLabsError as exc:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
            cached_voice = resolved_cache.set(sample, clone)

        try:
            speech = await _await_or_cancel_on_disconnect(
                request,
                lambda: resolved_client.create_speech(
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

        return _audio_response(
            speech.audio,
            sample,
            cached_voice,
            cache_state,
            app_voice_id,
            selected_model_id,
            speech.character_count,
            speech.request_id,
        )

    return app


async def _await_or_cancel_on_disconnect(
    request: Request,
    start_work: Callable[[], Awaitable[T]],
    poll_interval: float = 0.1,
) -> T:
    if await request.is_disconnected():
        raise SpeechGenerationCanceled

    task = asyncio.ensure_future(start_work())
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=poll_interval)
            if task in done:
                return await task
            if await request.is_disconnected():
                await _cancel_and_drain_task(task)
                raise SpeechGenerationCanceled
    except BaseException:
        if not task.done():
            await _cancel_and_drain_task(task)
        raise


async def _cancel_and_drain_task(task: asyncio.Task[object]) -> None:
    task.cancel()
    with suppress(asyncio.CancelledError, Exception):
        await task


def _audio_response(
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


def _subscription_payload(summary: SubscriptionSummary) -> dict[str, object]:
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


def _subscription_error_payload(error: str) -> dict[str, object]:
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


def _models_error_payload(default_model_id: str, error: str) -> dict[str, object]:
    return {
        "available": False,
        "error": error,
        "defaultModelId": default_model_id,
        "models": [],
    }


def _model_payload(model: ModelSummary) -> dict[str, object]:
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


app = create_app()
