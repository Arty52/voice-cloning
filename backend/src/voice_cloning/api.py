from __future__ import annotations

from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from .cache import VoiceCache
from .config import Settings
from .elevenlabs_client import ElevenLabsClient, ElevenLabsError
from .models import CachedVoice, ModelSummary, SubscriptionSummary, VoiceSample, VoiceSettings
from .voice_library import VoiceLibrary


class DefaultVoiceRequest(BaseModel):
    voiceId: str


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
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["*"],
        expose_headers=[
            "Content-Disposition",
            "X-App-Voice-Id",
            "X-Sample-Sha256",
            "X-Character-Count",
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
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except ElevenLabsError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        return _subscription_payload(summary)

    @app.get("/api/models")
    async def models() -> dict[str, object]:
        try:
            model_list = await resolved_client.list_models()
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except ElevenLabsError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        return {
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

    @app.put("/api/voices/default")
    def set_default_voice(request: DefaultVoiceRequest) -> dict[str, object]:
        return resolved_library.set_default(request.voiceId)

    @app.post("/api/speech")
    async def create_speech(
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
                clone = await resolved_client.create_voice(sample)
            except ElevenLabsError as exc:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
            cached_voice = resolved_cache.set(sample, clone)

        try:
            speech = await resolved_client.create_speech(
                cached_voice.voice_id,
                normalized_text,
                voice_settings,
                selected_model_id,
            )
        except ElevenLabsError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

        return _audio_response(
            speech.audio,
            sample,
            cached_voice,
            cache_state,
            app_voice_id,
            speech.character_count,
            speech.request_id,
        )

    return app


def _audio_response(
    audio: bytes,
    sample: VoiceSample,
    cached_voice: CachedVoice,
    cache_state: str,
    app_voice_id: str,
    character_count: int | None,
    request_id: str | None,
) -> Response:
    headers = {
        "Content-Disposition": 'attachment; filename="voice-clone.mp3"',
        "X-App-Voice-Id": app_voice_id,
        "X-Sample-Sha256": sample.sha256,
        "X-Voice-Cache": cache_state,
        "X-Voice-Id": cached_voice.voice_id,
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
        "tier": summary.tier,
        "status": summary.status,
        "characterCount": summary.character_count,
        "characterLimit": summary.character_limit,
        "remainingCharacters": summary.remaining_characters,
        "canExtendCharacterLimit": summary.can_extend_character_limit,
        "maxCreditLimitExtension": summary.max_credit_limit_extension,
        "nextCharacterCountResetUnix": summary.next_character_count_reset_unix,
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
