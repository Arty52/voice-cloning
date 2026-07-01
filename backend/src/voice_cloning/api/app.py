from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..cache import VoiceCache
from ..config import Settings
from ..elevenlabs_client import ElevenLabsProvider
from ..persistence.database import SessionFactory, create_database_engine, create_session_factory
from ..persistence.file_store import create_generated_audio_file_store
from ..providers import ProviderRegistry
from ..sample_processors import create_sample_processor
from ..services.app_settings import AppSettingsService
from ..services.generated_audio_archive import GeneratedAudioArchiveService
from ..services.media_sources import SampleProcessingMediaSourceService
from ..services.sample_processing import SampleProcessingService, SampleProcessor
from ..services.speech_jobs import SpeechJobService
from ..services.voice_ingestion import VoiceIngestionService
from ..voice_library import VoiceLibraryProtocol
from ..voice_library_factory import create_voice_library
from .routes.health import create_health_router
from .routes.generated_audio import create_generated_audio_router
from .routes.metadata import create_metadata_router
from .routes.sample_processing import create_sample_processing_router
from .routes.sample_processing_sources import create_sample_processing_sources_router
from .routes.settings import create_settings_router
from .routes.speech import create_speech_router
from .routes.speech_jobs import create_speech_jobs_router
from .routes.voices import create_voices_router


def create_app(
    settings: Settings | None = None,
    provider_registry: ProviderRegistry | None = None,
    voice_cache: VoiceCache | None = None,
    voice_library: VoiceLibraryProtocol | None = None,
    voice_ingestion_service: VoiceIngestionService | None = None,
    sample_processor: SampleProcessor | None = None,
    sample_processing_media_source_service: SampleProcessingMediaSourceService | None = None,
    sample_processing_service: SampleProcessingService | None = None,
    speech_job_service: SpeechJobService | None = None,
    generated_audio_archive_service: GeneratedAudioArchiveService | None = None,
    app_settings_service: AppSettingsService | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    resolved_settings.ensure_runtime_directories()
    resolved_cache = voice_cache or VoiceCache(resolved_settings.storage_dir / "voice-cache.json")
    job_session_factory = _create_database_session_factory(resolved_settings)
    resolved_provider_registry = provider_registry or ProviderRegistry([ElevenLabsProvider(resolved_settings)])
    resolved_library = voice_library or create_voice_library(resolved_settings)
    resolved_voice_ingestion = voice_ingestion_service or VoiceIngestionService(resolved_settings, resolved_library)
    resolved_sample_processing_media_sources = (
        sample_processing_media_source_service or SampleProcessingMediaSourceService(resolved_settings)
    )
    resolved_sample_processing = sample_processing_service or SampleProcessingService(
        resolved_settings,
        resolved_library,
        sample_processor or create_sample_processor(resolved_settings),
        media_source_service=resolved_sample_processing_media_sources,
        job_session_factory=job_session_factory,
    )
    resolved_speech_jobs = speech_job_service or SpeechJobService(
        resolved_settings,
        resolved_cache,
        resolved_library,
        job_session_factory=job_session_factory,
    )
    resolved_generated_audio_archive = generated_audio_archive_service or _create_generated_audio_archive_service(
        resolved_settings
    )
    resolved_app_settings = app_settings_service or _create_app_settings_service(resolved_settings)

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
    app.include_router(create_voices_router(resolved_library, resolved_provider_registry, resolved_voice_ingestion))
    app.include_router(create_sample_processing_sources_router(resolved_sample_processing_media_sources))
    app.include_router(create_sample_processing_router(resolved_sample_processing))
    app.include_router(create_metadata_router(resolved_settings, resolved_provider_registry))
    app.include_router(create_speech_jobs_router(resolved_provider_registry, resolved_speech_jobs))
    app.include_router(create_speech_router(resolved_settings, resolved_provider_registry, resolved_cache, resolved_library))
    app.include_router(create_generated_audio_router(resolved_generated_audio_archive))
    app.include_router(create_settings_router(resolved_app_settings))
    return app


def _create_generated_audio_archive_service(settings: Settings) -> GeneratedAudioArchiveService | None:
    if not settings.database_url:
        return None
    engine = create_database_engine(settings.database_url)
    session_factory = create_session_factory(engine)
    file_store = create_generated_audio_file_store(settings.generated_audio_storage_dir)
    return GeneratedAudioArchiveService(session_factory, file_store)


def _create_app_settings_service(settings: Settings) -> AppSettingsService | None:
    if not settings.database_url:
        return None
    engine = create_database_engine(settings.database_url)
    session_factory = create_session_factory(engine)
    return AppSettingsService(session_factory)


def _create_database_session_factory(settings: Settings) -> SessionFactory | None:
    if not settings.database_url:
        return None
    engine = create_database_engine(settings.database_url)
    return create_session_factory(engine)


app = create_app()
