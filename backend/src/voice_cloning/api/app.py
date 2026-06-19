from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..cache import VoiceCache
from ..config import Settings
from ..elevenlabs_client import ElevenLabsProvider
from ..providers import ProviderRegistry
from ..services.sample_processing import SampleProcessingService, SampleProcessor
from ..voice_library import VoiceLibrary
from .routes.health import create_health_router
from .routes.metadata import create_metadata_router
from .routes.sample_processing import create_sample_processing_router
from .routes.speech import create_speech_router
from .routes.voices import create_voices_router


def create_app(
    settings: Settings | None = None,
    provider_registry: ProviderRegistry | None = None,
    voice_cache: VoiceCache | None = None,
    voice_library: VoiceLibrary | None = None,
    sample_processor: SampleProcessor | None = None,
    sample_processing_service: SampleProcessingService | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    resolved_cache = voice_cache or VoiceCache(resolved_settings.storage_dir / "voice-cache.json")
    resolved_provider_registry = provider_registry or ProviderRegistry([ElevenLabsProvider(resolved_settings)])
    resolved_library = voice_library or VoiceLibrary(resolved_settings)
    resolved_sample_processing = sample_processing_service or SampleProcessingService(
        resolved_settings,
        resolved_library,
        sample_processor,
    )

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

    app.include_router(create_health_router(resolved_settings, resolved_library, resolved_provider_registry))
    app.include_router(create_voices_router(resolved_library))
    app.include_router(create_sample_processing_router(resolved_sample_processing))
    app.include_router(create_metadata_router(resolved_settings, resolved_provider_registry))
    app.include_router(create_speech_router(resolved_settings, resolved_provider_registry, resolved_cache, resolved_library))
    return app


app = create_app()
