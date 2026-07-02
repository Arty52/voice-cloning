from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from voice_cloning.persistence.database import Base, create_database_engine, create_session_factory, unit_of_work
from voice_cloning.persistence.generated_audio import GeneratedAudioMetadata
from voice_cloning.persistence.generated_audio_exports import (
    GeneratedAudioExportLedgerEntry,
    SqlAlchemyGeneratedAudioExportLedgerRepository,
)
from voice_cloning.persistence.models import GeneratedAudioRecord
from voice_cloning.services.generated_audio_export import (
    ARCHIVE_ROOT_NAME,
    ArchiveExportTargetError,
    LocalArchiveExportTarget,
    build_generated_audio_export_descriptor,
)


def audio_metadata(**overrides: object) -> GeneratedAudioMetadata:
    content = overrides.pop("content", b"fake-mp3")
    sha256 = hashlib.sha256(content if isinstance(content, bytes) else b"fake-mp3").hexdigest()
    defaults = {
        "id": "audio-one",
        "file_path": "fa/audio-one.mp3",
        "content_type": "audio/mpeg",
        "size_bytes": len(content) if isinstance(content, bytes) else len(b"fake-mp3"),
        "sha256": sha256,
        "created_at": "2026-07-01T18:45:22+00:00",
        "cache_state": "miss",
        "provider_id": "elevenlabs",
        "provider_voice_id": "provider-voice",
        "app_voice_id": "default",
        "voice_name": "Default Voice",
        "model_id": "eleven_multilingual_v2",
        "character_count": 12,
        "request_id": "req_123",
        "generation_elapsed_ms": 1234,
        "multi_voice_metadata": None,
        "tuning_metadata": {"mode": "default"},
    }
    return GeneratedAudioMetadata(**{**defaults, **overrides})


def test_export_ledger_repository_round_trips_entries() -> None:
    engine = create_database_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)

    with unit_of_work(session_factory) as session:
        session.add(
            GeneratedAudioRecord(
                id="audio-one",
                file_path="fa/audio-one.mp3",
                content_type="audio/mpeg",
                size_bytes=8,
                sha256="a" * 64,
            )
        )
        repository = SqlAlchemyGeneratedAudioExportLedgerRepository(session)
        repository.save(
            GeneratedAudioExportLedgerEntry(
                target_id="local-filesystem",
                audio_id="audio-one",
                sha256="a" * 64,
                filename="generated-audio/2026/07/audio.mp3",
                status="exported",
                exported_at="2026-07-01T18:45:23+00:00",
            )
        )

    with unit_of_work(session_factory) as session:
        repository = SqlAlchemyGeneratedAudioExportLedgerRepository(session)
        entry = repository.get("local-filesystem", "audio-one", "a" * 64)

        assert entry == GeneratedAudioExportLedgerEntry(
            target_id="local-filesystem",
            audio_id="audio-one",
            sha256="a" * 64,
            filename="generated-audio/2026/07/audio.mp3",
            status="exported",
            exported_at="2026-07-01T18:45:23+00:00",
            updated_at=entry.updated_at if entry else None,
        )
        assert [candidate.audio_id for candidate in repository.list_for_target("local-filesystem")] == ["audio-one"]


def test_export_descriptor_uses_path_safe_deterministic_names() -> None:
    item = audio_metadata(
        id="../audio id",
        voice_name="../Default Voice!",
        model_id="Eleven Multilingual v2",
        created_at="2026-07-01T11:45:22-07:00",
    )

    descriptor = build_generated_audio_export_descriptor(item)

    assert descriptor.compact_created_at == "20260701T184522Z"
    assert descriptor.voice_slug == "default-voice"
    assert descriptor.model_slug == "eleven-multilingual-v2"
    assert descriptor.id_slug == "audio-id"
    assert descriptor.year == "2026"
    assert descriptor.month == "07"


def test_local_export_target_writes_audio_sidecar_and_index(tmp_path: Path) -> None:
    content = b"fake-mp3"
    source = tmp_path / "source.mp3"
    source.write_bytes(content)
    target = LocalArchiveExportTarget(tmp_path / "exports")
    item = audio_metadata(content=content)

    result = target.export_item(item, source)

    audio_path = tmp_path / "exports" / ARCHIVE_ROOT_NAME / result.filename
    sidecar_path = tmp_path / "exports" / ARCHIVE_ROOT_NAME / result.sidecar_filename
    index_path = tmp_path / "exports" / ARCHIVE_ROOT_NAME / result.index_filename

    assert audio_path.read_bytes() == content
    assert result.filename == "generated-audio/2026/07/20260701T184522Z--default-voice--eleven-multilingual-v2--ff1841db.mp3"
    assert result.sidecar_filename.endswith(".json")
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert sidecar["schemaVersion"] == 1
    assert sidecar["id"] == "audio-one"
    assert sidecar["sha256"] == item.sha256
    assert "filePath" not in sidecar
    assert json.loads(index_path.read_text(encoding="utf-8").splitlines()[0])["id"] == "audio-one"


def test_local_export_target_uses_collision_safe_candidate(tmp_path: Path) -> None:
    content = b"fake-mp3"
    source = tmp_path / "source.mp3"
    source.write_bytes(content)
    target = LocalArchiveExportTarget(tmp_path / "exports")
    item = audio_metadata(content=content)
    descriptor = build_generated_audio_export_descriptor(item)
    base_path = (
        target.archive_root
        / "generated-audio"
        / descriptor.year
        / descriptor.month
        / f"{descriptor.compact_created_at}--{descriptor.voice_slug}--{descriptor.model_slug}--{descriptor.sha8}.mp3"
    )
    base_path.parent.mkdir(parents=True, exist_ok=True)
    base_path.write_bytes(b"different")

    result = target.export_item(item, source)

    assert result.filename.endswith("--audio-one.mp3")
    assert (tmp_path / "exports" / ARCHIVE_ROOT_NAME / result.filename).read_bytes() == content


def test_local_export_target_uses_path_safe_temp_file_for_unsafe_audio_id(tmp_path: Path) -> None:
    content = b"fake-mp3"
    source = tmp_path / "source.mp3"
    source.write_bytes(content)
    target = LocalArchiveExportTarget(tmp_path / "exports")
    item = audio_metadata(content=content, id="../unsafe/audio id")

    result = target.export_item(item, source)

    assert result.filename.endswith("--ff1841db.mp3")
    assert (tmp_path / "exports" / ARCHIVE_ROOT_NAME / result.filename).read_bytes() == content
    assert not (tmp_path / "exports" / "unsafe").exists()
    assert list((tmp_path / "exports" / ARCHIVE_ROOT_NAME / ".tmp").iterdir()) == []


def test_local_export_target_rejects_paths_outside_archive_root(tmp_path: Path) -> None:
    target = LocalArchiveExportTarget(tmp_path / "exports")

    with pytest.raises(ArchiveExportTargetError):
        target._relative_export_path(tmp_path / "outside.mp3")
