from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from voice_cloning.api import create_app
from voice_cloning.config import Settings
from voice_cloning.persistence.database import Base, create_database_engine, create_session_factory
from voice_cloning.persistence.tuning_presets import SqlAlchemyVoiceTuningPresetRepository, VoiceTuningPreset


def make_settings(tmp_path: Path, database_url: str = "") -> Settings:
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
        database_url=database_url,
    )


def make_client(tmp_path: Path) -> TestClient:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'presets.db'}"
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    return TestClient(create_app(settings=make_settings(tmp_path, database_url=database_url)))


def test_voice_tuning_preset_repository_roundtrips_records(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite+pysqlite:///{tmp_path / 'repository.db'}")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    preset = VoiceTuningPreset(
        id="narration",
        name="Narration",
        provider_id="elevenlabs",
        voice_preset_id="standardNarration",
        settings={"stability": 0.5},
        created_at="2026-07-01T12:00:00+00:00",
        updated_at="2026-07-01T12:00:00+00:00",
    )

    with session_factory() as session:
        repository = SqlAlchemyVoiceTuningPresetRepository(session)
        repository.save(preset)
        session.commit()

    with session_factory() as session:
        repository = SqlAlchemyVoiceTuningPresetRepository(session)
        assert repository.get("narration") == preset
        assert repository.list_presets() == [preset]
        assert repository.delete("narration") is True
        assert repository.delete("missing") is False


def test_voice_tuning_preset_routes_crud_user_presets(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    create_response = client.post(
        "/api/voice-tuning-presets",
        json={
            "id": "warm-narration",
            "name": "Warm Narration",
            "providerId": "elevenlabs",
            "voicePresetId": "standardNarration",
            "settings": {"stability": 0.42, "speed": 0.95},
        },
    )

    assert create_response.status_code == 201
    preset = create_response.json()["preset"]
    assert preset["id"] == "warm-narration"
    assert preset["name"] == "Warm Narration"
    assert preset["providerId"] == "elevenlabs"
    assert preset["voicePresetId"] == "standardNarration"
    assert preset["settings"]["stability"] == 0.42
    assert preset["settings"]["speed"] == 0.95
    assert "createdAt" in preset
    assert "updatedAt" in preset

    list_response = client.get("/api/voice-tuning-presets")
    assert list_response.status_code == 200
    assert list_response.json()["presets"][0]["id"] == "warm-narration"

    update_response = client.put(
        "/api/voice-tuning-presets/warm-narration",
        json={
            "name": "Animated Read",
            "providerId": "elevenlabs",
            "voicePresetId": "animatedDialogue",
            "settings": {"stability": 0.35, "style": 0.2},
        },
    )

    assert update_response.status_code == 200
    updated = update_response.json()["preset"]
    assert updated["id"] == "warm-narration"
    assert updated["name"] == "Animated Read"
    assert updated["voicePresetId"] == "animatedDialogue"
    assert updated["settings"]["style"] == 0.2

    delete_response = client.delete("/api/voice-tuning-presets/warm-narration")
    assert delete_response.status_code == 200
    assert delete_response.json() == {"deleted": True}
    assert client.get("/api/voice-tuning-presets").json()["presets"] == []


def test_voice_tuning_preset_routes_reject_conflicts_and_invalid_payloads(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    payload = {
        "id": "duplicate",
        "name": "Duplicate",
        "providerId": "elevenlabs",
        "settings": {"stability": 0.5},
    }

    assert client.post("/api/voice-tuning-presets", json=payload).status_code == 201
    conflict_response = client.post("/api/voice-tuning-presets", json=payload)
    unsupported_setting_response = client.post(
        "/api/voice-tuning-presets",
        json={
            "id": "unsupported",
            "name": "Unsupported",
            "providerId": "elevenlabs",
            "settings": {"unknownControl": 1},
        },
    )
    secret_response = client.post(
        "/api/voice-tuning-presets",
        json={
            "id": "secret",
            "name": "Secret",
            "providerId": "elevenlabs",
            "settings": {"apiKey": "not-allowed"},
        },
    )
    provider_response = client.post(
        "/api/voice-tuning-presets",
        json={
            "id": "bad-provider",
            "name": "Bad Provider",
            "providerId": "missing",
            "settings": {"stability": 0.5},
        },
    )
    voice_preset_response = client.post(
        "/api/voice-tuning-presets",
        json={
            "id": "bad-voice-preset",
            "name": "Bad Voice Preset",
            "providerId": "elevenlabs",
            "voicePresetId": "dramatic",
            "settings": {"stability": 0.5},
        },
    )

    assert conflict_response.status_code == 409
    assert unsupported_setting_response.status_code == 422
    assert secret_response.status_code == 422
    assert provider_response.status_code == 404
    assert voice_preset_response.status_code == 422


def test_voice_tuning_preset_routes_reject_update_id_mismatch(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    assert (
        client.post(
            "/api/voice-tuning-presets",
            json={
                "id": "warm-narration",
                "name": "Warm Narration",
                "providerId": "elevenlabs",
                "settings": {"stability": 0.5},
            },
        ).status_code
        == 201
    )

    response = client.put(
        "/api/voice-tuning-presets/warm-narration",
        json={
            "id": "other-preset",
            "name": "Other Preset",
            "providerId": "elevenlabs",
            "settings": {"stability": 0.45},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Voice tuning preset id must match the path id."


def test_voice_tuning_preset_routes_return_unavailable_without_database(tmp_path: Path) -> None:
    client = TestClient(create_app(settings=make_settings(tmp_path)))

    response = client.get("/api/voice-tuning-presets")

    assert response.status_code == 503
    assert response.json()["detail"] == "Voice tuning preset persistence is not configured."
