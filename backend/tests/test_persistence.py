from __future__ import annotations

from dataclasses import replace
import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, inspect, text
from sqlalchemy.engine import URL, make_url

from voice_cloning.config import Settings
from voice_cloning.models import (
    SampleProcessingJob,
    SampleProcessingJobStep,
    SampleProcessingResult,
    SpeechJob,
    SpeechJobSegment,
    VoiceAsset,
    VoiceProcessingStep,
    VoiceSample,
)
from voice_cloning.persistence.database import (
    Base,
    create_database_engine,
    create_session_factory,
    unit_of_work,
)
from voice_cloning.persistence.file_store import (
    FileStoreError,
    create_generated_audio_file_store,
)
from voice_cloning.persistence.jobs import (
    INTERRUPTED_MESSAGE,
    SqlAlchemySampleProcessingJobRepository,
    SqlAlchemySpeechGenerationJobRepository,
)
from voice_cloning.persistence.models import AppSettingRecord, SampleProcessingJobRecord, SpeechGenerationJobRecord
from voice_cloning.persistence.postgres_voice_library import PostgresVoiceLibrary
from voice_cloning.persistence.voices import SqlAlchemyVoiceRepository
from voice_cloning.samples import sample_hash
from voice_cloning.voice_library import VoiceLibrary
from voice_cloning.voice_library_factory import create_voice_library


def make_settings(tmp_path: Path) -> Settings:
    voice_assets_dir = tmp_path / "assets" / "voices"
    return Settings(
        app_root=tmp_path,
        elevenlabs_api_key="test-key",
        elevenlabs_api_base_url="https://api.elevenlabs.test/v1",
        elevenlabs_model_id="eleven_multilingual_v2",
        default_sample_path=voice_assets_dir / "default" / "default-voice.mp3",
        voice_assets_dir=voice_assets_dir,
        voice_manifest_path=voice_assets_dir / "voices.json",
        storage_dir=tmp_path / "storage",
        generated_audio_storage_dir=tmp_path / "runtime" / "generated-audio",
        sample_processing_dir=tmp_path / "storage" / "sample-processing",
        speech_jobs_dir=tmp_path / "storage" / "speech-jobs",
        cors_allowed_origins=["http://localhost:4340"],
    )


def test_settings_resolves_generated_audio_storage_dir_from_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("GENERATED_AUDIO_STORAGE_DIR", raising=False)

    settings = Settings.from_env()

    assert settings.generated_audio_storage_dir == tmp_path / "storage" / "generated-audio"
    assert settings.database_url == ""


def test_settings_uses_configured_generated_audio_storage_dir(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive_dir = tmp_path / "archive"
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("GENERATED_AUDIO_STORAGE_DIR", str(archive_dir))
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@localhost:5432/app")

    settings = Settings.from_env()

    assert settings.generated_audio_storage_dir == archive_dir
    assert settings.database_url == "postgresql+psycopg://user:pass@localhost:5432/app"


def test_settings_resolves_relative_storage_env_paths_from_app_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workdir = tmp_path / "backend"
    workdir.mkdir()
    monkeypatch.chdir(workdir)
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("GENERATED_AUDIO_STORAGE_DIR", "storage/generated-audio")

    settings = Settings.from_env()

    assert settings.generated_audio_storage_dir == tmp_path / "storage" / "generated-audio"


def test_create_app_creates_runtime_storage_roots(tmp_path: Path) -> None:
    from voice_cloning.api.app import create_app

    settings = make_settings(tmp_path)

    create_app(settings=settings)

    assert settings.voice_assets_dir.exists()
    assert settings.storage_dir.exists()
    assert settings.generated_audio_storage_dir.exists()


def test_generated_audio_file_store_resolves_paths_under_root(tmp_path: Path) -> None:
    store = create_generated_audio_file_store(tmp_path / "generated-audio")
    store.ensure_ready()

    assert store.resolve_path("2026/07/audio.mp3") == tmp_path / "generated-audio" / "2026" / "07" / "audio.mp3"


@pytest.mark.parametrize("relative_path", ["", "../outside.mp3", "/tmp/outside.mp3"])
def test_generated_audio_file_store_rejects_unsafe_paths(tmp_path: Path, relative_path: str) -> None:
    store = create_generated_audio_file_store(tmp_path / "generated-audio")

    with pytest.raises(FileStoreError):
        store.resolve_path(relative_path)


def test_unit_of_work_commits_and_rolls_back() -> None:
    engine = create_database_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)

    with unit_of_work(session_factory) as session:
        session.add(AppSettingRecord(key="theme", value={"mode": "dark"}))

    with session_factory() as session:
        assert session.get(AppSettingRecord, "theme") is not None

    with pytest.raises(RuntimeError):
        with unit_of_work(session_factory) as session:
            session.add(AppSettingRecord(key="failed", value={"mode": "light"}))
            raise RuntimeError("fail")

    with session_factory() as session:
        assert session.get(AppSettingRecord, "failed") is None


def test_job_repositories_persist_snapshots_and_mark_interrupted() -> None:
    engine = create_database_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    sample_job = SampleProcessingJob(
        id="sample-job",
        operation_id="trimSilence",
        status="pending",
        source_name="Narrator",
        source_filename="source.wav",
        source_content_type="audio/wav",
        source_sha256="source-hash",
        source_size_bytes=128,
        source_preference="active",
        created_at="2026-07-01T12:00:00+00:00",
        updated_at="2026-07-01T12:00:00+00:00",
        steps=(
            SampleProcessingJobStep(
                id="sample-job",
                operation_id="trimSilence",
                operation_label="Trim Silence",
                status="pending",
                engine="ffmpeg",
            ),
        ),
    )
    speech_job = SpeechJob(
        id="speech-job",
        status="running",
        text="Hello.",
        default_voice_id="default",
        segment_gap_ms=250,
        provider_id="elevenlabs",
        model_id="eleven_multilingual_v2",
        segments=(
            SpeechJobSegment(
                id="segment-one",
                index=0,
                text="Hello.",
                voice_id="default",
                voice_name="Default Voice",
                assignment_kind="default",
            ),
        ),
        created_at="2026-07-01T12:00:00+00:00",
        updated_at="2026-07-01T12:00:00+00:00",
    )

    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(sample_job)
        SqlAlchemySpeechGenerationJobRepository(session).save_job(speech_job)

    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).get_job("sample-job") == sample_job
        assert SqlAlchemySpeechGenerationJobRepository(session).get_job("speech-job") == speech_job
        assert session.get(SampleProcessingJobRecord, "sample-job").request_payload["operationId"] == "trimSilence"
        assert session.get(SpeechGenerationJobRecord, "speech-job").request_payload["modelId"] == "eleven_multilingual_v2"
        assert SqlAlchemySampleProcessingJobRepository(session).mark_active_jobs_interrupted() == 1
        assert SqlAlchemySpeechGenerationJobRepository(session).mark_active_jobs_interrupted() == 1

    with unit_of_work(session_factory) as session:
        sample_record = session.get(SampleProcessingJobRecord, "sample-job")
        speech_record = session.get(SpeechGenerationJobRecord, "speech-job")

        assert sample_record is not None
        assert sample_record.status == "interrupted"
        assert sample_record.error_message == INTERRUPTED_MESSAGE
        assert speech_record is not None
        assert speech_record.status == "interrupted"
        assert speech_record.error_message == INTERRUPTED_MESSAGE
        restored_sample_job = SqlAlchemySampleProcessingJobRepository(session).get_job("sample-job")
        restored_speech_job = SqlAlchemySpeechGenerationJobRepository(session).get_job("speech-job")

        assert restored_sample_job is not None
        assert restored_sample_job.status == "interrupted"
        assert restored_sample_job.error == INTERRUPTED_MESSAGE
        assert restored_speech_job is not None
        assert restored_speech_job.status == "interrupted"
        assert restored_speech_job.error == INTERRUPTED_MESSAGE


def test_job_routes_read_persisted_snapshots_after_app_recreation(tmp_path: Path) -> None:
    from voice_cloning.api.app import create_app

    database_path = tmp_path / "jobs.sqlite"
    database_url = f"sqlite+pysqlite:///{database_path}"
    settings = replace(make_settings(tmp_path), database_url=database_url)
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    sample_job = SampleProcessingJob(
        id="sample-job",
        operation_id="trimSilence",
        status="success",
        source_name="Narrator",
        source_filename="source.wav",
        source_content_type="audio/wav",
        source_sha256="source-hash",
        source_size_bytes=128,
        source_preference="active",
        created_at="2026-07-01T12:00:00+00:00",
        updated_at="2026-07-01T12:00:01+00:00",
        result=SampleProcessingResult(
            path="result.wav",
            filename="result.wav",
            content_type="audio/wav",
            sha256="result-hash",
        ),
        steps=(
            SampleProcessingJobStep(
                id="sample-job",
                operation_id="trimSilence",
                operation_label="Trim Silence",
                status="success",
                engine="ffmpeg",
            ),
        ),
    )
    speech_job = SpeechJob(
        id="speech-job",
        status="success",
        text="Hello.",
        default_voice_id="default",
        segment_gap_ms=250,
        provider_id="elevenlabs",
        model_id="eleven_multilingual_v2",
        result_sha256="speech-result-hash",
        segments=(
            SpeechJobSegment(
                id="segment-one",
                index=0,
                text="Hello.",
                voice_id="default",
                voice_name="Default Voice",
                assignment_kind="default",
                status="success",
                result_sha256="segment-hash",
            ),
        ),
        created_at="2026-07-01T12:00:00+00:00",
        updated_at="2026-07-01T12:00:01+00:00",
    )

    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(sample_job)
        SqlAlchemySpeechGenerationJobRepository(session).save_job(speech_job)

    client = TestClient(create_app(settings=settings))

    sample_response = client.get("/api/sample-processing/jobs/sample-job")
    speech_response = client.get("/api/speech/jobs/speech-job")

    assert sample_response.status_code == 200
    assert sample_response.json()["job"]["status"] == "success"
    assert sample_response.json()["job"]["result"]["sha256"] == "result-hash"
    assert speech_response.status_code == 200
    assert speech_response.json()["job"]["status"] == "success"
    assert speech_response.json()["job"]["resultSha256"] == "speech-result-hash"


def test_sqlalchemy_voice_repository_roundtrips_voice_asset() -> None:
    engine = create_database_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    step = VoiceProcessingStep(
        id="step-one",
        label="Prepare Voice",
        operation_id="prepareVoice",
        created_at="2026-07-01T12:00:00+00:00",
        source_sha256="source",
        result_sha256="result",
        engine="ffmpeg",
        processing_preset_id="trimBalanced",
        processing_preset_label="Balanced",
    )
    asset = VoiceAsset(
        id="narrator",
        name="Narrator",
        file_path="narrator.wav",
        content_type="audio/wav",
        sha256="abc123",
        source="upload",
        created_at="2026-07-01T12:00:00+00:00",
        voice_preset_id="animatedDialogue",
        voice_settings_by_provider={"elevenlabs": {"speed": 1.05}},
        processing_steps=(step,),
    )

    with unit_of_work(session_factory) as session:
        repository = SqlAlchemyVoiceRepository(session)
        repository.save_asset(asset)
        repository.set_default_voice_id(asset.id)

    with unit_of_work(session_factory) as session:
        repository = SqlAlchemyVoiceRepository(session)
        stored = repository.get_asset("narrator")

    assert stored == asset


def test_create_voice_library_uses_manifest_when_database_url_is_blank(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)

    voice_library = create_voice_library(settings)

    assert type(voice_library) is VoiceLibrary


def test_postgres_voice_library_imports_manifest_idempotently(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    library = make_postgres_voice_library(settings)
    write_manifest_voice(settings, "narrator", b"voice-one")

    first_report = library.import_manifest()
    second_report = library.import_manifest()

    assert first_report.imported == 1
    assert first_report.default_voice_id == "narrator"
    assert second_report.already_imported == 1
    assert library.list_payload()["defaultVoiceId"] == "narrator"
    assert [voice["id"] for voice in library.list_payload()["voices"]] == ["narrator"]


def test_postgres_voice_library_import_renames_hash_conflict(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    library = make_postgres_voice_library(settings)
    write_manifest_voice(settings, "narrator", b"voice-one")
    existing = VoiceAsset(
        id="narrator",
        name="Existing Narrator",
        file_path="existing.wav",
        content_type="audio/wav",
        sha256="different",
        source="upload",
        created_at="2026-07-01T12:00:00+00:00",
    )
    (settings.voice_assets_dir / "existing.wav").write_bytes(b"old")
    with unit_of_work(library.session_factory) as session:
        SqlAlchemyVoiceRepository(session).save_asset(existing)

    report = library.import_manifest()

    renamed_id = f"narrator-import-{sample_hash(b'voice-one')[:8]}"
    assert report.renamed_conflicts == 1
    assert report.default_voice_id == renamed_id
    assert sorted(asset.id for asset in library.list_assets()) == ["narrator", renamed_id]
    assert (settings.voice_assets_dir / f"{renamed_id}.mp3").read_bytes() == b"voice-one"

    library.update_asset(renamed_id, name="Edited Import")
    second_report = library.import_manifest()

    assert second_report.already_imported == 1
    assert library.get_asset(renamed_id).name == "Edited Import"


def test_postgres_voice_library_import_drops_conflict_source_path_outside_assets(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    library = make_postgres_voice_library(settings)
    secret_path = tmp_path / "secret.wav"
    secret_path.write_bytes(b"secret")
    write_manifest_voice(
        settings,
        "narrator",
        b"voice-one",
        extra_voice_fields={
            "sourceFilePath": "../../secret.wav",
            "sourceContentType": "audio/wav",
            "sourceSha256": sample_hash(b"secret"),
        },
    )
    existing = VoiceAsset(
        id="narrator",
        name="Existing Narrator",
        file_path="existing.wav",
        content_type="audio/wav",
        sha256="different",
        source="upload",
        created_at="2026-07-01T12:00:00+00:00",
    )
    (settings.voice_assets_dir / "existing.wav").write_bytes(b"old")
    with unit_of_work(library.session_factory) as session:
        SqlAlchemyVoiceRepository(session).save_asset(existing)

    library.import_manifest()

    renamed_id = f"narrator-import-{sample_hash(b'voice-one')[:8]}"
    imported = library.get_asset(renamed_id)
    assert imported.source_file_path is None
    assert imported.source_content_type is None
    assert imported.source_sha256 is None
    assert secret_path.read_bytes() == b"secret"


def test_postgres_voice_library_import_preserves_database_default(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    library = make_postgres_voice_library(settings)
    write_manifest_voice(settings, "narrator", b"voice-one")
    library.import_manifest()
    other = library.add_processed_sample(
        "Other Voice",
        VoiceSample(content=b"voice-two", filename="other.wav", content_type="audio/wav", sha256=sample_hash(b"voice-two")),
        (),
    )
    library.set_default(other.id)

    report = library.import_manifest()

    assert report.already_imported == 1
    assert report.default_voice_id == other.id
    assert library.list_payload()["defaultVoiceId"] == other.id


def test_postgres_voice_library_removes_staged_file_when_create_move_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import voice_cloning.persistence.postgres_voice_library as postgres_voice_library

    settings = make_settings(tmp_path)
    library = make_postgres_voice_library(settings)

    def fail_move(_source: str, _destination: str) -> None:
        raise RuntimeError("move failed")

    monkeypatch.setattr(postgres_voice_library.shutil, "move", fail_move)

    with pytest.raises(RuntimeError, match="move failed"):
        library.add_processed_sample(
            "Narrator",
            VoiceSample(
                content=b"voice-one",
                filename="narrator.wav",
                content_type="audio/wav",
                sha256=sample_hash(b"voice-one"),
            ),
            (),
        )

    assert [path for path in (settings.voice_assets_dir / ".staged").glob("**/*") if path.is_file()] == []


def test_sqlalchemy_voice_repository_lists_processing_steps_without_n_plus_one_queries() -> None:
    engine = create_database_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    step = VoiceProcessingStep(
        id="trim",
        label="Trim Silence",
        operation_id="trimSilence",
        created_at="2026-07-01T12:00:00+00:00",
        source_sha256="source",
        result_sha256="result",
        engine="ffmpeg",
    )
    with unit_of_work(session_factory) as session:
        repository = SqlAlchemyVoiceRepository(session)
        repository.save_asset(
            VoiceAsset(
                id="first",
                name="First",
                file_path="first.wav",
                content_type="audio/wav",
                sha256="first",
                source="upload",
                created_at="2026-07-01T12:00:00+00:00",
                processing_steps=(step,),
            )
        )
        repository.save_asset(
            VoiceAsset(
                id="second",
                name="Second",
                file_path="second.wav",
                content_type="audio/wav",
                sha256="second",
                source="upload",
                created_at="2026-07-01T12:00:01+00:00",
                processing_steps=(step,),
            )
        )

    select_count = 0

    def count_selects(_connection: object, _cursor: object, statement: str, *_args: object) -> None:
        nonlocal select_count
        if statement.lstrip().lower().startswith("select"):
            select_count += 1

    event.listen(engine, "before_cursor_execute", count_selects)
    try:
        with unit_of_work(session_factory) as session:
            assets = SqlAlchemyVoiceRepository(session).list_assets()
    finally:
        event.remove(engine, "before_cursor_execute", count_selects)

    assert [asset.id for asset in assets] == ["first", "second"]
    assert [len(asset.processing_steps) for asset in assets] == [1, 1]
    assert select_count == 2


def test_postgres_voice_library_restores_file_when_delete_rolls_back(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = make_settings(tmp_path)
    library = make_postgres_voice_library(settings)
    asset = library.add_processed_sample(
        "Narrator",
        VoiceSample(content=b"voice-one", filename="narrator.wav", content_type="audio/wav", sha256=sample_hash(b"voice-one")),
        (),
    )
    asset_path = library.resolve_asset_path(asset)
    original_delete = SqlAlchemyVoiceRepository.delete_asset

    def fail_delete(self: SqlAlchemyVoiceRepository, voice_id: str) -> None:
        original_delete(self, voice_id)
        raise RuntimeError("database failure")

    monkeypatch.setattr(SqlAlchemyVoiceRepository, "delete_asset", fail_delete)

    with pytest.raises(RuntimeError):
        library.delete_asset(asset.id)

    assert asset_path.exists()
    assert library.get_asset(asset.id).id == asset.id


def test_voice_routes_use_postgres_voice_library(tmp_path: Path) -> None:
    from voice_cloning.api.app import create_app

    settings = make_settings(tmp_path)
    library = make_postgres_voice_library(settings)
    library.add_processed_sample(
        "Narrator",
        VoiceSample(content=b"voice-one", filename="narrator.wav", content_type="audio/wav", sha256=sample_hash(b"voice-one")),
        (),
    )
    client = TestClient(create_app(settings=settings, voice_library=library))

    response = client.get("/api/voices")

    assert response.status_code == 200
    assert response.json()["defaultVoiceId"] == "narrator"
    assert response.json()["voices"][0]["id"] == "narrator"


def make_postgres_voice_library(settings: Settings) -> PostgresVoiceLibrary:
    database_path = settings.app_root / f"test-{uuid4().hex}.db"
    engine = create_database_engine(f"sqlite+pysqlite:///{database_path}")
    Base.metadata.create_all(engine)
    return PostgresVoiceLibrary(settings, create_session_factory(engine))


def write_manifest_voice(
    settings: Settings,
    voice_id: str,
    content: bytes,
    *,
    extra_voice_fields: dict[str, object] | None = None,
) -> None:
    settings.voice_assets_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{voice_id}.mp3"
    (settings.voice_assets_dir / filename).write_bytes(content)
    payload = {
        "version": 1,
        "defaultVoiceId": voice_id,
        "voices": [
            {
                "id": voice_id,
                "name": "Narrator",
                "filePath": filename,
                "contentType": "audio/mpeg",
                "sha256": sample_hash(content),
                "source": "upload",
                "createdAt": "2026-07-01T12:00:00+00:00",
                **(extra_voice_fields or {}),
            }
        ],
    }
    settings.voice_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    settings.voice_manifest_path.write_text(json.dumps(payload), encoding="utf-8")


@pytest.mark.postgres
def test_postgres_migrations_upgrade_to_head() -> None:
    from alembic import command
    from alembic.config import Config

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("DATABASE_URL is required for Postgres migration tests.")

    url = make_url(database_url)
    if url.get_backend_name() != "postgresql":
        pytest.skip("Postgres migration tests require a postgresql DATABASE_URL.")

    alembic_config = Config("alembic.ini")
    alembic_config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(alembic_config, "head")
    command.check(alembic_config)

    engine = create_database_engine(database_url)
    with engine.connect() as connection:
        table_names = set(inspect(connection).get_table_names())
        version = connection.execute(text("select version_num from alembic_version")).scalar_one()

    assert version == "202607010001"
    assert {
        "voices",
        "voice_processing_steps",
        "voice_library_state",
        "voice_tuning_presets",
        "generated_audio",
        "app_settings",
        "sample_processing_jobs",
        "speech_generation_jobs",
    }.issubset(table_names)


@pytest.mark.postgres
def test_postgres_migrations_roundtrip_on_disposable_database() -> None:
    from alembic import command
    from alembic.config import Config

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("DATABASE_URL is required for Postgres migration tests.")

    url = make_url(database_url)
    if url.get_backend_name() != "postgresql":
        pytest.skip("Postgres migration tests require a postgresql DATABASE_URL.")

    admin_url = url.set(database="postgres")
    roundtrip_database = f"voice_cloning_migration_test_{uuid4().hex[:16]}"
    roundtrip_url = url.set(database=roundtrip_database)
    admin_engine = create_database_engine(_url_string(admin_url))
    roundtrip_engine = None

    try:
        with admin_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f'CREATE DATABASE "{roundtrip_database}"'))

        alembic_config = Config("alembic.ini")
        alembic_config.set_main_option("sqlalchemy.url", _url_string(roundtrip_url).replace("%", "%%"))
        command.upgrade(alembic_config, "head")
        command.downgrade(alembic_config, "base")
        command.upgrade(alembic_config, "head")

        roundtrip_engine = create_database_engine(_url_string(roundtrip_url))
        with roundtrip_engine.connect() as connection:
            table_names = set(inspect(connection).get_table_names())
            version = connection.execute(text("select version_num from alembic_version")).scalar_one()

        assert version == "202607010001"
        assert "voices" in table_names
        assert "generated_audio" in table_names
    finally:
        if roundtrip_engine is not None:
            roundtrip_engine.dispose()
        with admin_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{roundtrip_database}" WITH (FORCE)'))
        admin_engine.dispose()


def _url_string(url: URL) -> str:
    return url.render_as_string(hide_password=False)
