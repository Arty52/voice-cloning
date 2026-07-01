from __future__ import annotations

import logging

from .config import Settings
from .persistence.database import create_database_engine, create_session_factory
from .persistence.postgres_voice_library import PostgresVoiceLibrary
from .voice_library import VoiceLibrary, VoiceLibraryProtocol


logger = logging.getLogger(__name__)


def create_voice_library(settings: Settings) -> VoiceLibraryProtocol:
    if not settings.database_url:
        return VoiceLibrary(settings)

    engine = create_database_engine(settings.database_url)
    session_factory = create_session_factory(engine)
    library = PostgresVoiceLibrary(settings, session_factory)
    report = library.import_manifest()
    if report.total:
        logger.info(
            "Initialized Postgres voice library from manifest: imported=%s already_imported=%s renamed_conflicts=%s skipped_missing_files=%s default_voice_id=%s",
            report.imported,
            report.already_imported,
            report.renamed_conflicts,
            report.skipped_missing_files,
            report.default_voice_id,
        )
    return library
