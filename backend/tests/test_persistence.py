from __future__ import annotations

from pathlib import Path

import pytest

from voice_cloning.api.app import create_app
from voice_cloning.config import Settings
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
from voice_cloning.persistence.models import AppSettingRecord


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


def test_create_app_creates_runtime_storage_roots(tmp_path: Path) -> None:
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
