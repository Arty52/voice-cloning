from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from voice_cloning.config import Settings
from voice_cloning.persistence.database import Base, create_database_engine, create_session_factory
from voice_cloning.persistence.file_store import create_generated_audio_file_store
from voice_cloning.persistence.generated_audio import SqlAlchemyGeneratedAudioRepository
from voice_cloning.services.generated_audio_archive import GeneratedAudioArchiveService


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


def make_archive_service(tmp_path: Path) -> GeneratedAudioArchiveService:
    engine = create_database_engine(f"sqlite+pysqlite:///{tmp_path / f'archive-{uuid4().hex}.db'}")
    Base.metadata.create_all(engine)
    return GeneratedAudioArchiveService(
        create_session_factory(engine),
        create_generated_audio_file_store(tmp_path / "archive"),
    )


def make_client(tmp_path: Path) -> TestClient:
    from voice_cloning.api.app import create_app

    settings = make_settings(tmp_path)
    service = make_archive_service(tmp_path)
    return TestClient(create_app(settings=settings, generated_audio_archive_service=service))


def audio_files(content: bytes = b"fake-mp3") -> dict[str, tuple[str, bytes, str]]:
    return {"audioFile": ("voice.mp3", content, "audio/mpeg")}


def test_generated_audio_archive_routes_save_stream_and_delete(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    save_response = client.post(
        "/api/generated-audio",
        data={
            "id": "audio-one",
            "createdAt": "2026-07-01T12:00:00+00:00",
            "cacheState": "miss",
            "voiceId": "provider-voice",
            "appVoiceId": "narrator",
            "voiceName": "Narrator",
            "modelId": "eleven_multilingual_v2",
            "characterCount": "10",
            "requestId": "req_123",
            "generationElapsedMs": "1234",
            "tuningMetadata": '{"mode":"default","presetId":null,"adjustedSettings":[]}',
        },
        files=audio_files(),
    )

    assert save_response.status_code == 200
    assert save_response.json()["item"]["id"] == "audio-one"
    assert save_response.json()["item"]["audioUrl"] == "/api/generated-audio/audio-one/audio"
    assert save_response.json()["usage"] == {
        "itemCount": 1,
        "limitBytes": 100 * 1024 * 1024,
        "remainingBytes": 100 * 1024 * 1024 - len(b"fake-mp3"),
        "usedBytes": len(b"fake-mp3"),
    }

    list_response = client.get("/api/generated-audio")
    stream_response = client.get("/api/generated-audio/audio-one/audio")
    delete_response = client.delete("/api/generated-audio/audio-one")

    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["voiceName"] == "Narrator"
    assert stream_response.status_code == 200
    assert stream_response.content == b"fake-mp3"
    assert delete_response.status_code == 200
    assert delete_response.json()["usage"]["itemCount"] == 0
    assert client.get("/api/generated-audio").json()["items"] == []


def test_generated_audio_archive_save_is_idempotent_by_id_and_hash(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    first_response = client.post("/api/generated-audio", data={"id": "audio-one"}, files=audio_files(b"same"))
    retry_response = client.post("/api/generated-audio", data={"id": "audio-one"}, files=audio_files(b"same"))
    conflict_response = client.post("/api/generated-audio", data={"id": "audio-one"}, files=audio_files(b"different"))

    assert first_response.status_code == 200
    assert retry_response.status_code == 200
    assert retry_response.json()["alreadyExisted"] is True
    assert conflict_response.status_code == 409
    assert len(client.get("/api/generated-audio").json()["items"]) == 1


def test_generated_audio_archive_save_failure_does_not_delete_existing_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from voice_cloning.api.app import create_app

    service = make_archive_service(tmp_path)
    client = TestClient(create_app(settings=make_settings(tmp_path), generated_audio_archive_service=service))
    first_response = client.post("/api/generated-audio", data={"id": "audio-one"}, files=audio_files(b"fake-mp3"))
    assert first_response.status_code == 200
    item = service.get_item("audio-one")
    path = service.resolve_audio_path(item)

    def collide_with_existing_path(*_args: object) -> str:
        return item.file_path

    def fail_save(self: SqlAlchemyGeneratedAudioRepository, _metadata: object) -> None:
        raise RuntimeError("database failure")

    monkeypatch.setattr(service, "_relative_audio_path", collide_with_existing_path)
    monkeypatch.setattr(SqlAlchemyGeneratedAudioRepository, "save", fail_save)

    with pytest.raises(RuntimeError, match="database failure"):
        client.post("/api/generated-audio", data={"id": "audio-two"}, files=audio_files(b"new-mp3"))

    assert path.read_bytes() == b"fake-mp3"
    assert service.get_item("audio-one").id == "audio-one"


def test_generated_audio_archive_storage_limit_prunes_oldest(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    limit_response = client.put("/api/generated-audio/storage-limit", json={"limitBytes": 6, "prune": True})
    first_response = client.post(
        "/api/generated-audio",
        data={"id": "oldest", "createdAt": "2026-07-01T12:00:00+00:00"},
        files=audio_files(b"1234"),
    )
    second_response = client.post(
        "/api/generated-audio",
        data={"id": "newest", "createdAt": "2026-07-01T12:01:00+00:00"},
        files=audio_files(b"5678"),
    )

    assert limit_response.status_code == 200
    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["prunedIds"] == ["oldest"]
    assert [item["id"] for item in client.get("/api/generated-audio").json()["items"]] == ["newest"]


def test_generated_audio_archive_delete_restores_file_when_database_rolls_back(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from voice_cloning.api.app import create_app

    service = make_archive_service(tmp_path)
    client = TestClient(create_app(settings=make_settings(tmp_path), generated_audio_archive_service=service))
    save_response = client.post("/api/generated-audio", data={"id": "audio-one"}, files=audio_files(b"fake-mp3"))
    assert save_response.status_code == 200
    item = service.get_item("audio-one")
    path = service.resolve_audio_path(item)
    original_delete = SqlAlchemyGeneratedAudioRepository.delete

    def fail_delete(self: SqlAlchemyGeneratedAudioRepository, audio_id: str) -> None:
        original_delete(self, audio_id)
        raise RuntimeError("database failure")

    monkeypatch.setattr(SqlAlchemyGeneratedAudioRepository, "delete", fail_delete)

    with pytest.raises(RuntimeError):
        service.delete("audio-one")

    assert path.exists()
    assert service.get_item("audio-one").id == "audio-one"


def test_generated_audio_archive_routes_return_503_without_database(tmp_path: Path) -> None:
    from voice_cloning.api.app import create_app

    client = TestClient(create_app(settings=make_settings(tmp_path)))

    response = client.get("/api/generated-audio")

    assert response.status_code == 503
    assert response.json()["detail"] == "Generated audio archive persistence is not configured."
