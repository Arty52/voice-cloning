from __future__ import annotations

import asyncio
from dataclasses import replace
import importlib
import json
import os
from pathlib import Path
import shutil
from threading import Event as ThreadEvent
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, inspect, text
from sqlalchemy.engine import URL, make_url

from voice_cloning.config import Settings
from voice_cloning.api.routes.sample_processing import ReservedSampleProcessingFileResponse
from voice_cloning.models import (
    SampleProcessingJob,
    SampleProcessingJobStep,
    SampleProcessingProgressPhase,
    SampleProcessingResult,
    SpeakerSeparationResult,
    SpeakerSeparationSpeaker,
    SpeakerSeparationTranscript,
    SpeakerTranscriptItem,
    SpeakerTranscriptWord,
    SpeechJob,
    SpeechJobSegment,
    VoiceAsset,
    VoiceProcessingStep,
    VoiceSample,
)
from voice_cloning.persistence.database import (
    Base,
    SessionFactory,
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
from voice_cloning.services.sample_processing import (
    PreparedCandidateVoiceSelection,
    SampleProcessingService,
    SampleProcessingServiceError,
    SpeakerAssignmentRequest,
    SpeakerNameAssignment,
    SpeakerVoiceSelection,
    TranscriptTextUpdate,
    apply_speaker_assignment_metadata,
)
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
    assert settings.generated_audio_export_dir is None
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


def test_settings_uses_configured_generated_audio_export_dir(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    export_dir = tmp_path / "exports"
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("GENERATED_AUDIO_EXPORT_DIR", str(export_dir))

    settings = Settings.from_env()

    assert settings.generated_audio_export_dir == export_dir


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


def test_settings_resolves_relative_generated_audio_export_dir_from_app_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workdir = tmp_path / "backend"
    workdir.mkdir()
    monkeypatch.chdir(workdir)
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("GENERATED_AUDIO_EXPORT_DIR", "exports/generated-audio")

    settings = Settings.from_env()

    assert settings.generated_audio_export_dir == tmp_path / "exports" / "generated-audio"


def test_create_app_creates_runtime_storage_roots(tmp_path: Path) -> None:
    from voice_cloning.api.app import create_app

    settings = make_settings(tmp_path)

    create_app(settings=settings)

    assert settings.voice_assets_dir.exists()
    assert settings.storage_dir.exists()
    assert settings.generated_audio_storage_dir.exists()


def test_create_app_creates_configured_generated_audio_export_root(tmp_path: Path) -> None:
    from voice_cloning.api.app import create_app

    settings = replace(make_settings(tmp_path), generated_audio_export_dir=tmp_path / "exports")

    create_app(settings=settings)

    assert settings.generated_audio_export_dir is not None
    assert settings.generated_audio_export_dir.exists()


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
        source_voice_id="voice-clone-01",
        steps=(
            SampleProcessingJobStep(
                id="sample-job",
                operation_id="trimSilence",
                operation_label="Trim Silence",
                status="running",
                engine="ffmpeg",
            ),
        ),
        active_step_id="sample-job",
        progress_phases=(
            SampleProcessingProgressPhase(
                id="phase-one",
                label="Preparing",
                status="running",
            ),
        ),
        active_progress_phase_id="phase-one",
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
                status="running",
            ),
        ),
        active_segment_id="segment-one",
        created_at="2026-07-01T12:00:00+00:00",
        updated_at="2026-07-01T12:00:00+00:00",
    )

    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(sample_job)
        SqlAlchemySpeechGenerationJobRepository(session).save_job(speech_job, result_audio_id="audio-one")

    with unit_of_work(session_factory) as session:
        SqlAlchemySpeechGenerationJobRepository(session).save_job(
            replace(speech_job, updated_at="2026-07-01T12:00:01+00:00")
        )

    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).get_job("sample-job") == sample_job
        assert SqlAlchemySpeechGenerationJobRepository(session).get_job("speech-job") == replace(
            speech_job,
            updated_at="2026-07-01T12:00:01+00:00",
        )
        assert session.get(SampleProcessingJobRecord, "sample-job").request_payload["operationId"] == "trimSilence"
        assert session.get(SampleProcessingJobRecord, "sample-job").request_payload["sourceVoiceId"] == "voice-clone-01"
        assert session.get(SampleProcessingJobRecord, "sample-job").source_voice_id == "voice-clone-01"
        assert session.get(SpeechGenerationJobRecord, "speech-job").result_audio_id == "audio-one"
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
        assert restored_sample_job.active_step_id is None
        assert restored_sample_job.active_progress_phase_id is None
        assert restored_sample_job.steps[0].status == "error"
        assert restored_sample_job.steps[0].error == INTERRUPTED_MESSAGE
        assert restored_sample_job.progress_phases[0].status == "error"
        assert restored_sample_job.progress_phases[0].error == INTERRUPTED_MESSAGE
        assert restored_speech_job is not None
        assert restored_speech_job.status == "interrupted"
        assert restored_speech_job.error == INTERRUPTED_MESSAGE
        assert restored_speech_job.active_segment_id is None
        assert restored_speech_job.segments[0].status == "error"
        assert restored_speech_job.segments[0].error == INTERRUPTED_MESSAGE

    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).delete_job("sample-job") is True

    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).delete_job("sample-job") is False
        assert SqlAlchemySampleProcessingJobRepository(session).get_job("sample-job") is None
        assert SqlAlchemySpeechGenerationJobRepository(session).get_job("speech-job") is not None


def _sample_processing_job(job_id: str, status: str = "success") -> SampleProcessingJob:
    return SampleProcessingJob(
        id=job_id,
        operation_id="trimSilence",
        status=status,  # type: ignore[arg-type]
        source_name="Narrator",
        source_filename="source.wav",
        source_content_type="audio/wav",
        source_sha256=f"{job_id}-source-hash",
        source_size_bytes=128,
        source_preference="active",
        created_at="2026-08-23T12:00:00+00:00",
        updated_at="2026-08-23T12:00:01+00:00",
        result=(
            SampleProcessingResult(
                path=f"{job_id}/result.wav",
                filename="result.wav",
                content_type="audio/wav",
                sha256=f"{job_id}-result-hash",
            )
            if status == "success"
            else None
        ),
        steps=(
            SampleProcessingJobStep(
                id=job_id,
                operation_id="trimSilence",
                operation_label="Trim Silence",
                status="success" if status == "success" else "running",
                engine="ffmpeg",
            ),
        ),
        active_step_id=None if status == "success" else job_id,
    )


def test_sample_processing_service_deletes_only_one_terminal_job_and_its_artifacts(tmp_path: Path) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)

    deleted_job = _sample_processing_job("delete-me")
    retained_job = _sample_processing_job("keep-me")
    with unit_of_work(session_factory) as session:
        repository = SqlAlchemySampleProcessingJobRepository(session)
        repository.save_job(deleted_job)
        repository.save_job(retained_job)
    for job_id in (deleted_job.id, retained_job.id):
        job_dir = settings.sample_processing_dir / job_id
        job_dir.mkdir(parents=True)
        (job_dir / "source.wav").write_bytes(b"source")
        (job_dir / "result.wav").write_bytes(b"result")

    service = SampleProcessingService(
        settings,
        VoiceLibrary(settings),
        job_session_factory=session_factory,
    )
    deleted_source = settings.sample_processing_dir / deleted_job.id / "source.wav"
    service._jobs[deleted_job.id] = deleted_job
    service._source_paths[deleted_job.id] = deleted_source
    service._speaker_processing_steps[deleted_job.id] = {}
    service._prepared_candidate_processing_steps[deleted_job.id] = {}

    assert service.delete_job(deleted_job.id) == deleted_job.id
    assert not (settings.sample_processing_dir / deleted_job.id).exists()
    assert (settings.sample_processing_dir / retained_job.id / "result.wav").is_file()
    assert deleted_job.id not in service._jobs
    assert deleted_job.id not in service._source_paths
    assert deleted_job.id not in service._speaker_processing_steps
    assert deleted_job.id not in service._prepared_candidate_processing_steps
    assert service.get_job(retained_job.id) == retained_job
    with pytest.raises(SampleProcessingServiceError) as missing_error:
        service.get_job(deleted_job.id)
    assert missing_error.value.status_code == 404
    with unit_of_work(session_factory) as session:
        repository = SqlAlchemySampleProcessingJobRepository(session)
        assert repository.get_job(deleted_job.id) is None
        assert repository.get_job(retained_job.id) == retained_job

    active_job = _sample_processing_job("active-job", "running")
    active_dir = settings.sample_processing_dir / active_job.id
    active_dir.mkdir()
    (active_dir / "source.wav").write_bytes(b"active")
    service._jobs[active_job.id] = active_job
    service._persist_job(active_job)
    with pytest.raises(SampleProcessingServiceError) as active_error:
        service.delete_job(active_job.id)
    assert active_error.value.status_code == 409
    assert active_dir.is_dir()
    assert service.get_job(active_job.id) == active_job


def test_sample_processing_service_stage_failure_preserves_job_and_artifacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("stage-failure")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"source")
    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)
    original_rename = Path.rename

    def fail_exact_stage(path: Path, target: Path) -> Path:
        if path == job_dir:
            raise OSError("stage failed")
        return original_rename(path, target)

    monkeypatch.setattr(Path, "rename", fail_exact_stage)

    with pytest.raises(SampleProcessingServiceError) as error:
        service.delete_job(job.id)

    assert error.value.status_code == 500
    assert job_dir.joinpath("source.wav").read_bytes() == b"source"
    assert service.get_job(job.id) == job
    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).get_job(job.id) == job


def test_sample_processing_service_staging_directory_failure_is_translated(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("staging-directory-failure")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"source")
    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)
    staging_dir = settings.sample_processing_dir / ".deleting"
    original_mkdir = Path.mkdir

    def fail_exact_mkdir(
        path: Path,
        mode: int = 0o777,
        parents: bool = False,
        exist_ok: bool = False,
    ) -> None:
        if path == staging_dir:
            raise OSError("staging directory unavailable")
        original_mkdir(path, mode=mode, parents=parents, exist_ok=exist_ok)

    monkeypatch.setattr(Path, "mkdir", fail_exact_mkdir)

    with pytest.raises(SampleProcessingServiceError) as error:
        service.delete_job(job.id)

    assert error.value.status_code == 500
    assert job_dir.joinpath("source.wav").read_bytes() == b"source"
    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).get_job(job.id) == job


def test_sample_processing_service_refuses_to_overwrite_existing_tombstone(tmp_path: Path) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("existing-tombstone")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"current")
    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)
    tombstone_dir = settings.sample_processing_dir / ".deleting" / job.id
    tombstone_dir.mkdir(parents=True)
    (tombstone_dir / "source.wav").write_bytes(b"staged")

    with pytest.raises(SampleProcessingServiceError) as error:
        service.delete_job(job.id)

    assert error.value.status_code == 500
    assert job_dir.joinpath("source.wav").read_bytes() == b"current"
    assert tombstone_dir.joinpath("source.wav").read_bytes() == b"staged"
    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).get_job(job.id) == job


def test_sample_processing_service_persistence_failure_restores_staged_artifacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("persistence-failure")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"source")
    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)

    def fail_persisted_delete(job_id: str) -> bool:
        assert job_id == job.id
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(service, "_delete_persisted_job", fail_persisted_delete)

    with pytest.raises(SampleProcessingServiceError) as error:
        service.delete_job(job.id)

    assert error.value.status_code == 500
    assert job_dir.joinpath("source.wav").read_bytes() == b"source"
    assert not (settings.sample_processing_dir / ".deleting" / job.id).exists()
    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).get_job(job.id) == job


def test_sample_processing_service_failed_rollback_freezes_job_until_restart(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("failed-rollback")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"source")
    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)
    tombstone_dir = settings.sample_processing_dir / ".deleting" / job.id
    original_rename = Path.rename

    def fail_rollback(path: Path, target: Path) -> Path:
        if path == tombstone_dir:
            raise OSError("rollback failed")
        return original_rename(path, target)

    def fail_persisted_delete(job_id: str) -> None:
        assert job_id == job.id
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(Path, "rename", fail_rollback)
    monkeypatch.setattr(service, "_delete_persisted_job", fail_persisted_delete)

    with pytest.raises(SampleProcessingServiceError) as error:
        service.delete_job(job.id)

    assert error.value.status_code == 500
    assert not job_dir.exists()
    assert tombstone_dir.joinpath("source.wav").read_bytes() == b"source"
    with pytest.raises(SampleProcessingServiceError) as busy_error:
        service.reserve_job_artifact_read(job.id)
    assert busy_error.value.status_code == 409
    with pytest.raises(SampleProcessingServiceError) as delete_error:
        service.delete_job(job.id)
    assert delete_error.value.status_code == 409

    monkeypatch.setattr(Path, "rename", original_rename)
    restarted_service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)

    assert restarted_service.get_job(job.id) == job
    assert job_dir.joinpath("source.wav").read_bytes() == b"source"


def test_sample_processing_service_ambiguous_committed_delete_does_not_restore_artifacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("ambiguous-committed-delete")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"source")
    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)
    original_delete = service._delete_persisted_job

    def commit_then_disconnect(job_id: str) -> bool:
        assert original_delete(job_id) is True
        raise ConnectionError("commit acknowledgement lost")

    monkeypatch.setattr(service, "_delete_persisted_job", commit_then_disconnect)

    assert service.delete_job(job.id) == job.id
    assert not job_dir.exists()
    assert not (settings.sample_processing_dir / ".deleting" / job.id).exists()
    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).get_job(job.id) is None


def test_sample_processing_service_unconfirmed_delete_keeps_private_tombstone(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("unconfirmed-delete")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"source")
    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)
    service._jobs[job.id] = job

    def database_unavailable(job_id: str) -> None:
        assert job_id == job.id
        raise ConnectionError("database unavailable")

    monkeypatch.setattr(service, "_delete_persisted_job", database_unavailable)
    monkeypatch.setattr(service, "_get_persisted_job", database_unavailable)

    with pytest.raises(SampleProcessingServiceError) as error:
        service.delete_job(job.id)

    tombstone_dir = settings.sample_processing_dir / ".deleting" / job.id
    assert error.value.status_code == 500
    assert not job_dir.exists()
    assert tombstone_dir.joinpath("source.wav").read_bytes() == b"source"
    with pytest.raises(SampleProcessingServiceError) as busy_error:
        service.update_transcript_items(
            job.id,
            items=(TranscriptTextUpdate(item_id="item-1", text="Blocked"),),
        )
    assert busy_error.value.status_code == 409
    with pytest.raises(SampleProcessingServiceError) as delete_error:
        service.delete_job(job.id)
    assert delete_error.value.status_code == 409

    restarted_service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)

    assert restarted_service.get_job(job.id) == job
    assert job_dir.joinpath("source.wav").read_bytes() == b"source"
    assert not tombstone_dir.exists()


def test_sample_processing_service_cleanup_failure_leaves_restart_recoverable_tombstone(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("cleanup-failure")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"source")
    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)
    tombstone_dir = settings.sample_processing_dir / ".deleting" / job.id
    original_rmtree = shutil.rmtree

    def fail_exact_cleanup(path: str | Path, *args: object, **kwargs: object) -> None:
        if Path(path) == tombstone_dir:
            raise OSError("cleanup failed")
        original_rmtree(path, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(shutil, "rmtree", fail_exact_cleanup)

    with pytest.raises(SampleProcessingServiceError) as error:
        service.delete_job(job.id)

    assert error.value.status_code == 500
    assert not job_dir.exists()
    assert tombstone_dir.joinpath("source.wav").read_bytes() == b"source"
    with pytest.raises(SampleProcessingServiceError) as missing_error:
        service.get_job(job.id)
    assert missing_error.value.status_code == 404
    with unit_of_work(session_factory) as session:
        assert SqlAlchemySampleProcessingJobRepository(session).get_job(job.id) is None

    monkeypatch.setattr(shutil, "rmtree", original_rmtree)
    SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)

    assert not tombstone_dir.exists()


def test_sample_processing_service_restart_restores_staged_artifacts_when_job_exists(tmp_path: Path) -> None:
    settings = replace(make_settings(tmp_path), database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}")
    engine = create_database_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = _sample_processing_job("crash-before-database-delete")
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"source")
    tombstone_dir = settings.sample_processing_dir / ".deleting" / job.id
    tombstone_dir.parent.mkdir(parents=True)
    job_dir.rename(tombstone_dir)

    service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)

    assert service.get_job(job.id) == job
    assert job_dir.joinpath("source.wav").read_bytes() == b"source"
    assert not tombstone_dir.exists()


def _speaker_processing_job(job_id: str) -> SampleProcessingJob:
    source_content = b"speaker source"
    speaker_content = b"speaker result"
    return SampleProcessingJob(
        id=job_id,
        operation_id="separateSpeakers",
        status="success",
        source_name="Conversation",
        source_filename="source.wav",
        source_content_type="audio/wav",
        source_sha256=sample_hash(source_content),
        source_size_bytes=len(source_content),
        source_preference="original",
        created_at="2026-08-23T12:00:00+00:00",
        updated_at="2026-08-23T12:00:01+00:00",
        result=SpeakerSeparationResult(
            kind="speakerSeparation",
            speakers=(
                SpeakerSeparationSpeaker(
                    id="speaker-1",
                    label="Speaker 1",
                    transcript_item_ids=("item-1",),
                    result=SampleProcessingResult(
                        path=f"{job_id}/speaker-1.wav",
                        filename="speaker-1.wav",
                        content_type="audio/wav",
                        sha256=sample_hash(speaker_content),
                    ),
                ),
            ),
            transcript=SpeakerSeparationTranscript(
                items=(
                    SpeakerTranscriptItem(
                        id="item-1",
                        text="Hello.",
                        start_seconds=0.0,
                        end_seconds=1.0,
                        speaker_id="speaker-1",
                    ),
                ),
            ),
        ),
        steps=(
            SampleProcessingJobStep(
                id=job_id,
                operation_id="separateSpeakers",
                operation_label="Separate Speakers",
                status="success",
                engine="test",
                source_sha256=sample_hash(source_content),
                result_sha256=sample_hash(speaker_content),
            ),
        ),
    )


def _persist_speaker_processing_job(
    settings: Settings,
    session_factory: SessionFactory,
    job: SampleProcessingJob,
) -> None:
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    job_dir = settings.sample_processing_dir / job.id
    job_dir.mkdir(parents=True)
    (job_dir / "source.wav").write_bytes(b"speaker source")
    (job_dir / "speaker-1.wav").write_bytes(b"speaker result")


class _BlockingAssignmentProcessor:
    engine_name = "test"

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def update_speaker_assignments(self, request: SpeakerAssignmentRequest) -> SpeakerSeparationResult:
        self.started.set()
        await self.release.wait()
        return apply_speaker_assignment_metadata(
            request.result,
            speaker_names=request.speaker_names,
            transcript_assignments=request.transcript_assignments,
        )


def test_sample_processing_delete_rejects_active_mutation_but_allows_unrelated_job(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        settings = replace(
            make_settings(tmp_path),
            database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}",
        )
        engine = create_database_engine(settings.database_url)
        Base.metadata.create_all(engine)
        session_factory = create_session_factory(engine)
        mutated_job = _speaker_processing_job("mutated-job")
        unrelated_job = _sample_processing_job("unrelated-job")
        _persist_speaker_processing_job(settings, session_factory, mutated_job)
        with unit_of_work(session_factory) as session:
            SqlAlchemySampleProcessingJobRepository(session).save_job(unrelated_job)
        unrelated_dir = settings.sample_processing_dir / unrelated_job.id
        unrelated_dir.mkdir(parents=True)
        (unrelated_dir / "result.wav").write_bytes(b"unrelated")
        processor = _BlockingAssignmentProcessor()
        service = SampleProcessingService(
            settings,
            VoiceLibrary(settings),
            processor=processor,  # type: ignore[arg-type]
            job_session_factory=session_factory,
        )

        mutation = asyncio.create_task(
            service.update_speaker_assignments(
                mutated_job.id,
                speaker_names=(SpeakerNameAssignment(speaker_id="speaker-1", name="Morgan"),),
            )
        )
        await processor.started.wait()

        with pytest.raises(SampleProcessingServiceError) as busy_error:
            service.delete_job(mutated_job.id)
        assert busy_error.value.status_code == 409
        assert service.delete_job(unrelated_job.id) == unrelated_job.id
        assert not unrelated_dir.exists()

        processor.release.set()
        updated_job = await mutation

        assert isinstance(updated_job.result, SpeakerSeparationResult)
        assert updated_job.result.speakers[0].assigned_name == "Morgan"
        assert (settings.sample_processing_dir / mutated_job.id / "source.wav").is_file()
        with unit_of_work(session_factory) as session:
            repository = SqlAlchemySampleProcessingJobRepository(session)
            assert repository.get_job(mutated_job.id) == updated_job
            assert repository.get_job(unrelated_job.id) is None

    asyncio.run(scenario())


def test_sample_processing_delete_reservation_blocks_later_job_operations(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def scenario() -> None:
        settings = replace(
            make_settings(tmp_path),
            database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}",
        )
        engine = create_database_engine(settings.database_url)
        Base.metadata.create_all(engine)
        session_factory = create_session_factory(engine)
        job = _speaker_processing_job("delete-first")
        _persist_speaker_processing_job(settings, session_factory, job)
        processor = _BlockingAssignmentProcessor()
        service = SampleProcessingService(
            settings,
            VoiceLibrary(settings),
            processor=processor,  # type: ignore[arg-type]
            job_session_factory=session_factory,
        )
        delete_started = ThreadEvent()
        allow_delete = ThreadEvent()
        original_delete = service._delete_persisted_job

        def blocking_delete(job_id: str) -> bool:
            delete_started.set()
            assert allow_delete.wait(timeout=5)
            return original_delete(job_id)

        monkeypatch.setattr(service, "_delete_persisted_job", blocking_delete)
        deletion = asyncio.create_task(asyncio.to_thread(service.delete_job, job.id))
        assert await asyncio.to_thread(delete_started.wait, 5)

        blocked_calls = (
            lambda: service.save_result_as_voice(job.id, name="Blocked"),
            lambda: service.update_transcript_items(
                job.id,
                items=(TranscriptTextUpdate(item_id="item-1", text="Blocked"),),
            ),
            lambda: service.save_candidate_results_as_voices(
                job.id,
                voices=(PreparedCandidateVoiceSelection(candidate_id="candidate-1", name="Blocked"),),
            ),
        )
        for blocked_call in blocked_calls:
            with pytest.raises(SampleProcessingServiceError) as busy_error:
                blocked_call()
            assert busy_error.value.status_code == 409
        with pytest.raises(SampleProcessingServiceError) as assignment_error:
            await service.update_speaker_assignments(
                job.id,
                speaker_names=(SpeakerNameAssignment(speaker_id="speaker-1", name="Blocked"),),
            )
        assert assignment_error.value.status_code == 409
        with pytest.raises(SampleProcessingServiceError) as speaker_save_error:
            await service.save_speaker_results_as_voices(
                job.id,
                voices=(SpeakerVoiceSelection(speaker_id="speaker-1", name="Blocked"),),
            )
        assert speaker_save_error.value.status_code == 409
        with pytest.raises(SampleProcessingServiceError) as artifact_read_error:
            service.reserve_job_artifact_read(job.id)
        assert artifact_read_error.value.status_code == 409
        assert not processor.started.is_set()

        allow_delete.set()
        assert await deletion == job.id

        with pytest.raises(SampleProcessingServiceError) as missing_error:
            service.get_job(job.id)
        assert missing_error.value.status_code == 404
        with unit_of_work(session_factory) as session:
            assert SqlAlchemySampleProcessingJobRepository(session).get_job(job.id) is None
        assert not (settings.sample_processing_dir / job.id).exists()

    asyncio.run(scenario())


def test_sample_processing_artifact_response_leases_allow_readers_and_release_on_send_outcomes(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        settings = replace(
            make_settings(tmp_path),
            database_url=f"sqlite+pysqlite:///{tmp_path / 'jobs.sqlite'}",
        )
        engine = create_database_engine(settings.database_url)
        Base.metadata.create_all(engine)
        session_factory = create_session_factory(engine)
        streamed_job = _sample_processing_job("streamed-job")
        unrelated_job = _sample_processing_job("stream-unrelated-job")
        disconnected_job = _sample_processing_job("disconnected-job")
        for job in (streamed_job, unrelated_job, disconnected_job):
            with unit_of_work(session_factory) as session:
                SqlAlchemySampleProcessingJobRepository(session).save_job(job)
            job_dir = settings.sample_processing_dir / job.id
            job_dir.mkdir(parents=True)
            (job_dir / "result.wav").write_bytes(job.id.encode("utf-8"))
        service = SampleProcessingService(settings, VoiceLibrary(settings), job_session_factory=session_factory)
        streamed_path = settings.sample_processing_dir / streamed_job.id / "result.wav"
        first_lease = service.reserve_job_artifact_read(streamed_job.id)
        second_lease = service.reserve_job_artifact_read(streamed_job.id)
        response = ReservedSampleProcessingFileResponse(
            streamed_path,
            operation_lease=first_lease,
            filename=streamed_path.name,
            media_type="audio/wav",
        )

        with pytest.raises(SampleProcessingServiceError) as read_busy_error:
            service.delete_job(streamed_job.id)
        assert read_busy_error.value.status_code == 409
        with pytest.raises(SampleProcessingServiceError) as mutation_busy_error:
            service.update_transcript_items(
                streamed_job.id,
                items=(TranscriptTextUpdate(item_id="item-1", text="Blocked"),),
            )
        assert mutation_busy_error.value.status_code == 409
        assert service.delete_job(unrelated_job.id) == unrelated_job.id

        messages: list[dict[str, object]] = []

        async def receive() -> dict[str, object]:
            return {"type": "http.request"}

        async def send(message: dict[str, object]) -> None:
            messages.append(message)

        scope: dict[str, object] = {"type": "http", "method": "GET", "headers": [], "extensions": {}}
        await response(scope, receive, send)  # type: ignore[arg-type]
        assert any(message.get("type") == "http.response.body" for message in messages)

        with pytest.raises(SampleProcessingServiceError) as second_read_busy_error:
            service.delete_job(streamed_job.id)
        assert second_read_busy_error.value.status_code == 409
        second_lease.release()
        second_lease.release()
        assert service.delete_job(streamed_job.id) == streamed_job.id

        disconnected_path = settings.sample_processing_dir / disconnected_job.id / "result.wav"
        disconnected_response = ReservedSampleProcessingFileResponse(
            disconnected_path,
            operation_lease=service.reserve_job_artifact_read(disconnected_job.id),
            filename=disconnected_path.name,
            media_type="audio/wav",
        )

        async def disconnecting_send(message: dict[str, object]) -> None:
            if message.get("type") == "http.response.body":
                raise ConnectionError("client disconnected")

        with pytest.raises(ConnectionError, match="client disconnected"):
            await disconnected_response(scope, receive, disconnecting_send)  # type: ignore[arg-type]
        assert service.delete_job(disconnected_job.id) == disconnected_job.id

    asyncio.run(scenario())


def test_sample_processing_job_repository_roundtrips_transcript_word_alignment() -> None:
    engine = create_database_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    job = SampleProcessingJob(
        id="transcript-job",
        operation_id="separateSpeakers",
        status="success",
        source_name="Conversation",
        source_filename="conversation.m4a",
        source_content_type="audio/mp4",
        source_sha256="source-hash",
        source_size_bytes=1024,
        source_preference="original",
        created_at="2026-08-04T12:00:00+00:00",
        updated_at="2026-08-04T12:01:00+00:00",
        result=SpeakerSeparationResult(
            kind="speakerSeparation",
            speakers=(
                SpeakerSeparationSpeaker(
                    id="speaker-1",
                    label="Speaker 1",
                    assigned_name="Morgan",
                    transcript_item_ids=("item-1",),
                ),
            ),
            transcript=SpeakerSeparationTranscript(
                items=(
                    SpeakerTranscriptItem(
                        id="item-1",
                        text="Aligned dialogue.",
                        start_seconds=0.0,
                        end_seconds=1.2,
                        speaker_id="speaker-1",
                        words=(
                            SpeakerTranscriptWord(
                                id="item-1-word-1",
                                text="Aligned",
                                start_seconds=0.0,
                                end_seconds=0.6,
                            ),
                            SpeakerTranscriptWord(
                                id="item-1-word-2",
                                text="dialogue.",
                                start_seconds=0.7,
                                end_seconds=1.2,
                            ),
                        ),
                    ),
                ),
            ),
        ),
    )

    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)

    with unit_of_work(session_factory) as session:
        restored = SqlAlchemySampleProcessingJobRepository(session).get_job(job.id)

    assert restored == job
    assert restored is not None
    assert isinstance(restored.result, SpeakerSeparationResult)
    assert restored.result.transcript.items[0].words is not None
    assert restored.result.transcript.items[0].words[1].text == "dialogue."


@pytest.mark.parametrize(
    "persist_step_source_sha256",
    [True, False],
    ids=["step-hash", "job-hash-fallback"],
)
def test_sample_processing_service_rehydrates_persisted_transcript_source_path(
    tmp_path: Path,
    persist_step_source_sha256: bool,
) -> None:
    settings = make_settings(tmp_path)
    engine = create_database_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)
    source_content = b"persisted transcript source"
    source_sha256 = sample_hash(source_content)
    job = SampleProcessingJob(
        id="transcript-job",
        operation_id="separateSpeakers",
        status="success",
        source_name="Meeting",
        source_filename="meeting.m4a",
        source_content_type="audio/mp4",
        source_sha256=source_sha256,
        source_size_bytes=len(source_content),
        source_preference="original",
        created_at="2026-08-04T12:00:00+00:00",
        updated_at="2026-08-04T12:01:00+00:00",
        steps=(
            SampleProcessingJobStep(
                id="transcript-job",
                operation_id="separateSpeakers",
                operation_label="Separate Speakers",
                status="success",
                engine="pyannote-community-1+faster-whisper",
                source_sha256=source_sha256 if persist_step_source_sha256 else None,
                result_sha256="speaker-result-hash",
            ),
        ),
        result=SpeakerSeparationResult(
            kind="speakerSeparation",
            speakers=(
                SpeakerSeparationSpeaker(
                    id="speaker-1",
                    label="Speaker 1",
                    transcript_item_ids=("item-1",),
                ),
            ),
            transcript=SpeakerSeparationTranscript(
                items=(
                    SpeakerTranscriptItem(
                        id="item-1",
                        text="Persisted dialogue.",
                        start_seconds=0.0,
                        end_seconds=1.0,
                        speaker_id="speaker-1",
                    ),
                ),
            ),
        ),
    )
    source_path = settings.sample_processing_dir / job.id / "source.m4a"
    source_path.parent.mkdir(parents=True)
    source_path.write_bytes(source_content)
    with unit_of_work(session_factory) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)

    service = SampleProcessingService(
        settings,
        VoiceLibrary(settings),
        job_session_factory=session_factory,
    )

    assert service._source_paths == {}
    assert service.source_path(job.id) == source_path
    assert service._source_paths == {job.id: source_path}


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


def test_create_app_reuses_database_session_factory_for_persistent_services(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_module = importlib.import_module("voice_cloning.api.app")

    database_url = f"sqlite+pysqlite:///{tmp_path / 'app.sqlite'}"
    settings = replace(make_settings(tmp_path), database_url=database_url)
    engine = create_database_engine(database_url)
    Base.metadata.create_all(engine)
    created_engines: list[str] = []

    def create_engine_once(url: str):
        created_engines.append(url)
        return engine

    monkeypatch.setattr(app_module, "create_database_engine", create_engine_once)

    app_module.create_app(settings=settings, voice_library=VoiceLibrary(settings))

    assert created_engines == [database_url]


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

    assert version == "202607010003"
    assert {
        "voices",
        "voice_processing_steps",
        "voice_library_state",
        "voice_tuning_presets",
        "generated_audio",
        "generated_audio_export_ledger",
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

        assert version == "202607010003"
        assert "voices" in table_names
        assert "generated_audio" in table_names
        assert "generated_audio_export_ledger" in table_names
    finally:
        if roundtrip_engine is not None:
            roundtrip_engine.dispose()
        with admin_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{roundtrip_database}" WITH (FORCE)'))
        admin_engine.dispose()


def _url_string(url: URL) -> str:
    return url.render_as_string(hide_password=False)
