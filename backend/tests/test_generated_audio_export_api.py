from __future__ import annotations

import hashlib
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from voice_cloning.api.app import create_app
from voice_cloning.config import Settings
from voice_cloning.persistence.database import Base, create_database_engine, create_session_factory, unit_of_work
from voice_cloning.persistence.file_store import create_generated_audio_file_store
from voice_cloning.persistence.models import GeneratedAudioRecord
from voice_cloning.services.generated_audio_archive import GeneratedAudioArchiveService
from voice_cloning.services.generated_audio_export import (
    ARCHIVE_ROOT_NAME,
    GeneratedAudioExportService,
    create_local_archive_export_target,
)


def make_settings(tmp_path: Path, *, export_dir: Path | None = None) -> Settings:
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
        generated_audio_export_dir=export_dir,
        sample_processing_dir=tmp_path / "storage" / "sample-processing",
        speech_jobs_dir=tmp_path / "storage" / "speech-jobs",
        cors_allowed_origins=["http://localhost:4340"],
    )


def make_services(tmp_path: Path, *, export_dir: Path | None) -> tuple[GeneratedAudioArchiveService, GeneratedAudioExportService]:
    engine = create_database_engine(f"sqlite+pysqlite:///{tmp_path / f'archive-{uuid4().hex}.db'}")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    archive_service = GeneratedAudioArchiveService(
        session_factory,
        create_generated_audio_file_store(tmp_path / "archive"),
    )
    return archive_service, GeneratedAudioExportService(
        session_factory,
        archive_service,
        create_local_archive_export_target(export_dir),
    )


def make_client(tmp_path: Path, *, export_dir: Path | None = None) -> tuple[TestClient, GeneratedAudioArchiveService]:
    archive_service, export_service = make_services(tmp_path, export_dir=export_dir)
    client = TestClient(
        create_app(
            settings=make_settings(tmp_path, export_dir=export_dir),
            generated_audio_archive_service=archive_service,
            generated_audio_export_service=export_service,
        )
    )
    return client, archive_service


def audio_files(
    content: bytes = b"fake-mp3",
    *,
    content_type: str = "audio/mpeg",
    filename: str = "voice.mp3",
) -> dict[str, tuple[str, bytes, str]]:
    return {"audioFile": (filename, content, content_type)}


def save_audio(client: TestClient, audio_id: str, content: bytes = b"fake-mp3") -> None:
    response = client.post(
        "/api/generated-audio",
        data={
            "id": audio_id,
            "createdAt": "2026-07-01T18:45:22+00:00",
            "cacheState": "miss",
            "voiceId": "provider-voice",
            "appVoiceId": "default",
            "voiceName": "Default Voice",
            "modelId": "eleven_multilingual_v2",
        },
        files=audio_files(content),
    )
    assert response.status_code == 200


def test_generated_audio_export_routes_return_503_without_archive(tmp_path: Path) -> None:
    client = TestClient(create_app(settings=make_settings(tmp_path, export_dir=tmp_path / "exports")))

    status_response = client.get("/api/generated-audio/export-status")
    export_response = client.post("/api/generated-audio/export-all")

    assert status_response.status_code == 503
    assert status_response.json()["detail"] == "Generated audio archive persistence is not configured."
    assert export_response.status_code == 503


def test_generated_audio_export_status_reports_unconfigured_export_dir(tmp_path: Path) -> None:
    client, _service = make_client(tmp_path, export_dir=None)
    save_audio(client, "audio-one")

    status_response = client.get("/api/generated-audio/export-status")
    export_response = client.post("/api/generated-audio/audio-one/export")

    assert status_response.status_code == 200
    assert status_response.json() == {"available": False, "items": [], "targetId": None}
    assert export_response.status_code == 503
    assert export_response.json()["detail"] == "Generated audio export directory is not configured."


def test_generated_audio_export_missing_audio_returns_404(tmp_path: Path) -> None:
    client, _service = make_client(tmp_path, export_dir=tmp_path / "exports")

    response = client.post("/api/generated-audio/missing-audio/export")

    assert response.status_code == 404
    assert response.json()["detail"] == "Generated audio was not found."


def test_generated_audio_export_route_writes_audio_sidecar_index_and_status(tmp_path: Path) -> None:
    export_dir = tmp_path / "exports"
    client, _service = make_client(tmp_path, export_dir=export_dir)
    save_audio(client, "audio-one")

    export_response = client.post("/api/generated-audio/audio-one/export")
    status_response = client.get("/api/generated-audio/export-status")

    assert export_response.status_code == 200
    payload = export_response.json()
    assert payload["alreadyExported"] is False
    assert payload["item"]["status"] == "exported"
    assert payload["item"]["filename"].startswith("generated-audio/2026/07/")
    assert "/Users/" not in payload["item"]["filename"]
    assert status_response.json()["available"] is True
    assert status_response.json()["items"][0]["audioId"] == "audio-one"

    archive_root = export_dir / ARCHIVE_ROOT_NAME
    audio_path = archive_root / payload["item"]["filename"]
    sidecar_path = audio_path.with_suffix(".json")
    index_path = archive_root / "index" / "generated-audio.jsonl"
    assert audio_path.read_bytes() == b"fake-mp3"
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert sidecar["id"] == "audio-one"
    assert "filePath" not in sidecar
    assert json.loads(index_path.read_text(encoding="utf-8").splitlines()[0])["id"] == "audio-one"


def test_generated_audio_export_all_exports_all_items(tmp_path: Path) -> None:
    client, _service = make_client(tmp_path, export_dir=tmp_path / "exports")
    save_audio(client, "audio-one")
    save_audio(client, "audio-two", b"other-mp3")

    response = client.post("/api/generated-audio/export-all")

    assert response.status_code == 200
    assert response.json()["exportedCount"] == 2
    assert response.json()["failedCount"] == 0
    assert {item["audioId"] for item in response.json()["items"]} == {"audio-one", "audio-two"}


def test_generated_audio_export_is_idempotent_for_same_audio_hash(tmp_path: Path) -> None:
    export_dir = tmp_path / "exports"
    client, _service = make_client(tmp_path, export_dir=export_dir)
    save_audio(client, "audio-one")

    first_response = client.post("/api/generated-audio/audio-one/export")
    first_payload = first_response.json()
    archive_root = export_dir / ARCHIVE_ROOT_NAME
    sidecar_path = (archive_root / str(first_payload["item"]["filename"])).with_suffix(".json")
    index_path = archive_root / "index" / "generated-audio.jsonl"
    first_sidecar = sidecar_path.read_text(encoding="utf-8")
    first_index = index_path.read_text(encoding="utf-8")
    second_response = client.post("/api/generated-audio/audio-one/export")
    status_response = client.get("/api/generated-audio/export-status")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["alreadyExported"] is True
    assert len(status_response.json()["items"]) == 1
    assert sidecar_path.read_text(encoding="utf-8") == first_sidecar
    assert index_path.read_text(encoding="utf-8") == first_index
    assert len(index_path.read_text(encoding="utf-8").splitlines()) == 1


def test_generated_audio_export_records_new_ledger_entry_for_changed_hash(tmp_path: Path) -> None:
    client, service = make_client(tmp_path, export_dir=tmp_path / "exports")
    save_audio(client, "audio-one")
    assert client.post("/api/generated-audio/audio-one/export").status_code == 200
    new_content = b"changed-mp3"
    new_sha = hashlib.sha256(new_content).hexdigest()
    new_relative_path = "changed/audio-one.mp3"
    new_path = service.file_store.resolve_path(new_relative_path)
    new_path.parent.mkdir(parents=True, exist_ok=True)
    new_path.write_bytes(new_content)

    with unit_of_work(service.session_factory) as session:
        record = session.get(GeneratedAudioRecord, "audio-one")
        assert record is not None
        record.file_path = new_relative_path
        record.size_bytes = len(new_content)
        record.sha256 = new_sha

    response = client.post("/api/generated-audio/audio-one/export")
    status_response = client.get("/api/generated-audio/export-status")

    assert response.status_code == 200
    assert response.json()["item"]["sha256"] == new_sha
    assert len(status_response.json()["items"]) == 2
