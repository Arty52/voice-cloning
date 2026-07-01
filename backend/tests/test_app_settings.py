from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from voice_cloning.api import create_app
from voice_cloning.config import Settings
from voice_cloning.persistence.database import Base, create_database_engine, create_session_factory
from voice_cloning.services.app_settings import AppSettingsService


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
        generated_audio_storage_dir=tmp_path / "storage" / "generated-audio",
        sample_processing_dir=tmp_path / "storage" / "sample-processing",
        speech_jobs_dir=tmp_path / "storage" / "speech-jobs",
        cors_allowed_origins=["http://localhost:4340"],
    )


def make_client(tmp_path: Path) -> TestClient:
    engine = create_database_engine(f"sqlite+pysqlite:///{tmp_path / 'settings.db'}")
    Base.metadata.create_all(engine)
    service = AppSettingsService(create_session_factory(engine))
    return TestClient(create_app(settings=make_settings(tmp_path), app_settings_service=service))


def test_app_settings_roundtrips_allowlisted_preferences(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    response = client.put(
        "/api/settings",
        json={
            "settings": {
                "generatedAudioStorageLimit": {"limitBytes": 26214400},
                "naturalHandoffs": {"enabled": False},
                "selectedModelByProvider": {"elevenlabs": "eleven_flash_v2_5"},
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["settings"] == {
        "generatedAudioStorageLimit": {"limitBytes": 26214400},
        "naturalHandoffs": {"enabled": False},
        "selectedModelByProvider": {"elevenlabs": "eleven_flash_v2_5"},
    }
    assert client.get("/api/settings").json()["settings"]["selectedModelByProvider"] == {
        "elevenlabs": "eleven_flash_v2_5"
    }


def test_app_settings_rejects_unknown_or_secret_settings(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    unknown_response = client.put("/api/settings", json={"settings": {"theme": {"mode": "dark"}}})
    secret_response = client.put("/api/settings", json={"settings": {"providerApiKey": {"value": "secret"}}})

    assert unknown_response.status_code == 422
    assert secret_response.status_code == 422


def test_app_settings_returns_unavailable_without_database(tmp_path: Path) -> None:
    client = TestClient(create_app(settings=make_settings(tmp_path)))

    response = client.get("/api/settings")

    assert response.status_code == 503
    assert response.json()["detail"] == "App settings persistence is not configured."
