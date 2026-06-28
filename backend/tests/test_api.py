from __future__ import annotations

import asyncio
from dataclasses import replace
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import time
from typing import Callable, get_args

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

import voice_cloning.sample_processors as sample_processors_module
import voice_cloning.voice_library as voice_library_module
from voice_cloning.api import SpeechGenerationCanceled, _await_or_cancel_on_disconnect, create_app
from voice_cloning.cache import VoiceCache
from voice_cloning.config import Settings
from voice_cloning.elevenlabs_client import (
    ElevenLabsError,
    _is_tts_model,
    _model_from_payload,
    _normalize_control_value,
)
from voice_cloning.api.serializers import audio_response
from voice_cloning.models import (
    CachedVoice,
    ModelSummary,
    SampleProcessingOperation,
    SampleProcessingPresetId,
    SampleProcessingResult,
    SpeakerSeparationResult,
    SpeakerSeparationSpeaker,
    SpeakerSeparationTranscript,
    SpeakerTranscriptItem,
    SpeechResult,
    SubscriptionSummary,
    VoiceClone,
    VoiceProcessingStep,
    VoiceSample,
)
from voice_cloning.providers import (
    ELEVENLABS_PROVIDER_DESCRIPTOR,
    ProviderDescriptor,
    ProviderKeyContext,
    ProviderRegistry,
    ProviderTuningControl,
    ProviderTuningOption,
    ProviderTuningValue,
    VOICE_PROVIDER_KEY_HEADER,
    resolve_elevenlabs_key,
)
from voice_cloning.sample_processors import (
    CompositeSampleProcessor,
    _run_external_command,
    create_sample_processor,
)
from voice_cloning.samples import sample_hash, save_uploaded_sample_stream
from voice_cloning.services.sample_processing import (
    DEFAULT_ISOLATION_PROCESSING_PRESET_ID,
    DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID,
    ISOLATION_PROCESSING_PRESETS,
    SpeakerAssignmentRequest,
    SampleProcessingRequest,
    SampleProcessingService,
    SampleProcessingServiceError,
    TRIM_SILENCE_PROCESSING_PRESETS,
    apply_speaker_assignment_metadata,
)
from voice_cloning.services.speech import SpeechServiceError, generate_speech
from voice_cloning.voice_library import VoiceLibrary


class FakeElevenLabsProvider:
    def __init__(self) -> None:
        self.created_samples: list[VoiceSample] = []
        self.create_voice_api_keys: list[str | None] = []
        self.speech_requests: list[tuple[str, str, dict[str, ProviderTuningValue] | None, str | None, str | None]] = []
        self.subscription_api_keys: list[str | None] = []
        self.model_api_keys: list[str | None] = []
        self.create_voice_error: ElevenLabsError | None = None
        self.subscription_error: ElevenLabsError | None = None
        self.models_error: ElevenLabsError | None = None
        self.create_voice_delay = 0.0
        self.create_speech_delay = 0.0
        self.speech_character_count: int | None = 24
        self.speech_request_id: str | None = "req_test_123"
        self.subscription = SubscriptionSummary(
            tier="starter",
            status="active",
            character_count=1000,
            character_limit=10000,
            remaining_characters=9000,
            can_extend_character_limit=True,
            max_credit_limit_extension=10000,
            next_character_count_reset_unix=1770000000,
        )
        self.models = [
            ModelSummary(
                model_id="eleven_multilingual_v2",
                name="Eleven Multilingual v2",
                description="Stable long-form speech.",
                can_use_style=True,
                can_use_speaker_boost=True,
                character_cost_multiplier=1,
                max_characters_request_free_user=2500,
                max_characters_request_subscribed_user=10000,
                maximum_text_length_per_request=10000,
            ),
            ModelSummary(
                model_id="eleven_flash_v2_5",
                name="Eleven Flash v2.5",
                description="Fast speech.",
                can_use_style=False,
                can_use_speaker_boost=True,
                character_cost_multiplier=0.5,
                max_characters_request_free_user=2500,
                max_characters_request_subscribed_user=40000,
                maximum_text_length_per_request=40000,
            ),
        ]
        self.settings: Settings | None = None

    @property
    def id(self) -> str:
        return "elevenlabs"

    @property
    def descriptor(self):
        return ELEVENLABS_PROVIDER_DESCRIPTOR

    @property
    def default_model_id(self) -> str:
        return self.settings.elevenlabs_model_id if self.settings is not None else "eleven_multilingual_v2"

    @property
    def server_key_configured(self) -> bool:
        return bool(self.settings and self.settings.elevenlabs_api_key.strip())

    def bind_settings(self, settings: Settings) -> "FakeElevenLabsProvider":
        self.settings = settings
        return self

    def resolve_key(self, api_key_override: str | None) -> ProviderKeyContext:
        if self.settings is None:
            raise RuntimeError("Test provider settings are not configured.")
        return resolve_elevenlabs_key(self.settings, api_key_override)

    def normalize_voice_settings(self, values: dict[str, object] | None) -> dict[str, ProviderTuningValue]:
        defaults = ELEVENLABS_PROVIDER_DESCRIPTOR.tuning.resolved_default_values()
        if values is None:
            return defaults
        unknown_ids = sorted(set(values) - set(defaults))
        if unknown_ids:
            raise ElevenLabsError(f"Unsupported ElevenLabs voice setting: {', '.join(unknown_ids)}.", 422)
        return {**defaults, **values}  # type: ignore[return-value]

    async def get_subscription(self, api_key: str | None = None) -> SubscriptionSummary:
        if self.subscription_error is not None:
            raise self.subscription_error
        self.subscription_api_keys.append(api_key)
        return self.subscription

    async def list_models(self, api_key: str | None = None) -> list[ModelSummary]:
        if self.models_error is not None:
            raise self.models_error
        self.model_api_keys.append(api_key)
        return self.models

    async def create_voice(self, sample: VoiceSample, api_key: str | None = None) -> VoiceClone:
        if self.create_voice_error is not None:
            raise self.create_voice_error
        if self.create_voice_delay:
            await asyncio.sleep(self.create_voice_delay)
        self.created_samples.append(sample)
        self.create_voice_api_keys.append(api_key)
        return VoiceClone(voice_id=f"voice-{sample.sha256[:8]}", requires_verification=False)

    async def create_speech(
        self,
        voice_id: str,
        text: str,
        voice_settings: dict[str, ProviderTuningValue] | None = None,
        model_id: str | None = None,
        api_key: str | None = None,
    ) -> SpeechResult:
        if self.create_speech_delay:
            await asyncio.sleep(self.create_speech_delay)
        self.speech_requests.append((voice_id, text, voice_settings, model_id, api_key))
        return SpeechResult(
            audio=b"fake-mp3",
            character_count=self.speech_character_count,
            request_id=self.speech_request_id,
        )


class FakeNoTuningProvider(FakeElevenLabsProvider):
    @property
    def id(self) -> str:
        return "notuning"

    @property
    def descriptor(self) -> ProviderDescriptor:
        return ProviderDescriptor(
            id="notuning",
            label="No Tuning",
            manage_key_url="https://provider.example/key",
            docs_url="https://provider.example/docs",
        )

    def normalize_voice_settings(self, values: dict[str, object] | None) -> dict[str, ProviderTuningValue]:
        if values:
            raise ElevenLabsError("No Tuning does not support voice settings.", 422)
        return {}


class FakeSampleProcessor:
    engine_name = "fake-processor"

    def __init__(self, output: bytes = b"isolated-voice") -> None:
        self.output = output
        self.requests: list[SampleProcessingRequest] = []

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        return (
            SampleProcessingOperation(
                id="isolateVoice",
                label="Isolate Voice",
                description="Separate the vocal stem from music or background audio.",
                enabled=True,
                processing_presets=ISOLATION_PROCESSING_PRESETS,
                default_processing_preset_id=DEFAULT_ISOLATION_PROCESSING_PRESET_ID,
            ),
        )

    def engine_name_for_operation(self, operation_id: str) -> str:
        return self.engine_name

    async def process(self, request: SampleProcessingRequest) -> None:
        self.requests.append(request)
        request.output_path.write_bytes(self.output)


class FakeSpeakerSeparationProcessor:
    engine_name = "fake-diarization"

    def __init__(self) -> None:
        self.requests: list[SampleProcessingRequest] = []
        self.assignment_requests: list[SpeakerAssignmentRequest] = []

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        return (
            SampleProcessingOperation(
                id="separateSpeakers",
                label="Separate Speakers",
                description="Split a source track into individual speaker samples.",
                enabled=True,
            ),
        )

    def engine_name_for_operation(self, operation_id: str) -> str:
        return self.engine_name

    async def process(self, request: SampleProcessingRequest) -> SpeakerSeparationResult:
        self.requests.append(request)
        speaker_one_path = request.job_dir / "speaker-1.wav"
        speaker_two_path = request.job_dir / "speaker-2.wav"
        speaker_one_path.write_bytes(b"speaker-one")
        speaker_two_path.write_bytes(b"speaker-two")
        return SpeakerSeparationResult(
            kind="speakerSeparation",
            speakers=(
                SpeakerSeparationSpeaker(
                    id="speaker-1",
                    label="Speaker 1",
                    transcript_item_ids=("item-1", "item-3"),
                    result=SampleProcessingResult(
                        path=speaker_one_path.relative_to(request.job_dir.parent).as_posix(),
                        filename=speaker_one_path.name,
                        content_type="audio/wav",
                        sha256=sample_hash(b"speaker-one"),
                    ),
                ),
                SpeakerSeparationSpeaker(
                    id="speaker-2",
                    label="Speaker 2",
                    transcript_item_ids=("item-2",),
                    result=SampleProcessingResult(
                        path=speaker_two_path.relative_to(request.job_dir.parent).as_posix(),
                        filename=speaker_two_path.name,
                        content_type="audio/wav",
                        sha256=sample_hash(b"speaker-two"),
                    ),
                ),
            ),
            transcript=SpeakerSeparationTranscript(
                items=(
                    SpeakerTranscriptItem(
                        id="item-1",
                        text="Hello there.",
                        start_seconds=0.0,
                        end_seconds=1.2,
                        speaker_id="speaker-1",
                    ),
                    SpeakerTranscriptItem(
                        id="item-2",
                        text="General Kenobi.",
                        start_seconds=1.3,
                        end_seconds=2.4,
                        speaker_id="speaker-2",
                    ),
                    SpeakerTranscriptItem(
                        id="item-3",
                        text="You are a bold one.",
                        start_seconds=2.6,
                        end_seconds=4.0,
                        speaker_id="speaker-1",
                    ),
                ),
            ),
        )

    async def update_speaker_assignments(self, request: SpeakerAssignmentRequest) -> SpeakerSeparationResult:
        self.assignment_requests.append(request)
        updated = apply_speaker_assignment_metadata(
            request.result,
            speaker_names=request.speaker_names,
            transcript_assignments=request.transcript_assignments,
        )
        speakers: list[SpeakerSeparationSpeaker] = []
        for speaker in updated.speakers:
            if speaker.result is None:
                speakers.append(speaker)
                continue
            content = f"{speaker.id}:{','.join(speaker.transcript_item_ids)}".encode("utf-8")
            path = request.job_dir.parent / speaker.result.path
            path.write_bytes(content)
            speakers.append(replace(speaker, result=replace(speaker.result, sha256=sample_hash(content))))
        return SpeakerSeparationResult(
            kind="speakerSeparation",
            speakers=tuple(speakers),
            transcript=updated.transcript,
        )


class FakeStackSampleProcessor:
    engine_name = "fake-stack"

    def __init__(self, delay_seconds: float = 0) -> None:
        self.delay_seconds = delay_seconds
        self.requests: list[SampleProcessingRequest] = []
        self.assignment_requests: list[SpeakerAssignmentRequest] = []

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        return (
            SampleProcessingOperation(
                id="isolateVoice",
                label="Isolate Voice",
                description="Separate the vocal stem from music or background audio.",
                enabled=True,
                processing_presets=ISOLATION_PROCESSING_PRESETS,
                default_processing_preset_id=DEFAULT_ISOLATION_PROCESSING_PRESET_ID,
            ),
            SampleProcessingOperation(
                id="trimSilence",
                label="Trim Silence",
                description="Remove leading, trailing, and long interior empty sections.",
                enabled=True,
                processing_presets=TRIM_SILENCE_PROCESSING_PRESETS,
                default_processing_preset_id=DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID,
            ),
            SampleProcessingOperation(
                id="separateSpeakers",
                label="Separate Speakers",
                description="Split a source track into individual speaker samples.",
                enabled=True,
            ),
        )

    def engine_name_for_operation(self, operation_id: str) -> str:
        return f"fake-{operation_id}"

    async def process(self, request: SampleProcessingRequest) -> SampleProcessingResult | SpeakerSeparationResult | None:
        self.requests.append(request)
        if self.delay_seconds:
            await asyncio.sleep(self.delay_seconds)
        source_content = request.source.content or request.source_path.read_bytes()
        if request.operation_id == "isolateVoice":
            request.output_path.write_bytes(b"isolated:" + source_content)
            return None
        if request.operation_id == "trimSilence":
            request.output_path.write_bytes(b"trimmed:" + source_content)
            return None
        if request.operation_id == "separateSpeakers":
            speaker_one_content = b"speaker-one:" + source_content
            speaker_two_content = b"speaker-two:" + source_content
            speaker_one_path = request.job_dir / "speaker-1.wav"
            speaker_two_path = request.job_dir / "speaker-2.wav"
            speaker_one_path.write_bytes(speaker_one_content)
            speaker_two_path.write_bytes(speaker_two_content)
            return SpeakerSeparationResult(
                kind="speakerSeparation",
                speakers=(
                    SpeakerSeparationSpeaker(
                        id="speaker-1",
                        label="Speaker 1",
                        transcript_item_ids=("item-1",),
                        result=SampleProcessingResult(
                            path=speaker_one_path.relative_to(request.job_dir.parent).as_posix(),
                            filename=speaker_one_path.name,
                            content_type="audio/wav",
                            sha256=sample_hash(speaker_one_content),
                        ),
                    ),
                    SpeakerSeparationSpeaker(
                        id="speaker-2",
                        label="Speaker 2",
                        transcript_item_ids=("item-2",),
                        result=SampleProcessingResult(
                            path=speaker_two_path.relative_to(request.job_dir.parent).as_posix(),
                            filename=speaker_two_path.name,
                            content_type="audio/wav",
                            sha256=sample_hash(speaker_two_content),
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
                        SpeakerTranscriptItem(
                            id="item-2",
                            text="Hi.",
                            start_seconds=1.1,
                            end_seconds=2.0,
                            speaker_id="speaker-2",
                        ),
                    ),
                ),
            )
        raise AssertionError(f"Unsupported operation: {request.operation_id}")

    async def update_speaker_assignments(self, request: SpeakerAssignmentRequest) -> SpeakerSeparationResult:
        self.assignment_requests.append(request)
        updated = apply_speaker_assignment_metadata(
            request.result,
            speaker_names=request.speaker_names,
            transcript_assignments=request.transcript_assignments,
        )
        speakers: list[SpeakerSeparationSpeaker] = []
        for speaker in updated.speakers:
            if speaker.result is None:
                speakers.append(speaker)
                continue
            content = f"{speaker.id}:{','.join(speaker.transcript_item_ids)}".encode("utf-8")
            path = request.job_dir.parent / speaker.result.path
            path.write_bytes(content)
            speakers.append(replace(speaker, result=replace(speaker.result, sha256=sample_hash(content))))
        return SpeakerSeparationResult(
            kind="speakerSeparation",
            speakers=tuple(speakers),
            transcript=updated.transcript,
        )


class InvalidSpeakerTranscriptOwnershipProcessor(FakeSpeakerSeparationProcessor):
    async def process(self, request: SampleProcessingRequest) -> SpeakerSeparationResult:
        result = await super().process(request)
        return replace(
            result,
            speakers=(
                replace(result.speakers[0], transcript_item_ids=("item-1", "item-2", "item-3")),
                result.speakers[1],
            ),
        )


class IncompleteSpeakerTranscriptItemsProcessor(FakeSpeakerSeparationProcessor):
    async def process(self, request: SampleProcessingRequest) -> SpeakerSeparationResult:
        result = await super().process(request)
        return replace(
            result,
            speakers=(
                replace(result.speakers[0], transcript_item_ids=("item-1",)),
                result.speakers[1],
            ),
        )


class DuplicateSpeakerTranscriptItemsProcessor(FakeSpeakerSeparationProcessor):
    async def process(self, request: SampleProcessingRequest) -> SpeakerSeparationResult:
        result = await super().process(request)
        return replace(
            result,
            speakers=(
                replace(result.speakers[0], transcript_item_ids=("item-1", "item-1", "item-3")),
                result.speakers[1],
            ),
        )


def make_settings(
    tmp_path: Path,
    api_key: str = "test-key",
    with_default_sample: bool = True,
    max_upload_bytes: int = 10 * 1024 * 1024,
    max_source_upload_bytes: int = 1024 * 1024 * 1024,
    sample_processing_ffmpeg_command: str = "ffmpeg",
) -> Settings:
    voice_assets_dir = tmp_path / "assets" / "voices"
    sample_path = voice_assets_dir / "default" / "default-voice.mp3"
    if with_default_sample:
        sample_path.parent.mkdir(parents=True)
        sample_path.write_bytes(b"default-sample")
    return Settings(
        app_root=tmp_path,
        elevenlabs_api_key=api_key,
        elevenlabs_api_base_url="https://api.elevenlabs.test/v1",
        elevenlabs_model_id="eleven_multilingual_v2",
        default_sample_path=sample_path,
        voice_assets_dir=voice_assets_dir,
        voice_manifest_path=voice_assets_dir / "voices.json",
        storage_dir=tmp_path / "storage",
        sample_processing_dir=tmp_path / "storage" / "sample-processing",
        speech_jobs_dir=tmp_path / "storage" / "speech-jobs",
        cors_allowed_origins=["http://localhost:4340"],
        max_upload_bytes=max_upload_bytes,
        max_source_upload_bytes=max_source_upload_bytes,
        sample_processing_ffmpeg_command=sample_processing_ffmpeg_command,
    )


def make_client(
    tmp_path: Path,
    api_key: str = "test-key",
    with_default_sample: bool = True,
    max_upload_bytes: int = 10 * 1024 * 1024,
    max_source_upload_bytes: int = 1024 * 1024 * 1024,
    ffmpeg_command: Path | None = None,
) -> tuple[TestClient, FakeElevenLabsProvider]:
    settings = make_settings(
        tmp_path,
        api_key=api_key,
        with_default_sample=with_default_sample,
        max_upload_bytes=max_upload_bytes,
        max_source_upload_bytes=max_source_upload_bytes,
        sample_processing_ffmpeg_command=str(ffmpeg_command or ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    fake_client = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_client]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    return TestClient(app), fake_client


def make_upload_file(filename: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


def wait_for_processing_job(client: TestClient, job_id: str, status: str = "success") -> dict[str, object]:
    payload: dict[str, object] = {}
    for _ in range(50):
        response = client.get(f"/api/sample-processing/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()["job"]
        if payload["status"] == status:
            return payload
        time.sleep(0.02)
    raise AssertionError(f"Sample processing job did not reach {status}: {payload}")


def wait_for_speech_job(client: TestClient, job_id: str, status: str = "success") -> dict[str, object]:
    payload: dict[str, object] = {}
    for _ in range(50):
        response = client.get(f"/api/speech/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()["job"]
        if payload["status"] == status:
            return payload
        time.sleep(0.02)
    raise AssertionError(f"Speech job did not reach {status}: {payload}")


def test_settings_blank_sample_processing_timeout_uses_default(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("SAMPLE_PROCESSING_TIMEOUT_SECONDS", "   ")

    settings = Settings.from_env()

    assert settings.sample_processing_timeout_seconds == 900


def test_settings_loads_upload_caps_from_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "12345")
    monkeypatch.setenv("MAX_SOURCE_UPLOAD_BYTES", "1073741824")

    settings = Settings.from_env()

    assert settings.max_upload_bytes == 12345
    assert settings.max_source_upload_bytes == 1024 * 1024 * 1024


def test_streamed_upload_writes_file_and_sha_metadata(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    destination = tmp_path / "streamed" / "voice.wav"

    stored = asyncio.run(
        save_uploaded_sample_stream(
            make_upload_file("voice.wav", b"streamed-sample", "audio/wav"),
            destination,
            settings,
            max_bytes=20,
        )
    )

    assert destination.read_bytes() == b"streamed-sample"
    assert stored.path == destination
    assert stored.filename == "voice.wav"
    assert stored.content_type == "audio/wav"
    assert stored.sha256 == sample_hash(b"streamed-sample")


def test_streamed_upload_rejects_oversized_file_and_cleans_partial(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    destination = tmp_path / "streamed" / "voice.wav"

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            save_uploaded_sample_stream(
                make_upload_file("voice.wav", b"too-large", "audio/wav"),
                destination,
                settings,
                max_bytes=5,
            )
        )

    assert exc.value.status_code == 413
    assert exc.value.detail == "Uploaded voice sample must be 5 bytes or smaller."
    assert not destination.exists()
    assert not destination.with_suffix(".wav.tmp").exists()


def test_streamed_upload_rejects_empty_file_and_cleans_partial(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    destination = tmp_path / "streamed" / "voice.wav"

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            save_uploaded_sample_stream(
                make_upload_file("voice.wav", b"", "audio/wav"),
                destination,
                settings,
            )
        )

    assert exc.value.status_code == 422
    assert exc.value.detail == "Uploaded voice sample is empty."
    assert not destination.exists()
    assert not destination.with_suffix(".wav.tmp").exists()


def test_streamed_upload_rejects_invalid_audio(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            save_uploaded_sample_stream(
                make_upload_file("notes.txt", b"not-audio", "text/plain"),
                tmp_path / "streamed" / "notes.txt",
                settings,
            )
        )

    assert exc.value.status_code == 422
    assert "Voice sample must be an audio file" in exc.value.detail


def test_settings_reads_speech_job_segment_gap_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("SPEECH_JOB_SEGMENT_GAP_MS", "125")

    settings = Settings.from_env()

    assert settings.speech_job_segment_gap_ms == 125


def test_settings_reports_invalid_speech_job_segment_gap_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("SPEECH_JOB_SEGMENT_GAP_MS", "fast")

    with pytest.raises(ValueError, match="SPEECH_JOB_SEGMENT_GAP_MS must be a non-negative integer."):
        Settings.from_env()


def test_settings_reads_diarization_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ROOT", str(tmp_path))
    monkeypatch.setenv("SAMPLE_PROCESSING_ENABLE_DIARIZATION", "1")
    monkeypatch.setenv("SAMPLE_PROCESSING_PYANNOTE_MODEL", "pyannote/custom")
    monkeypatch.setenv("SAMPLE_PROCESSING_HF_TOKEN", "hf_test")
    monkeypatch.setenv("SAMPLE_PROCESSING_WHISPER_MODEL", "small")
    monkeypatch.setenv("SAMPLE_PROCESSING_WHISPER_DEVICE", "cpu")
    monkeypatch.setenv("SAMPLE_PROCESSING_WHISPER_COMPUTE_TYPE", "int8_float16")

    settings = Settings.from_env()

    assert settings.sample_processing_enable_diarization is True
    assert settings.sample_processing_pyannote_model == "pyannote/custom"
    assert settings.sample_processing_hf_token == "hf_test"
    assert settings.sample_processing_whisper_model == "small"
    assert settings.sample_processing_whisper_device == "cpu"
    assert settings.sample_processing_whisper_compute_type == "int8_float16"


def write_fake_command(path: Path, body: str) -> Path:
    path.write_text(f"#!{sys.executable}\n{body}", encoding="utf-8")
    path.chmod(0o755)
    return path


def optional_path_literal(path: Path | None) -> str:
    return "None" if path is None else repr(str(path))


def demucs_fake_command(
    path: Path,
    *,
    args_path: Path | None = None,
    exit_code: int = 0,
    stderr: str = "demucs failed in test",
) -> Path:
    if exit_code != 0:
        return write_fake_command(
            path,
            f"""
import sys
sys.stderr.write({stderr!r})
raise SystemExit({exit_code})
""",
        )
    return write_fake_command(
        path,
        f"""
from pathlib import Path
import json
import sys
args = sys.argv[1:]
args_path = {optional_path_literal(args_path)}
if args_path:
    Path(args_path).write_text(json.dumps(args), encoding="utf-8")
output_root = Path(args[args.index("-o") + 1])
model = args[args.index("-n") + 1]
source = Path(args[-1])
vocals = output_root / model / source.stem / "vocals.wav"
vocals.parent.mkdir(parents=True, exist_ok=True)
vocals.write_bytes(b"vocals")
""",
    )


def ffmpeg_fake_command(
    path: Path,
    output: bytes = b"normalized-voice",
    sleep_seconds: float = 0,
    *,
    args_path: Path | None = None,
    args_log_path: Path | None = None,
    exit_code: int = 0,
    stderr: str = "ffmpeg failed in test",
) -> Path:
    if exit_code != 0:
        return write_fake_command(
            path,
            f"""
import sys
sys.stderr.write({stderr!r})
raise SystemExit({exit_code})
""",
        )
    return write_fake_command(
        path,
        f"""
from pathlib import Path
import json
import time
import sys
args_path = {optional_path_literal(args_path)}
if args_path:
    Path(args_path).write_text(json.dumps(sys.argv[1:]), encoding="utf-8")
args_log_path = {optional_path_literal(args_log_path)}
if args_log_path:
    log_path = Path(args_log_path)
    entries = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else []
    entries.append(sys.argv[1:])
    log_path.write_text(json.dumps(entries), encoding="utf-8")
time.sleep({sleep_seconds!r})
Path(sys.argv[-1]).write_bytes({output!r})
""",
    )


class FakeDiarizationSegment:
    def __init__(self, start: float, end: float) -> None:
        self.start = start
        self.end = end


class FakeDiarizationAnnotation:
    def itertracks(self, yield_label: bool = False):
        assert yield_label is True
        return iter(
            (
                (FakeDiarizationSegment(0.0, 1.2), None, "SPEAKER_00"),
                (FakeDiarizationSegment(1.2, 2.4), None, "SPEAKER_01"),
                (FakeDiarizationSegment(2.4, 3.6), None, "SPEAKER_00"),
            )
        )


class FakeDiarizationOutput:
    speaker_diarization = FakeDiarizationAnnotation()


class FakeUntranscribedTurnDiarizationAnnotation:
    def itertracks(self, yield_label: bool = False):
        assert yield_label is True
        return iter(
            (
                (FakeDiarizationSegment(0.0, 1.0), None, "SPEAKER_00"),
                (FakeDiarizationSegment(1.0, 2.0), None, "SPEAKER_01"),
            )
        )


class FakeUntranscribedTurnDiarizationOutput:
    speaker_diarization = FakeUntranscribedTurnDiarizationAnnotation()


class FakePyannotePipeline:
    loaded: list[tuple[str, str]] = []

    @classmethod
    def from_pretrained(cls, model_name: str, token: str) -> "FakePyannotePipeline":
        cls.loaded.append((model_name, token))
        return cls()

    def __call__(self, path: str) -> FakeDiarizationOutput:
        assert path.endswith("normalized-source.wav")
        return FakeDiarizationOutput()


class FakeUntranscribedTurnPyannotePipeline(FakePyannotePipeline):
    def __call__(self, path: str) -> FakeUntranscribedTurnDiarizationOutput:
        assert path.endswith("normalized-source.wav")
        return FakeUntranscribedTurnDiarizationOutput()


class SlowPyannotePipeline(FakePyannotePipeline):
    def __call__(self, path: str) -> FakeDiarizationOutput:
        assert path.endswith("normalized-source.wav")
        time.sleep(1.0)
        return FakeDiarizationOutput()


class FakeWhisperWord:
    def __init__(self, word: str, start: float, end: float) -> None:
        self.word = word
        self.start = start
        self.end = end


class FakeWhisperSegment:
    def __init__(self, words: list[FakeWhisperWord]) -> None:
        self.words = words


class FakeWhisperModel:
    loaded: list[tuple[str, str, str]] = []

    def __init__(self, model_name: str, *, device: str, compute_type: str) -> None:
        self.loaded.append((model_name, device, compute_type))

    def transcribe(self, path: str, *, word_timestamps: bool):
        assert path.endswith("normalized-source.wav")
        assert word_timestamps is True
        return (
            [
                FakeWhisperSegment(
                    [
                        FakeWhisperWord("Hello", 0.1, 0.3),
                        FakeWhisperWord("there.", 0.35, 0.7),
                        FakeWhisperWord("General", 1.3, 1.6),
                        FakeWhisperWord("Kenobi.", 1.65, 2.0),
                        FakeWhisperWord("Again.", 2.6, 3.0),
                    ]
                )
            ],
            object(),
        )


class FakePartialWhisperModel(FakeWhisperModel):
    def transcribe(self, path: str, *, word_timestamps: bool):
        assert path.endswith("normalized-source.wav")
        assert word_timestamps is True
        return (
            [
                FakeWhisperSegment(
                    [
                        FakeWhisperWord("Only", 0.1, 0.3),
                        FakeWhisperWord("speaker.", 0.35, 0.7),
                    ]
                )
            ],
            object(),
        )


def demucs_processing_settings(
    tmp_path: Path,
    demucs_command: Path,
    ffmpeg_command: Path,
    **overrides: object,
) -> Settings:
    return replace(
        make_settings(tmp_path),
        sample_processing_engine="demucs",
        sample_processing_demucs_command=str(demucs_command),
        sample_processing_ffmpeg_command=str(ffmpeg_command),
        **overrides,
    )


def ffmpeg_processing_settings(
    tmp_path: Path,
    ffmpeg_command: Path,
    **overrides: object,
) -> Settings:
    return replace(
        make_settings(tmp_path),
        sample_processing_engine="ffmpeg",
        sample_processing_ffmpeg_command=str(ffmpeg_command),
        **overrides,
    )


def test_health_reports_default_sample(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["defaultSampleAvailable"] is True
    assert response.json()["defaultVoiceId"] == "default"


def test_providers_endpoint_returns_public_provider_descriptor(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path, api_key="server-secret")

    response = client.get("/api/providers")

    assert response.status_code == 200
    payload = response.json()
    provider = payload["providers"][0]
    assert payload["defaultProviderId"] == "elevenlabs"
    assert payload["voicePresets"] == [
        {
            "id": "standardNarration",
            "label": "Standard Narration",
            "description": "Balanced clone similarity for steady narration.",
        },
        {
            "id": "animatedDialogue",
            "label": "Animated Dialogue",
            "description": "More expressive delivery for character reads.",
        },
    ]
    assert provider["id"] == "elevenlabs"
    assert provider["label"] == "ElevenLabs"
    assert provider["serverKeyConfigured"] is True
    assert provider["manageKeyUrl"] == "https://elevenlabs.io/app/subscription/api"
    assert provider["docsUrl"] == "https://elevenlabs.io/docs/api-reference/authentication"
    assert [control["id"] for control in provider["tuning"]["controls"]] == [
        "stability",
        "similarityBoost",
        "style",
        "speed",
        "useSpeakerBoost",
    ]
    assert provider["tuning"]["defaultValues"]["useSpeakerBoost"] is True
    assert [preset["id"] for preset in provider["tuning"]["presets"]] == ["standard", "animated"]
    assert [preset["voicePresetId"] for preset in provider["tuning"]["presets"]] == [
        "standardNarration",
        "animatedDialogue",
    ]
    assert provider["sample"] == {
        "maxWindowSeconds": 120,
        "recommendedMinSeconds": 60,
        "recommendedMaxSeconds": 120,
        "targetSampleRateHz": 16000,
        "maxUploadBytes": 10 * 1024 * 1024,
        "maxSourceUploadBytes": 1024 * 1024 * 1024,
    }
    assert provider["links"][0]["label"] == "API Requests"
    assert "server-secret" not in response.text


def test_provider_registry_rejects_duplicate_provider_ids(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    first_provider = FakeElevenLabsProvider().bind_settings(settings)
    duplicate_provider = FakeElevenLabsProvider().bind_settings(settings)

    with pytest.raises(ValueError, match="Duplicate voice provider id: 'elevenlabs'"):
        ProviderRegistry([first_provider, duplicate_provider])


def test_providers_endpoint_reports_missing_server_key_without_secret_data(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path, api_key="")

    response = client.get("/api/providers")

    assert response.status_code == 200
    assert response.json()["providers"][0]["serverKeyConfigured"] is False
    assert "ELEVENLABS_API_KEY" not in response.text


def test_providers_endpoint_treats_whitespace_server_key_as_missing(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path, api_key="   ")

    response = client.get("/api/providers")

    assert response.status_code == 200
    assert response.json()["providers"][0]["serverKeyConfigured"] is False


def test_provider_without_tuning_controls_reports_empty_tuning(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    provider = FakeNoTuningProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([provider], default_provider_id="notuning"),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    client = TestClient(app)

    response = client.get("/api/providers")

    assert response.status_code == 200
    payload = response.json()
    assert payload["defaultProviderId"] == "notuning"
    assert payload["providers"][0]["tuning"] == {
        "controls": [],
        "presets": [],
        "defaultValues": {},
    }


def test_fresh_clone_can_start_without_voice_assets(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path, with_default_sample=False)

    health = client.get("/api/health")
    voices = client.get("/api/voices")
    speech = client.post("/api/speech", data={"text": "Hello."})

    assert health.status_code == 200
    assert health.json()["defaultSampleAvailable"] is False
    assert health.json()["defaultVoiceId"] == ""
    assert voices.status_code == 200
    assert voices.json() == {"defaultVoiceId": "", "voices": []}
    assert speech.status_code == 422
    assert speech.json()["detail"] == "Add or select a voice before generating speech."
    assert fake_client.created_samples == []


def test_speech_job_generates_segments_and_combined_result(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake", output=b"combined-mp3")),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    with TestClient(app) as client:
        create = client.post(
            "/api/speech/jobs",
            json={
                "text": "Hello there.",
                "defaultVoiceId": "default",
                "modelId": "eleven_flash_v2_5",
                "voiceSettings": {"stability": 0.42},
                "segments": [
                    {
                        "clientSegmentId": "segment-one",
                        "text": "Hello ",
                        "voiceId": "default",
                        "assignmentKind": "assigned",
                        "voiceSettings": {"speed": 1.15},
                    },
                    {
                        "clientSegmentId": "segment-two",
                        "text": "there.",
                        "voiceId": "default",
                        "assignmentKind": "default",
                    },
                ],
            },
            headers={VOICE_PROVIDER_KEY_HEADER: "browser-secret"},
        )
        job_id = create.json()["job"]["id"]
        job = wait_for_speech_job(client, job_id)
        result = client.get(f"/api/speech/jobs/{job_id}/result")
        segment_result = client.get(f"/api/speech/jobs/{job_id}/segments/segment-one/result")

    assert create.status_code == 202
    assert "browser-secret" not in create.text
    assert [request[1] for request in fake_provider.speech_requests] == ["Hello", "there."]
    assert [request[3] for request in fake_provider.speech_requests] == ["eleven_flash_v2_5", "eleven_flash_v2_5"]
    assert fake_provider.speech_requests[0][2]["speed"] == 1.15
    assert fake_provider.speech_requests[1][2]["stability"] == 0.42
    assert job["status"] == "success"
    assert job["activeSegmentId"] is None
    assert job["segmentGapMs"] == 250
    assert job["resultSha256"] == sample_hash(b"combined-mp3")
    assert [segment["id"] for segment in job["segments"]] == ["segment-one", "segment-two"]
    assert [segment["voiceSettings"] for segment in job["segments"]] == [{"speed": 1.15}, {"stability": 0.42}]
    assert [segment["status"] for segment in job["segments"]] == ["success", "success"]
    assert [segment["generationCount"] for segment in job["segments"]] == [1, 1]
    assert job["segments"][0]["resultSha256"] == sample_hash(b"fake-mp3")
    assert result.status_code == 200
    assert result.content == b"combined-mp3"
    assert result.headers["content-type"].startswith("audio/mpeg")
    assert segment_result.status_code == 200
    assert segment_result.content == b"fake-mp3"


def test_speech_job_rejects_segments_that_do_not_match_text(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    client = TestClient(app)

    response = client.post(
        "/api/speech/jobs",
        json={
            "text": "Hello there.",
            "defaultVoiceId": "default",
            "segments": [{"clientSegmentId": "segment-one", "text": "Hello", "voiceId": "default"}],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Speech segments must exactly match the submitted text."
    assert fake_provider.speech_requests == []


def test_speech_job_rejects_negative_segment_gap(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    client = TestClient(app)

    response = client.post(
        "/api/speech/jobs",
        json={
            "text": "Hello.",
            "defaultVoiceId": "default",
            "segmentGapMs": -1,
            "segments": [{"clientSegmentId": "segment-one", "text": "Hello.", "voiceId": "default"}],
        },
    )

    assert response.status_code == 422
    assert fake_provider.speech_requests == []


def test_speech_job_maps_unsafe_client_segment_ids_to_safe_filenames(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    escaped_path = tmp_path / "escaped"
    with TestClient(app) as client:
        create = client.post(
            "/api/speech/jobs",
            json={
                "text": "Hello there.",
                "defaultVoiceId": "default",
                "segments": [
                    {"clientSegmentId": "../escaped", "text": "Hello ", "voiceId": "default"},
                    {"clientSegmentId": escaped_path.as_posix(), "text": "there.", "voiceId": "default"},
                ],
            },
        )
        job = wait_for_speech_job(client, create.json()["job"]["id"])

    assert create.status_code == 202
    assert [segment["text"] for segment in job["segments"]] == ["Hello ", "there."]
    assert all("/" not in segment["id"] and "." not in segment["id"] for segment in job["segments"])
    assert not (tmp_path / "escaped.mp3").exists()
    assert not escaped_path.with_suffix(".mp3").exists()
    segment_dir = settings.speech_jobs_dir / job["id"] / "segments"
    assert {path.name for path in segment_dir.glob("*.mp3")} == {
        f"{job['segments'][0]['id']}.mp3",
        f"{job['segments'][1]['id']}.mp3",
    }


def test_speech_job_rejects_non_object_segment_voice_settings(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    client = TestClient(app)

    response = client.post(
        "/api/speech/jobs",
        json={
            "text": "Hello.",
            "defaultVoiceId": "default",
            "segments": [
                {
                    "clientSegmentId": "segment-one",
                    "text": "Hello.",
                    "voiceId": "default",
                    "voiceSettings": ["not", "an", "object"],
                }
            ],
        },
    )

    assert response.status_code == 422
    assert fake_provider.speech_requests == []


def test_speech_job_regenerates_segment_and_rebuilds_result(tmp_path: Path) -> None:
    args_log_path = tmp_path / "ffmpeg-calls.json"
    ffmpeg_command = ffmpeg_fake_command(
        tmp_path / "ffmpeg-fake",
        output=b"combined-mp3",
        args_log_path=args_log_path,
    )
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_command),
    )
    voice_library = VoiceLibrary(settings)
    second_voice = voice_library.add_processed_sample(
        "Second Voice",
        VoiceSample(
            content=b"second-sample",
            filename="second.wav",
            content_type="audio/wav",
            sha256=sample_hash(b"second-sample"),
        ),
        processing_steps=(),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=voice_library,
    )
    with TestClient(app) as client:
        create = client.post(
            "/api/speech/jobs",
            json={
                "text": "Hello there.",
                "defaultVoiceId": "default",
                "segmentGapMs": 0,
                "voiceSettings": {"stability": 0.42, "speed": 0.95},
                "segments": [
                    {
                        "clientSegmentId": "segment-one",
                        "text": "Hello ",
                        "voiceId": "default",
                        "voiceSettings": {"speed": 1.1},
                    },
                    {"clientSegmentId": "segment-two", "text": "there.", "voiceId": "default"},
                ],
            },
        )
        job_id = create.json()["job"]["id"]
        initial_job = wait_for_speech_job(client, job_id)
        regenerate = client.post(
            f"/api/speech/jobs/{job_id}/segments/segment-one/regenerate",
            json={"voiceId": second_voice.id},
        )
        first_regenerated_job = wait_for_speech_job(client, job_id)
        regenerate_with_tuning = client.post(
            f"/api/speech/jobs/{job_id}/segments/segment-one/regenerate",
            json={"voiceSettings": {"stability": 0.36, "speed": 1.2}},
        )
        job = wait_for_speech_job(client, job_id)
        result = client.get(f"/api/speech/jobs/{job_id}/result")

    assert regenerate.status_code == 202
    assert regenerate_with_tuning.status_code == 202
    assert initial_job["segmentGapMs"] == 0
    assert len(fake_provider.speech_requests) == 4
    assert len(fake_provider.created_samples) == 2
    assert fake_provider.created_samples[1].sha256 == sample_hash(b"second-sample")
    assert initial_job["segments"][0]["voiceSettings"] == {"speed": 1.1}
    assert initial_job["segments"][1]["voiceSettings"] == {"stability": 0.42, "speed": 0.95}
    assert first_regenerated_job["segments"][0]["voiceSettings"] == {"speed": 1.1}
    assert fake_provider.speech_requests[2][2]["speed"] == 1.1
    assert fake_provider.speech_requests[3][2]["stability"] == 0.36
    assert fake_provider.speech_requests[3][2]["speed"] == 1.2
    assert job["status"] == "success"
    assert job["segmentGapMs"] == 0
    assert job["segments"][0]["voiceId"] == second_voice.id
    assert job["segments"][0]["voiceName"] == "Second Voice"
    assert job["segments"][0]["voiceSettings"] == {"stability": 0.36, "speed": 1.2}
    assert job["segments"][0]["generationCount"] == 3
    assert result.content == b"combined-mp3"
    concat_manifest = (settings.speech_jobs_dir / job_id / "concat.txt").read_text(encoding="utf-8")
    assert "segment-gap" not in concat_manifest
    assert len(json.loads(args_log_path.read_text(encoding="utf-8"))) == 3


def test_speech_job_regenerates_all_segments_for_voice(tmp_path: Path) -> None:
    args_log_path = tmp_path / "ffmpeg-calls.json"
    ffmpeg_command = ffmpeg_fake_command(
        tmp_path / "ffmpeg-fake",
        output=b"combined-mp3",
        args_log_path=args_log_path,
    )
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_command),
    )
    voice_library = VoiceLibrary(settings)
    second_voice = voice_library.add_processed_sample(
        "Second Voice",
        VoiceSample(
            content=b"second-sample",
            filename="second.wav",
            content_type="audio/wav",
            sha256=sample_hash(b"second-sample"),
        ),
        processing_steps=(),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=voice_library,
    )
    with TestClient(app) as client:
        create = client.post(
            "/api/speech/jobs",
            json={
                "text": "One. Two. Three.",
                "defaultVoiceId": "default",
                "segmentGapMs": 0,
                "voiceSettings": {"stability": 0.42},
                "segments": [
                    {"clientSegmentId": "segment-one", "text": "One. ", "voiceId": "default"},
                    {"clientSegmentId": "segment-two", "text": "Two. ", "voiceId": second_voice.id},
                    {"clientSegmentId": "segment-three", "text": "Three.", "voiceId": "default"},
                ],
            },
        )
        job_id = create.json()["job"]["id"]
        initial_job = wait_for_speech_job(client, job_id)
        regenerate = client.post(
            f"/api/speech/jobs/{job_id}/voices/default/regenerate",
            json={"voiceSettings": {"speed": 1.2}},
        )
        job = wait_for_speech_job(client, job_id)
        result = client.get(f"/api/speech/jobs/{job_id}/result")

    assert regenerate.status_code == 202
    assert initial_job["segments"][0]["voiceSettings"] == {"stability": 0.42}
    assert initial_job["segments"][1]["voiceSettings"] == {"stability": 0.42}
    assert initial_job["segments"][2]["voiceSettings"] == {"stability": 0.42}
    assert job["status"] == "success"
    assert [segment["generationCount"] for segment in job["segments"]] == [2, 1, 2]
    assert job["segments"][0]["voiceSettings"] == {"speed": 1.2}
    assert job["segments"][1]["voiceSettings"] == {"stability": 0.42}
    assert job["segments"][2]["voiceSettings"] == {"speed": 1.2}
    assert fake_provider.speech_requests[3][1] == "One."
    assert fake_provider.speech_requests[3][2]["speed"] == 1.2
    assert fake_provider.speech_requests[4][1] == "Three."
    assert fake_provider.speech_requests[4][2]["speed"] == 1.2
    assert result.content == b"combined-mp3"
    assert len(json.loads(args_log_path.read_text(encoding="utf-8"))) == 2


def test_speech_job_voice_regeneration_rejects_missing_matching_segments(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    voice_library = VoiceLibrary(settings)
    second_voice = voice_library.add_processed_sample(
        "Second Voice",
        VoiceSample(
            content=b"second-sample",
            filename="second.wav",
            content_type="audio/wav",
            sha256=sample_hash(b"second-sample"),
        ),
        processing_steps=(),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=voice_library,
    )
    with TestClient(app) as client:
        create = client.post(
            "/api/speech/jobs",
            json={
                "text": "Hello.",
                "defaultVoiceId": "default",
                "segments": [{"clientSegmentId": "segment-one", "text": "Hello.", "voiceId": "default"}],
            },
        )
        job_id = create.json()["job"]["id"]
        wait_for_speech_job(client, job_id)
        response = client.post(
            f"/api/speech/jobs/{job_id}/voices/{second_voice.id}/regenerate",
            json={"voiceSettings": {"speed": 1.2}},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Speech job has no successful segments for that voice."


def test_speech_job_voice_regeneration_requires_successful_job(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    fake_provider.create_speech_delay = 5
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    with TestClient(app) as client:
        create = client.post(
            "/api/speech/jobs",
            json={
                "text": "Hello.",
                "defaultVoiceId": "default",
                "segments": [{"clientSegmentId": "segment-one", "text": "Hello.", "voiceId": "default"}],
            },
        )
        job_id = create.json()["job"]["id"]
        response = client.post(
            f"/api/speech/jobs/{job_id}/voices/default/regenerate",
            json={"voiceSettings": {"speed": 1.2}},
        )
        cancel = client.post(f"/api/speech/jobs/{job_id}/cancel")

    assert response.status_code == 409
    assert response.json()["detail"] == "Speech job is already running."
    assert cancel.status_code == 200


def test_speech_job_cancel_marks_running_job_canceled(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    fake_provider.create_speech_delay = 5
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    with TestClient(app) as client:
        create = client.post(
            "/api/speech/jobs",
            json={
                "text": "Hello.",
                "defaultVoiceId": "default",
                "segments": [{"clientSegmentId": "segment-one", "text": "Hello.", "voiceId": "default"}],
            },
        )
        job_id = create.json()["job"]["id"]
        cancel = client.post(f"/api/speech/jobs/{job_id}/cancel")
        result = client.get(f"/api/speech/jobs/{job_id}/result")

    assert create.status_code == 202
    assert cancel.status_code == 200
    assert cancel.json()["job"]["status"] == "canceled"
    assert cancel.json()["job"]["activeSegmentId"] is None
    assert result.status_code == 409


@pytest.mark.parametrize(
    ("command_factory", "timeout_seconds", "expected_error"),
    [
        (lambda path: path / "missing-ffmpeg", 1, "ffmpeg command was not found."),
        (
            lambda path: ffmpeg_fake_command(path / "ffmpeg-fake", exit_code=7),
            1,
            "ffmpeg failed with exit code 7. ffmpeg failed in test",
        ),
        (
            lambda path: ffmpeg_fake_command(path / "ffmpeg-fake", sleep_seconds=1),
            0.05,
            "ffmpeg timed out.",
        ),
    ],
)
def test_speech_job_reports_ffmpeg_errors(
    tmp_path: Path,
    command_factory: Callable[[Path], Path],
    timeout_seconds: float,
    expected_error: str,
) -> None:
    ffmpeg_command = command_factory(tmp_path)
    settings = replace(
        make_settings(tmp_path),
        sample_processing_ffmpeg_command=str(ffmpeg_command),
        sample_processing_timeout_seconds=timeout_seconds,
    )
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    with TestClient(app) as client:
        create = client.post(
            "/api/speech/jobs",
            json={
                "text": "Hello.",
                "defaultVoiceId": "default",
                "segments": [{"clientSegmentId": "segment-one", "text": "Hello.", "voiceId": "default"}],
            },
        )
        job = wait_for_speech_job(client, create.json()["job"]["id"], status="error")

        assert create.status_code == 202
        assert job["status"] == "error"
        assert job["error"] == expected_error
        assert job["activeSegmentId"] is None
        assert job["segments"][0]["status"] == "success"
        assert client.get(f"/api/speech/jobs/{job['id']}/segments/{job['segments'][0]['id']}/result").status_code == 200
        assert client.get(f"/api/speech/jobs/{job['id']}/result").status_code == 409


def test_voice_manifest_bootstraps_default_voice(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/voices")

    assert response.status_code == 200
    assert response.json()["defaultVoiceId"] == "default"
    assert response.json()["voices"][0]["name"] == "Default voice"
    assert response.json()["voices"][0]["filePath"] == "default/default-voice.mp3"
    assert response.json()["voices"][0]["voicePresetId"] == "standardNarration"
    assert response.json()["voices"][0]["voiceSettingsByProvider"] == {}


def test_voice_manifest_migrates_legacy_assets_with_excerpt_defaults(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, with_default_sample=False)
    sample_path = settings.voice_assets_dir / "legacy.mp3"
    sample_path.parent.mkdir(parents=True)
    sample_path.write_bytes(b"legacy-sample")
    settings.voice_manifest_path.write_text(
        json.dumps(
            {
                "version": 1,
                "defaultVoiceId": "legacy",
                "voices": [
                    {
                        "id": "legacy",
                        "name": "Legacy Voice",
                        "filePath": "legacy.mp3",
                        "contentType": "audio/mpeg",
                        "sha256": "legacy-hash",
                        "source": "upload",
                        "createdAt": "2026-05-28T00:00:00+00:00",
                        "voicePresetId": "unsupported",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    payload = VoiceLibrary(settings).list_payload()

    voice = payload["voices"][0]
    assert voice["sampleMode"] == "excerpt"
    assert voice["windowStartSeconds"] is None
    assert voice["windowDurationSeconds"] is None
    assert voice["sourceFilePath"] is None
    assert voice["voicePresetId"] == "standardNarration"
    assert voice["voiceSettingsByProvider"] == {}
    assert voice["processingSteps"] == []
    migrated_voice = json.loads(settings.voice_manifest_path.read_text(encoding="utf-8"))["voices"][0]
    assert migrated_voice["sampleMode"] == "excerpt"
    assert migrated_voice["voicePresetId"] == "standardNarration"
    assert migrated_voice["voiceSettingsByProvider"] == {}
    assert migrated_voice["processingSteps"] == []


def test_voice_manifest_normalizes_provider_tuning_keys(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, with_default_sample=False)
    sample_path = settings.voice_assets_dir / "legacy.mp3"
    sample_path.parent.mkdir(parents=True)
    sample_path.write_bytes(b"legacy-sample")
    settings.voice_manifest_path.write_text(
        json.dumps(
            {
                "version": 1,
                "defaultVoiceId": "legacy",
                "voices": [
                    {
                        "id": "legacy",
                        "name": "Legacy Voice",
                        "filePath": "legacy.mp3",
                        "contentType": "audio/mpeg",
                        "sha256": "legacy-hash",
                        "source": "upload",
                        "createdAt": "2026-05-28T00:00:00+00:00",
                        "voicePresetId": "standardNarration",
                        "voiceSettingsByProvider": {
                            " elevenlabs ": {"speed": 1.15},
                            "  ": {"speed": 1.2},
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    payload = VoiceLibrary(settings).list_payload()

    voice = payload["voices"][0]
    assert voice["voiceSettingsByProvider"] == {"elevenlabs": {"speed": 1.15}}
    migrated_voice = json.loads(settings.voice_manifest_path.read_text(encoding="utf-8"))["voices"][0]
    assert migrated_voice["voiceSettingsByProvider"] == {"elevenlabs": {"speed": 1.15}}


def test_voice_manifest_loads_legacy_processing_steps_without_preset_metadata(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, with_default_sample=False)
    sample_path = settings.voice_assets_dir / "legacy.wav"
    sample_path.parent.mkdir(parents=True)
    sample_path.write_bytes(b"legacy-sample")
    settings.voice_manifest_path.write_text(
        json.dumps(
            {
                "version": 1,
                "defaultVoiceId": "legacy",
                "voices": [
                    {
                        "id": "legacy",
                        "name": "Legacy Voice",
                        "filePath": "legacy.wav",
                        "contentType": "audio/wav",
                        "sha256": "legacy-hash",
                        "source": "upload",
                        "createdAt": "2026-05-28T00:00:00+00:00",
                        "voicePresetId": "standardNarration",
                        "processingSteps": [
                            {
                                "id": "job-legacy",
                                "label": "Isolate Voice",
                                "operationId": "isolateVoice",
                                "createdAt": "2026-06-19T00:00:00+00:00",
                                "sourceSha256": "source-hash",
                                "resultSha256": "result-hash",
                                "engine": "demucs",
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    asset = VoiceLibrary(settings).list_assets()[0]

    assert asset.processing_steps[0].processing_preset_id is None
    assert asset.processing_steps[0].processing_preset_label is None


def test_voice_manifest_processing_preset_ids_follow_model_literal() -> None:
    assert voice_library_module.SAMPLE_PROCESSING_PRESET_IDS == frozenset(get_args(SampleProcessingPresetId))


def test_sample_processing_options_report_unavailable_default_processor(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/sample-processing/options")
    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice"},
        files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
    )

    assert response.status_code == 200
    operations = response.json()["operations"]
    assert [operation["id"] for operation in operations] == ["isolateVoice", "trimSilence", "separateSpeakers"]
    assert all(operation["enabled"] is False for operation in operations)
    assert create.status_code == 503
    assert create.json()["detail"] == "Sample processing is not available. Configure a processor to use this operation."


def test_sample_processing_options_include_isolation_presets(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings=settings, sample_processor=FakeSampleProcessor())
    client = TestClient(app)

    response = client.get("/api/sample-processing/options")

    assert response.status_code == 200
    operation = response.json()["operations"][0]
    assert operation["id"] == "isolateVoice"
    assert operation["enabled"] is True
    assert operation["defaultProcessingPresetId"] == "balanced"
    assert operation["processingPresets"] == [
        {
            "id": "fast",
            "label": "Fast",
            "description": "Quickest preview with lighter separation quality.",
        },
        {
            "id": "balanced",
            "label": "Balanced",
            "description": "Default vocal isolation quality and runtime.",
        },
        {
            "id": "clean",
            "label": "Clean",
            "description": "Balanced isolation with conservative cleanup for background residue.",
        },
        {
            "id": "maxIsolation",
            "label": "Max Isolation",
            "description": "Slower, strongest separation attempt for difficult tracks.",
        },
    ]


def test_ffmpeg_sample_processor_options_enable_trim_silence(tmp_path: Path) -> None:
    settings = ffmpeg_processing_settings(tmp_path, ffmpeg_fake_command(tmp_path / "ffmpeg-fake"))
    with TestClient(create_app(settings=settings)) as client:
        response = client.get("/api/sample-processing/options")

    assert response.status_code == 200
    operations = response.json()["operations"]
    assert operations[0]["id"] == "isolateVoice"
    assert operations[0]["enabled"] is False
    assert operations[1]["id"] == "trimSilence"
    assert operations[1]["enabled"] is True
    assert operations[1]["defaultProcessingPresetId"] == "trimBalanced"
    assert operations[1]["processingPresets"] == [
        {
            "id": "trimLight",
            "label": "Light",
            "description": "Conservative trimming for only quieter or longer empty regions.",
        },
        {
            "id": "trimBalanced",
            "label": "Balanced",
            "description": "Default silence trimming with a small amount of preserved room tone.",
        },
        {
            "id": "trimAggressive",
            "label": "Aggressive",
            "description": "Tighter trimming for shorter or louder empty regions.",
        },
    ]
    assert operations[2]["id"] == "separateSpeakers"
    assert operations[2]["enabled"] is False


def test_sample_processor_combines_diarization_with_existing_engine(tmp_path: Path) -> None:
    settings = replace(
        ffmpeg_processing_settings(tmp_path, ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
        sample_processing_enable_diarization=True,
    )

    processor = create_sample_processor(settings)
    operations = {operation.id: operation for operation in processor.operations()}

    assert isinstance(processor, CompositeSampleProcessor)
    assert operations["trimSilence"].enabled is True
    assert operations["separateSpeakers"].enabled is True
    assert processor.engine_name_for_operation("trimSilence") == "ffmpeg"
    assert processor.engine_name_for_operation("separateSpeakers") == "pyannote-community-1+faster-whisper"


def test_sample_processing_options_include_engine_and_recommended_stack_order(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings=settings, sample_processor=FakeStackSampleProcessor())
    client = TestClient(app)

    response = client.get("/api/sample-processing/options")

    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "fake-stack"
    assert payload["recommendedWorkflowOrder"] == ["isolateVoice", "separateSpeakers", "trimSilence"]


def test_demucs_sample_processor_options_enable_isolation_and_trim_silence(tmp_path: Path) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(tmp_path / "demucs-fake"),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake"),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.get("/api/sample-processing/options")

    operations = response.json()["operations"]
    assert response.status_code == 200
    assert operations[0]["id"] == "isolateVoice"
    assert operations[0]["enabled"] is True
    assert operations[1]["id"] == "trimSilence"
    assert operations[1]["enabled"] is True
    assert operations[1]["defaultProcessingPresetId"] == "trimBalanced"


def test_sample_processing_stack_runs_single_audio_steps_in_recommended_order_and_saves_metadata(
    tmp_path: Path,
) -> None:
    settings = make_settings(tmp_path)
    processor = FakeStackSampleProcessor()
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)
    workflow_steps = [
        {"operationId": "trimSilence", "processingPresetId": "trimAggressive"},
        {"operationId": "isolateVoice", "processingPresetId": "clean"},
    ]

    create = client.post(
        "/api/sample-processing/jobs",
        data={"workflowSteps": json.dumps(workflow_steps)},
        files={"sourceFile": ("source.wav", b"raw-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    job = wait_for_processing_job(client, job_id)
    result = client.get(f"/api/sample-processing/jobs/{job_id}/result")
    save = client.post(
        f"/api/sample-processing/jobs/{job_id}/voice",
        json={"name": "Stacked Voice", "voicePresetId": "standardNarration"},
    )

    assert create.status_code == 202
    assert [request.operation_id for request in processor.requests] == ["isolateVoice", "trimSilence"]
    assert processor.requests[1].source.content == b"isolated:raw-source"
    assert job["workflowMode"] == "stack"
    assert job["operationId"] == "trimSilence"
    assert job["activeStepId"] is None
    assert [step["operationId"] for step in job["steps"]] == ["isolateVoice", "trimSilence"]
    assert [step["status"] for step in job["steps"]] == ["success", "success"]
    assert job["steps"][0]["processingPresetId"] == "clean"
    assert job["steps"][1]["processingPresetId"] == "trimAggressive"
    assert job["steps"][0]["sourceSha256"] == sample_hash(b"raw-source")
    assert job["steps"][0]["resultSha256"] == sample_hash(b"isolated:raw-source")
    assert job["steps"][1]["sourceSha256"] == sample_hash(b"isolated:raw-source")
    assert job["steps"][1]["resultSha256"] == sample_hash(b"trimmed:isolated:raw-source")
    assert result.status_code == 200
    assert result.content == b"trimmed:isolated:raw-source"
    assert save.status_code == 201
    voice = save.json()["voice"]
    assert [step["operationId"] for step in voice["processingSteps"]] == ["isolateVoice", "trimSilence"]
    assert voice["processingSteps"][0]["sourceSha256"] == sample_hash(b"raw-source")
    assert voice["processingSteps"][1]["resultSha256"] == sample_hash(b"trimmed:isolated:raw-source")


def test_sample_processing_cancel_marks_running_stack_canceled(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeStackSampleProcessor(delay_seconds=5)
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)

    create = client.post(
        "/api/sample-processing/jobs",
        data={
            "workflowSteps": json.dumps(
                [
                    {"operationId": "isolateVoice", "processingPresetId": "balanced"},
                    {"operationId": "trimSilence", "processingPresetId": "trimBalanced"},
                ]
            )
        },
        files={"sourceFile": ("source.wav", b"raw-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]

    cancel = client.post(f"/api/sample-processing/jobs/{job_id}/cancel")
    repeat_cancel = client.post(f"/api/sample-processing/jobs/{job_id}/cancel")
    result = client.get(f"/api/sample-processing/jobs/{job_id}/result")

    assert create.status_code == 202
    assert cancel.status_code == 200
    job = cancel.json()["job"]
    assert job["status"] == "canceled"
    assert job["error"] == "Sample processing was canceled."
    assert job["activeStepId"] is None
    assert [step["status"] for step in job["steps"]] in (
        ["canceled", "canceled"],
        ["canceled", "pending"],
    )
    assert repeat_cancel.status_code == 200
    assert repeat_cancel.json()["job"]["status"] == "canceled"
    assert result.status_code == 409


def test_sample_processing_job_uses_original_voice_source_and_saves_result_as_voice(tmp_path: Path) -> None:
    settings = make_settings(
        tmp_path,
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    voice_library = VoiceLibrary(settings)
    processor = FakeSampleProcessor()
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_library=voice_library,
        sample_processor=processor,
    )
    client = TestClient(app)
    upload = client.post(
        "/api/voices",
        data={
            "name": "Voice_Clone_01",
            "sampleMode": "sourceWindow",
            "windowStartSeconds": "0",
            "windowDurationSeconds": "30",
        },
        files={
            "sampleFile": ("active.wav", b"active-excerpt", "audio/wav"),
            "sourceFile": ("source.wav", b"original-source", "audio/wav"),
        },
    )

    response = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice", "sourceVoiceId": "voice-clone-01"},
    )
    assert response.status_code == 202
    job_id = response.json()["job"]["id"]
    job = wait_for_processing_job(client, job_id)
    result = client.get(f"/api/sample-processing/jobs/{job_id}/result")
    save = client.post(
        f"/api/sample-processing/jobs/{job_id}/voice",
        json={"name": "Voice Clone 01 Isolated", "voicePresetId": "animatedDialogue"},
    )
    speech = client.post("/api/speech", data={"text": "Use processed sample.", "voiceId": "voice-clone-01-isolated"})

    assert upload.status_code == 201
    assert processor.requests[0].source_path == settings.voice_assets_dir / "sources" / "voice-clone-01.wav"
    assert processor.requests[0].source.content == b""
    assert processor.requests[0].source.sha256 == sample_hash(b"original-source")
    assert processor.requests[0].processing_preset_id == "balanced"
    assert processor.requests[0].processing_preset_label == "Balanced"
    assert job["status"] == "success"
    assert job["processingPresetId"] == "balanced"
    assert job["processingPresetLabel"] == "Balanced"
    assert job["result"]["filename"] == "result.wav"
    assert result.status_code == 200
    assert result.headers["content-type"].startswith("audio/wav")
    assert result.content == b"isolated-voice"
    assert save.status_code == 201
    voice = save.json()["voice"]
    assert voice["id"] == "voice-clone-01-isolated"
    assert voice["name"] == "Voice Clone 01 Isolated"
    assert voice["contentType"] == "audio/wav"
    assert voice["sha256"] == sample_hash(b"isolated-voice")
    assert voice["voicePresetId"] == "animatedDialogue"
    assert voice["processingSteps"] == [
        {
            "id": job_id,
            "label": "Isolate Voice",
            "operationId": "isolateVoice",
            "createdAt": voice["processingSteps"][0]["createdAt"],
            "sourceSha256": sample_hash(b"original-source"),
            "resultSha256": sample_hash(b"isolated-voice"),
            "engine": "fake-processor",
            "processingPresetId": "balanced",
            "processingPresetLabel": "Balanced",
        }
    ]
    assert (settings.voice_assets_dir / "voice-clone-01-isolated.wav").read_bytes() == b"isolated-voice"
    assert speech.status_code == 200


def test_sample_processing_original_fallback_uses_active_sample_sha(tmp_path: Path) -> None:
    settings = make_settings(
        tmp_path,
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    voice_library = VoiceLibrary(settings)
    processor = FakeSampleProcessor()
    app = create_app(
        settings=settings,
        voice_library=voice_library,
        sample_processor=processor,
    )
    client = TestClient(app)
    upload = client.post(
        "/api/voices",
        data={
            "name": "Voice_Clone_01",
            "sampleMode": "sourceWindow",
            "windowStartSeconds": "0",
            "windowDurationSeconds": "30",
        },
        files={
            "sampleFile": ("active.wav", b"active-excerpt", "audio/wav"),
            "sourceFile": ("source.wav", b"original-source", "audio/wav"),
        },
    )
    retained_source_path = settings.voice_assets_dir / "sources" / "voice-clone-01.wav"
    retained_source_path.unlink()

    response = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice", "sourceVoiceId": "voice-clone-01"},
    )
    job = wait_for_processing_job(client, response.json()["job"]["id"])

    assert upload.status_code == 201
    assert response.status_code == 202
    assert processor.requests[0].source_path == settings.voice_assets_dir / "voice-clone-01.wav"
    assert processor.requests[0].source.sha256 == sample_hash(b"normalized-voice")
    assert job["sourceSha256"] == sample_hash(b"normalized-voice")
    assert job["steps"][0]["sourceSha256"] == sample_hash(b"normalized-voice")


def test_sample_processing_speaker_separation_contract_updates_and_saves_speakers(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeSpeakerSeparationProcessor()
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)

    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "separateSpeakers"},
        files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    job = wait_for_processing_job(client, job_id)
    source = client.get(f"/api/sample-processing/jobs/{job_id}/source")
    speaker_stream = client.get(f"/api/sample-processing/jobs/{job_id}/speakers/speaker-1/result")
    single_result = client.get(f"/api/sample-processing/jobs/{job_id}/result")

    patch = client.patch(
        f"/api/sample-processing/jobs/{job_id}/speaker-assignments",
        json={
            "speakerNames": [{"speakerId": "speaker-1", "name": "Morgan"}],
            "transcriptAssignments": [{"itemId": "item-2", "speakerId": "speaker-1"}],
        },
    )
    updated_job = patch.json()["job"]
    updated_speaker_stream = client.get(f"/api/sample-processing/jobs/{job_id}/speakers/speaker-1/result")
    save = client.post(
        f"/api/sample-processing/jobs/{job_id}/speaker-voices",
        json={
            "voices": [
                {"speakerId": "speaker-1", "name": "Morgan", "voicePresetId": "animatedDialogue"},
                {"speakerId": "speaker-2", "name": "Riley", "voicePresetId": "standardNarration"},
            ]
        },
    )

    assert create.status_code == 202
    assert processor.requests[0].operation_id == "separateSpeakers"
    assert processor.requests[0].source.content == b""
    assert processor.requests[0].source_path.read_bytes() == b"speaker-source"
    assert job["status"] == "success"
    assert job["engine"] == "fake-diarization"
    assert job["result"] == {
        "kind": "speakerSeparation",
        "speakers": [
            {
                "id": "speaker-1",
                "label": "Speaker 1",
                "assignedName": None,
                "transcriptItemIds": ["item-1", "item-3"],
                "result": {
                    "path": f"{job_id}/speaker-1.wav",
                    "filename": "speaker-1.wav",
                    "contentType": "audio/wav",
                    "sha256": sample_hash(b"speaker-one"),
                },
            },
            {
                "id": "speaker-2",
                "label": "Speaker 2",
                "assignedName": None,
                "transcriptItemIds": ["item-2"],
                "result": {
                    "path": f"{job_id}/speaker-2.wav",
                    "filename": "speaker-2.wav",
                    "contentType": "audio/wav",
                    "sha256": sample_hash(b"speaker-two"),
                },
            },
        ],
        "transcript": {
            "items": [
                {
                    "id": "item-1",
                    "text": "Hello there.",
                    "startSeconds": 0.0,
                    "endSeconds": 1.2,
                    "speakerId": "speaker-1",
                },
                {
                    "id": "item-2",
                    "text": "General Kenobi.",
                    "startSeconds": 1.3,
                    "endSeconds": 2.4,
                    "speakerId": "speaker-2",
                },
                {
                    "id": "item-3",
                    "text": "You are a bold one.",
                    "startSeconds": 2.6,
                    "endSeconds": 4.0,
                    "speakerId": "speaker-1",
                },
            ],
        },
    }
    assert source.status_code == 200
    assert source.content == b"speaker-source"
    assert speaker_stream.status_code == 200
    assert speaker_stream.content == b"speaker-one"
    assert single_result.status_code == 409
    assert single_result.json()["detail"] == "Speaker separation jobs expose per-speaker audio results."

    assert patch.status_code == 200
    assert processor.assignment_requests[0].speaker_names[0].name == "Morgan"
    assert updated_job["result"]["speakers"][0]["assignedName"] == "Morgan"
    assert updated_job["result"]["speakers"][0]["transcriptItemIds"] == ["item-1", "item-2", "item-3"]
    assert updated_job["result"]["speakers"][1]["transcriptItemIds"] == []
    assert updated_job["result"]["transcript"]["items"][1]["speakerId"] == "speaker-1"
    assert updated_speaker_stream.content == b"speaker-1:item-1,item-2,item-3"

    assert save.status_code == 201
    voices = save.json()["voices"]
    assert [voice["id"] for voice in voices] == ["morgan", "riley"]
    assert [voice["voicePresetId"] for voice in voices] == ["animatedDialogue", "standardNarration"]
    assert voices[0]["processingSteps"] == [
        {
            "id": job_id,
            "label": "Separate Speakers",
            "operationId": "separateSpeakers",
            "createdAt": voices[0]["processingSteps"][0]["createdAt"],
            "sourceSha256": sample_hash(b"speaker-source"),
            "resultSha256": sample_hash(b"speaker-1:item-1,item-2,item-3"),
            "engine": "fake-diarization",
            "speakerId": "speaker-1",
            "speakerLabel": "Speaker 1",
        }
    ]
    assert (settings.voice_assets_dir / "morgan.wav").read_bytes() == b"speaker-1:item-1,item-2,item-3"
    assert (settings.voice_assets_dir / "riley.wav").read_bytes() == b"speaker-2:"


def test_sample_processing_stack_runs_speaker_split_then_trims_each_speaker(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeStackSampleProcessor()
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)
    workflow_steps = [
        {"operationId": "trimSilence", "processingPresetId": "trimBalanced"},
        {"operationId": "separateSpeakers"},
        {"operationId": "isolateVoice", "processingPresetId": "balanced"},
    ]

    create = client.post(
        "/api/sample-processing/jobs",
        data={"workflowSteps": json.dumps(workflow_steps)},
        files={"sourceFile": ("conversation.wav", b"conversation", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    job = wait_for_processing_job(client, job_id)
    source = client.get(f"/api/sample-processing/jobs/{job_id}/source")
    speaker_one = client.get(f"/api/sample-processing/jobs/{job_id}/speakers/speaker-1/result")
    save = client.post(
        f"/api/sample-processing/jobs/{job_id}/speaker-voices",
        json={"voices": [{"speakerId": "speaker-1", "name": "Morgan", "voicePresetId": "animatedDialogue"}]},
    )

    assert create.status_code == 202
    assert [request.operation_id for request in processor.requests] == [
        "isolateVoice",
        "separateSpeakers",
        "trimSilence",
        "trimSilence",
    ]
    assert processor.requests[1].source.content == b"isolated:conversation"
    assert processor.requests[2].source.content == b"speaker-one:isolated:conversation"
    assert processor.requests[3].source.content == b"speaker-two:isolated:conversation"
    assert job["workflowMode"] == "stack"
    assert job["operationId"] == "separateSpeakers"
    assert [step["operationId"] for step in job["steps"]] == ["isolateVoice", "separateSpeakers", "trimSilence"]
    assert [step["status"] for step in job["steps"]] == ["success", "success", "success"]
    assert job["result"]["speakers"][0]["result"]["sha256"] == sample_hash(
        b"trimmed:speaker-one:isolated:conversation"
    )
    assert source.status_code == 200
    assert source.content == b"isolated:conversation"
    assert speaker_one.status_code == 200
    assert speaker_one.content == b"trimmed:speaker-one:isolated:conversation"
    assert save.status_code == 201
    processing_steps = save.json()["voices"][0]["processingSteps"]
    assert [step["operationId"] for step in processing_steps] == ["isolateVoice", "separateSpeakers", "trimSilence"]
    assert processing_steps[1]["speakerId"] == "speaker-1"
    assert processing_steps[1]["resultSha256"] == sample_hash(b"speaker-one:isolated:conversation")
    assert processing_steps[2]["speakerId"] == "speaker-1"
    assert processing_steps[2]["sourceSha256"] == sample_hash(b"speaker-one:isolated:conversation")
    assert processing_steps[2]["resultSha256"] == sample_hash(b"trimmed:speaker-one:isolated:conversation")


def test_sample_processing_stack_retrims_speaker_assignment_updates(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeStackSampleProcessor()
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)
    workflow_steps = [
        {"operationId": "isolateVoice", "processingPresetId": "balanced"},
        {"operationId": "separateSpeakers"},
        {"operationId": "trimSilence", "processingPresetId": "trimBalanced"},
    ]

    create = client.post(
        "/api/sample-processing/jobs",
        data={"workflowSteps": json.dumps(workflow_steps)},
        files={"sourceFile": ("conversation.wav", b"conversation", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    wait_for_processing_job(client, job_id)
    patch = client.patch(
        f"/api/sample-processing/jobs/{job_id}/speaker-assignments",
        json={"transcriptAssignments": [{"itemId": "item-2", "speakerId": "speaker-1"}]},
    )
    updated_job = patch.json()["job"]
    speaker_one = client.get(f"/api/sample-processing/jobs/{job_id}/speakers/speaker-1/result")
    save = client.post(
        f"/api/sample-processing/jobs/{job_id}/speaker-voices",
        json={"voices": [{"speakerId": "speaker-1", "name": "Morgan", "voicePresetId": "animatedDialogue"}]},
    )

    assert create.status_code == 202
    assert patch.status_code == 200
    assert [request.operation_id for request in processor.requests] == [
        "isolateVoice",
        "separateSpeakers",
        "trimSilence",
        "trimSilence",
        "trimSilence",
        "trimSilence",
    ]
    assert processor.requests[4].source.content == b"speaker-1:item-1,item-2"
    assert processor.requests[5].source.content == b"speaker-2:"
    assert updated_job["result"]["speakers"][0]["result"]["sha256"] == sample_hash(
        b"trimmed:speaker-1:item-1,item-2"
    )
    assert speaker_one.status_code == 200
    assert speaker_one.content == b"trimmed:speaker-1:item-1,item-2"
    assert save.status_code == 201
    processing_steps = save.json()["voices"][0]["processingSteps"]
    assert [step["operationId"] for step in processing_steps] == ["isolateVoice", "separateSpeakers", "trimSilence"]
    assert processing_steps[1]["resultSha256"] == sample_hash(b"speaker-1:item-1,item-2")
    assert processing_steps[2]["sourceSha256"] == sample_hash(b"speaker-1:item-1,item-2")
    assert processing_steps[2]["resultSha256"] == sample_hash(b"trimmed:speaker-1:item-1,item-2")


def test_sample_processing_speaker_assignments_validate_ids_and_duplicates(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings=settings, sample_processor=FakeSpeakerSeparationProcessor())
    client = TestClient(app)
    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "separateSpeakers"},
        files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    wait_for_processing_job(client, job_id)

    missing_speaker = client.patch(
        f"/api/sample-processing/jobs/{job_id}/speaker-assignments",
        json={"speakerNames": [{"speakerId": "missing", "name": "Morgan"}]},
    )
    missing_item = client.patch(
        f"/api/sample-processing/jobs/{job_id}/speaker-assignments",
        json={"transcriptAssignments": [{"itemId": "missing", "speakerId": "speaker-1"}]},
    )
    duplicate_item = client.patch(
        f"/api/sample-processing/jobs/{job_id}/speaker-assignments",
        json={
            "transcriptAssignments": [
                {"itemId": "item-1", "speakerId": "speaker-1"},
                {"itemId": "item-1", "speakerId": "speaker-2"},
            ]
        },
    )

    assert missing_speaker.status_code == 404
    assert missing_speaker.json()["detail"] == "Speaker was not found."
    assert missing_item.status_code == 404
    assert missing_item.json()["detail"] == "Transcript item was not found."
    assert duplicate_item.status_code == 422
    assert duplicate_item.json()["detail"] == "Transcript item can only be assigned once."


def test_sample_processing_empty_speaker_assignment_patch_is_noop(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeSpeakerSeparationProcessor()
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)
    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "separateSpeakers"},
        files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    original_job = wait_for_processing_job(client, job_id)

    response = client.patch(f"/api/sample-processing/jobs/{job_id}/speaker-assignments", json={})

    assert response.status_code == 200
    assert response.json()["job"] == original_job
    assert processor.assignment_requests == []


def test_sample_processing_speaker_voice_save_validates_payload(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings=settings, sample_processor=FakeSpeakerSeparationProcessor())
    client = TestClient(app)
    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "separateSpeakers"},
        files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    wait_for_processing_job(client, job_id)

    invalid_speaker = client.post(
        f"/api/sample-processing/jobs/{job_id}/speaker-voices",
        json={"voices": [{"speakerId": "missing", "name": "Missing Speaker"}]},
    )
    duplicate_names = client.post(
        f"/api/sample-processing/jobs/{job_id}/speaker-voices",
        json={
            "voices": [
                {"speakerId": "speaker-1", "name": "Same Name"},
                {"speakerId": "speaker-2", "name": "Same Name"},
            ]
        },
    )
    invalid_preset = client.post(
        f"/api/sample-processing/jobs/{job_id}/speaker-voices",
        json={"voices": [{"speakerId": "speaker-1", "name": "Invalid Preset", "voicePresetId": "cinematic"}]},
    )
    no_selection = client.post(
        f"/api/sample-processing/jobs/{job_id}/speaker-voices",
        json={"voices": []},
    )

    assert invalid_speaker.status_code == 404
    assert invalid_speaker.json()["detail"] == "Speaker was not found."
    assert duplicate_names.status_code == 409
    assert duplicate_names.json()["detail"] == "Speaker voice names must be unique."
    assert invalid_preset.status_code == 422
    assert invalid_preset.json()["detail"] == "Voice preset must be standardNarration or animatedDialogue."
    assert no_selection.status_code == 422
    assert no_selection.json()["detail"] == "Choose at least one speaker to save."


def test_sample_processing_speaker_separation_rejects_mismatched_speaker_transcript_items(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings=settings, sample_processor=InvalidSpeakerTranscriptOwnershipProcessor())
    client = TestClient(app)

    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "separateSpeakers"},
        files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
    )
    job = wait_for_processing_job(client, create.json()["job"]["id"], status="error")

    assert create.status_code == 202
    assert job["status"] == "error"
    assert job["error"] == "Speaker separation speaker references transcript items assigned to another speaker."


def test_sample_processing_speaker_separation_rejects_incomplete_speaker_transcript_items(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings=settings, sample_processor=IncompleteSpeakerTranscriptItemsProcessor())
    client = TestClient(app)

    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "separateSpeakers"},
        files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
    )
    job = wait_for_processing_job(client, create.json()["job"]["id"], status="error")

    assert create.status_code == 202
    assert job["status"] == "error"
    assert job["error"] == "Speaker separation speaker transcript items are incomplete."


def test_sample_processing_speaker_separation_rejects_duplicate_speaker_transcript_items(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings=settings, sample_processor=DuplicateSpeakerTranscriptItemsProcessor())
    client = TestClient(app)

    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "separateSpeakers"},
        files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
    )
    job = wait_for_processing_job(client, create.json()["job"]["id"], status="error")

    assert create.status_code == 202
    assert job["status"] == "error"
    assert job["error"] == "Speaker separation speaker references duplicate transcript items."


def test_sample_processing_speaker_voice_save_rolls_back_partial_batch(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    voice_library = VoiceLibrary(settings)
    processor = FakeSpeakerSeparationProcessor()
    app = create_app(settings=settings, voice_library=voice_library, sample_processor=processor)
    client = TestClient(app)

    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "separateSpeakers"},
        files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    wait_for_processing_job(client, job_id)

    original_add_processed_sample = voice_library.add_processed_sample
    save_calls = 0

    def add_processed_sample_with_failure(
        name: str,
        sample: VoiceSample,
        processing_steps: tuple[VoiceProcessingStep, ...],
        voice_preset_id: str | None = None,
    ) -> VoiceAsset:
        nonlocal save_calls
        save_calls += 1
        if save_calls == 2:
            raise HTTPException(status_code=500, detail="Simulated save failure.")
        return original_add_processed_sample(name, sample, processing_steps, voice_preset_id)

    voice_library.add_processed_sample = add_processed_sample_with_failure  # type: ignore[method-assign]

    save = client.post(
        f"/api/sample-processing/jobs/{job_id}/speaker-voices",
        json={
            "voices": [
                {"speakerId": "speaker-1", "name": "Morgan"},
                {"speakerId": "speaker-2", "name": "Riley"},
            ]
        },
    )

    assert save.status_code == 500
    assert save.json()["detail"] == "Simulated save failure."
    assert [voice.id for voice in voice_library.list_assets()] == ["default"]
    assert not (settings.voice_assets_dir / "morgan.wav").exists()
    assert not (settings.voice_assets_dir / "riley.wav").exists()


def test_diarization_processor_reports_missing_hugging_face_token(tmp_path: Path) -> None:
    settings = replace(
        make_settings(tmp_path),
        sample_processing_enable_diarization=True,
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        create = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "separateSpeakers"},
            files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
        )
        job = wait_for_processing_job(client, create.json()["job"]["id"], status="error")

    assert create.status_code == 202
    assert job["error"] == "Hugging Face token is required for speaker diarization."


def test_diarization_processor_reports_missing_dependencies(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def missing_dependencies():
        raise SampleProcessingServiceError(
            "Speaker diarization dependencies are not installed. Install backend[diarization].",
            503,
        )

    monkeypatch.setattr(sample_processors_module, "_load_diarization_dependencies", missing_dependencies)
    settings = replace(
        make_settings(tmp_path),
        sample_processing_enable_diarization=True,
        sample_processing_hf_token="hf_test",
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake")),
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        create = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "separateSpeakers"},
            files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
        )
        job = wait_for_processing_job(client, create.json()["job"]["id"], status="error")

    assert create.status_code == 202
    assert job["error"] == "Speaker diarization dependencies are not installed. Install backend[diarization]."


def test_diarization_dependency_loader_reports_missing_symbols(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePyannoteModule:
        pass

    class FakeWhisperModule:
        WhisperModel = object

    def import_module(name: str):
        if name == "pyannote.audio":
            return FakePyannoteModule()
        if name == "faster_whisper":
            return FakeWhisperModule()
        raise AssertionError(f"Unexpected import: {name}")

    monkeypatch.setattr(sample_processors_module.importlib, "import_module", import_module)

    with pytest.raises(SampleProcessingServiceError) as exc_info:
        sample_processors_module._load_diarization_dependencies()

    assert exc_info.value.detail == "Speaker diarization dependencies are not installed. Install backend[diarization]."
    assert exc_info.value.status_code == 503


def test_diarization_processor_disables_pyannote_metrics_before_dependency_import(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("PYANNOTE_METRICS_ENABLED", raising=False)

    def load_dependencies_with_metrics_assertion():
        assert os.environ["PYANNOTE_METRICS_ENABLED"] == "0"
        return sample_processors_module._DiarizationDependencies(
            pipeline_class=FakePyannotePipeline,
            whisper_model_class=FakeWhisperModel,
        )

    monkeypatch.setattr(
        sample_processors_module,
        "_load_diarization_dependencies",
        load_dependencies_with_metrics_assertion,
    )
    settings = replace(
        make_settings(tmp_path),
        sample_processing_enable_diarization=True,
        sample_processing_hf_token="hf_test",
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake", output=b"fake-wav")),
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        create = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "separateSpeakers"},
            files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
        )
        job = wait_for_processing_job(client, create.json()["job"]["id"])

    assert create.status_code == 202
    assert job["status"] == "success"


def test_ffconcat_path_escapes_single_quotes_inside_quoted_path(tmp_path: Path) -> None:
    escaped = sample_processors_module._escape_ffconcat_path(tmp_path / "speaker's segment.wav")

    assert "speaker\\'s segment.wav" in escaped
    assert "'\\''" not in escaped


def test_diarization_processor_times_out_model_steps(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        sample_processors_module,
        "_load_diarization_dependencies",
        lambda: sample_processors_module._DiarizationDependencies(
            pipeline_class=SlowPyannotePipeline,
            whisper_model_class=FakeWhisperModel,
        ),
    )
    settings = replace(
        make_settings(tmp_path),
        sample_processing_enable_diarization=True,
        sample_processing_hf_token="hf_test",
        sample_processing_timeout_seconds=0.2,
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake", output=b"fake-wav")),
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        create = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "separateSpeakers"},
            files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
        )
        job = wait_for_processing_job(client, create.json()["job"]["id"], status="error")

    assert create.status_code == 202
    assert job["error"] == "Speaker diarization timed out."


def test_diarization_processor_uses_turns_for_untranscribed_speaker_streams(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    args_log_path = tmp_path / "ffmpeg-args.json"
    monkeypatch.setattr(
        sample_processors_module,
        "_load_diarization_dependencies",
        lambda: sample_processors_module._DiarizationDependencies(
            pipeline_class=FakeUntranscribedTurnPyannotePipeline,
            whisper_model_class=FakePartialWhisperModel,
        ),
    )
    settings = replace(
        make_settings(tmp_path),
        sample_processing_enable_diarization=True,
        sample_processing_hf_token="hf_test",
        sample_processing_ffmpeg_command=str(
            ffmpeg_fake_command(
                tmp_path / "ffmpeg-fake",
                output=b"fake-wav",
                args_log_path=args_log_path,
            )
        ),
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        create = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "separateSpeakers"},
            files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
        )
        job = wait_for_processing_job(client, create.json()["job"]["id"])

    ffmpeg_calls = json.loads(args_log_path.read_text(encoding="utf-8"))
    segment_calls = [call for call in ffmpeg_calls if "-ss" in call]

    assert create.status_code == 202
    assert job["status"] == "success"
    assert job["result"]["speakers"][0]["transcriptItemIds"] == ["item-1"]
    assert job["result"]["speakers"][1]["transcriptItemIds"] == []
    assert any(
        call[call.index("-ss") + 1] == "1.000" and call[call.index("-t") + 1] == "1.000"
        for call in segment_calls
    )


def test_diarization_processor_maps_transcript_and_regenerates_speaker_streams(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakePyannotePipeline.loaded = []
    FakeWhisperModel.loaded = []
    monkeypatch.setattr(
        sample_processors_module,
        "_load_diarization_dependencies",
        lambda: sample_processors_module._DiarizationDependencies(
            pipeline_class=FakePyannotePipeline,
            whisper_model_class=FakeWhisperModel,
        ),
    )
    settings = replace(
        make_settings(tmp_path),
        sample_processing_enable_diarization=True,
        sample_processing_hf_token="hf_test",
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake", output=b"fake-wav")),
        sample_processing_whisper_model="small",
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        create = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "separateSpeakers"},
            files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
        )
        job = wait_for_processing_job(client, create.json()["job"]["id"])
        speaker_stream = client.get(f"/api/sample-processing/jobs/{job['id']}/speakers/speaker-1/result")
        patch = client.patch(
            f"/api/sample-processing/jobs/{job['id']}/speaker-assignments",
            json={"transcriptAssignments": [{"itemId": "item-2", "speakerId": "speaker-1"}]},
        )
        updated_job = patch.json()["job"]

    assert create.status_code == 202
    assert FakePyannotePipeline.loaded == [("pyannote/speaker-diarization-community-1", "hf_test")]
    assert FakeWhisperModel.loaded == [("small", "cpu", "int8")]
    assert job["status"] == "success"
    assert job["result"]["kind"] == "speakerSeparation"
    assert job["result"]["speakers"][0]["transcriptItemIds"] == ["item-1", "item-3"]
    assert job["result"]["speakers"][1]["transcriptItemIds"] == ["item-2"]
    assert job["result"]["transcript"]["items"] == [
        {
            "id": "item-1",
            "text": "Hello there.",
            "startSeconds": 0.1,
            "endSeconds": 0.7,
            "speakerId": "speaker-1",
        },
        {
            "id": "item-2",
            "text": "General Kenobi.",
            "startSeconds": 1.3,
            "endSeconds": 2.0,
            "speakerId": "speaker-2",
        },
        {
            "id": "item-3",
            "text": "Again.",
            "startSeconds": 2.6,
            "endSeconds": 3.0,
            "speakerId": "speaker-1",
        },
    ]
    assert speaker_stream.status_code == 200
    assert speaker_stream.content == b"fake-wav"
    assert patch.status_code == 200
    assert updated_job["result"]["speakers"][0]["transcriptItemIds"] == ["item-1", "item-2", "item-3"]
    assert updated_job["result"]["speakers"][1]["transcriptItemIds"] == []
    assert updated_job["result"]["transcript"]["items"][1]["speakerId"] == "speaker-1"


def test_diarization_processor_rejects_oversized_speaker_stream(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        sample_processors_module,
        "_load_diarization_dependencies",
        lambda: sample_processors_module._DiarizationDependencies(
            pipeline_class=FakePyannotePipeline,
            whisper_model_class=FakeWhisperModel,
        ),
    )
    settings = replace(
        make_settings(tmp_path),
        max_upload_bytes=5,
        sample_processing_enable_diarization=True,
        sample_processing_hf_token="hf_test",
        sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path / "ffmpeg-fake", output=b"too-big")),
    )
    app = create_app(settings=settings)
    with TestClient(app) as client:
        create = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "separateSpeakers"},
            files={"sourceFile": ("conversation.wav", b"speaker-source", "audio/wav")},
        )
        job = wait_for_processing_job(client, create.json()["job"]["id"], status="error")

    assert create.status_code == 202
    assert job["error"] == "Processed voice sample must be 5 bytes or smaller."


def test_sample_processing_job_accepts_uploaded_source(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeSampleProcessor()
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)

    response = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice"},
        files={"sourceFile": ("uploaded.wav", b"uploaded-source", "audio/wav")},
    )
    job = wait_for_processing_job(client, response.json()["job"]["id"])

    assert response.status_code == 202
    assert job["sourceName"] == "uploaded"
    assert job["sourceSha256"] == sample_hash(b"uploaded-source")
    assert processor.requests[0].source.content == b""
    assert processor.requests[0].source_path.read_bytes() == b"uploaded-source"


def test_sample_processing_job_accepts_selected_processing_preset(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeSampleProcessor()
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)

    response = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice", "processingPresetId": "clean"},
        files={"sourceFile": ("uploaded.wav", b"uploaded-source", "audio/wav")},
    )
    job = wait_for_processing_job(client, response.json()["job"]["id"])

    assert response.status_code == 202
    assert job["processingPresetId"] == "clean"
    assert job["processingPresetLabel"] == "Clean"
    assert processor.requests[0].processing_preset_id == "clean"
    assert processor.requests[0].processing_preset_label == "Clean"


def test_sample_processing_job_rejects_invalid_processing_preset(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings=settings, sample_processor=FakeSampleProcessor())
    client = TestClient(app)

    response = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice", "processingPresetId": "tooStrong"},
        files={"sourceFile": ("uploaded.wav", b"uploaded-source", "audio/wav")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unsupported processing preset: tooStrong."


def test_sample_processing_save_rejects_duplicate_voice_name(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeSampleProcessor()
    app = create_app(settings=settings, sample_processor=processor)
    client = TestClient(app)
    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice"},
        files={"sourceFile": ("uploaded.wav", b"uploaded-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    wait_for_processing_job(client, job_id)
    first = client.post(f"/api/sample-processing/jobs/{job_id}/voice", json={"name": "Processed Voice"})

    second = client.post(f"/api/sample-processing/jobs/{job_id}/voice", json={"name": "Processed Voice"})

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["detail"] == "A voice with that name already exists."


def test_sample_processing_rejects_tampered_result_path(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeSampleProcessor()
    voice_library = VoiceLibrary(settings)
    service = SampleProcessingService(settings, voice_library, processor)
    app = create_app(settings=settings, voice_library=voice_library, sample_processing_service=service)
    client = TestClient(app)
    create = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice"},
        files={"sourceFile": ("uploaded.wav", b"uploaded-source", "audio/wav")},
    )
    job_id = create.json()["job"]["id"]
    job = wait_for_processing_job(client, job_id)
    service._jobs[job_id] = replace(
        service.get_job(job_id),
        result=SampleProcessingResult(
            path="../escape.wav",
            filename="escape.wav",
            content_type="audio/wav",
            sha256=job["result"]["sha256"],
        ),
    )

    response = client.get(f"/api/sample-processing/jobs/{job_id}/result")

    assert response.status_code == 500
    assert response.json()["detail"] == "Sample processing path is invalid."


def test_sample_processing_rejects_invalid_source_without_job_directory(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, max_source_upload_bytes=5)
    processor = FakeSampleProcessor()
    voice_library = VoiceLibrary(settings)
    service = SampleProcessingService(settings, voice_library, processor)
    app = create_app(settings=settings, voice_library=voice_library, sample_processing_service=service)
    client = TestClient(app)

    no_source = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice"},
    )
    oversized_upload = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice"},
        files={"sourceFile": ("uploaded.wav", b"too-large", "audio/wav")},
    )
    missing_voice = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice", "sourceVoiceId": "missing"},
    )

    assert no_source.status_code == 422
    assert oversized_upload.status_code == 413
    assert missing_voice.status_code == 404
    assert service._jobs == {}
    assert service._tasks == {}
    assert [path for path in settings.sample_processing_dir.iterdir()] == []


def test_sample_processing_cleans_task_registry_after_completion(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    processor = FakeSampleProcessor()
    voice_library = VoiceLibrary(settings)
    service = SampleProcessingService(settings, voice_library, processor)
    app = create_app(settings=settings, voice_library=voice_library, sample_processing_service=service)
    client = TestClient(app)

    response = client.post(
        "/api/sample-processing/jobs",
        data={"operationId": "isolateVoice"},
        files={"sourceFile": ("uploaded.wav", b"uploaded-source", "audio/wav")},
    )
    job = wait_for_processing_job(client, response.json()["job"]["id"])

    assert response.status_code == 202
    assert job["status"] == "success"
    assert service._tasks == {}


def test_ffmpeg_sample_processor_trims_silence_and_saves_metadata(tmp_path: Path) -> None:
    ffmpeg_args_path = tmp_path / "ffmpeg-args.json"
    settings = ffmpeg_processing_settings(
        tmp_path,
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake", args_path=ffmpeg_args_path),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "trimSilence"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"])
        result = client.get(f"/api/sample-processing/jobs/{job['id']}/result")
        save = client.post(
            f"/api/sample-processing/jobs/{job['id']}/voice",
            json={"name": "Source Trimmed", "voicePresetId": "standardNarration"},
        )

    ffmpeg_args = json.loads(ffmpeg_args_path.read_text(encoding="utf-8"))
    assert response.status_code == 202
    assert job["status"] == "success"
    assert job["engine"] == "ffmpeg"
    assert job["processingPresetId"] == DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID
    assert job["processingPresetLabel"] == "Balanced"
    assert "-af" in ffmpeg_args
    assert "stop_duration=0.6" in ffmpeg_args[ffmpeg_args.index("-af") + 1]
    assert result.status_code == 200
    assert result.content == b"normalized-voice"
    assert save.status_code == 201
    voice = save.json()["voice"]
    assert voice["sha256"] == sample_hash(b"normalized-voice")
    assert voice["processingSteps"] == [
        {
            "id": job["id"],
            "label": "Trim Silence",
            "operationId": "trimSilence",
            "createdAt": voice["processingSteps"][0]["createdAt"],
            "sourceSha256": sample_hash(b"source-audio"),
            "resultSha256": sample_hash(b"normalized-voice"),
            "engine": "ffmpeg",
            "processingPresetId": "trimBalanced",
            "processingPresetLabel": "Balanced",
        }
    ]


@pytest.mark.parametrize(
    ("processing_preset_id", "expected_threshold", "expected_stop_duration", "expected_stop_silence"),
    [
        ("trimLight", "-50dB", "1.0", "0.25"),
        ("trimBalanced", "-45dB", "0.6", "0.2"),
        ("trimAggressive", "-38dB", "0.35", "0.1"),
    ],
)
def test_ffmpeg_sample_processor_maps_trim_presets_to_silenceremove(
    tmp_path: Path,
    processing_preset_id: str,
    expected_threshold: str,
    expected_stop_duration: str,
    expected_stop_silence: str,
) -> None:
    ffmpeg_args_path = tmp_path / "ffmpeg-args.json"
    settings = ffmpeg_processing_settings(
        tmp_path,
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake", args_path=ffmpeg_args_path),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "trimSilence", "processingPresetId": processing_preset_id},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"])

    ffmpeg_args = json.loads(ffmpeg_args_path.read_text(encoding="utf-8"))
    trim_filter = ffmpeg_args[ffmpeg_args.index("-af") + 1]
    assert response.status_code == 202
    assert job["processingPresetId"] == processing_preset_id
    assert f"start_threshold={expected_threshold}" in trim_filter
    assert f"stop_threshold={expected_threshold}" in trim_filter
    assert f"stop_duration={expected_stop_duration}" in trim_filter
    assert f"stop_silence={expected_stop_silence}" in trim_filter
    assert ffmpeg_args[ffmpeg_args.index("-ac") + 1] == "1"
    assert ffmpeg_args[ffmpeg_args.index("-ar") + 1] == "16000"


@pytest.mark.parametrize(
    ("operation_id", "processing_preset_id"),
    [
        ("trimSilence", "clean"),
        ("isolateVoice", "trimAggressive"),
    ],
)
def test_sample_processing_job_rejects_wrong_operation_processing_preset(
    tmp_path: Path,
    operation_id: str,
    processing_preset_id: str,
) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(tmp_path / "demucs-fake"),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake"),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": operation_id, "processingPresetId": processing_preset_id},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == f"Unsupported processing preset: {processing_preset_id}."


def test_ffmpeg_sample_processor_reports_missing_command(tmp_path: Path) -> None:
    settings = ffmpeg_processing_settings(tmp_path, tmp_path / "missing-ffmpeg")
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "trimSilence"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"] == "ffmpeg command was not found."


def test_ffmpeg_sample_processor_reports_nonzero_command(tmp_path: Path) -> None:
    settings = ffmpeg_processing_settings(
        tmp_path,
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake", exit_code=7),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "trimSilence"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"] == "ffmpeg failed with exit code 7. ffmpeg failed in test"


def test_ffmpeg_sample_processor_reports_timeout(tmp_path: Path) -> None:
    settings = ffmpeg_processing_settings(
        tmp_path,
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake", sleep_seconds=2),
        sample_processing_timeout_seconds=1,
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "trimSilence"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"] == "ffmpeg timed out."


def test_ffmpeg_sample_processor_rejects_oversized_result(tmp_path: Path) -> None:
    settings = ffmpeg_processing_settings(
        tmp_path,
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake", output=b"too-big"),
        max_upload_bytes=5,
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "trimSilence"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"] == "Processed voice sample must be 5 bytes or smaller."


def test_demucs_sample_processor_normalizes_vocals_with_ffmpeg(tmp_path: Path) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(tmp_path / "demucs-fake"),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake"),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "isolateVoice"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"])
        result = client.get(f"/api/sample-processing/jobs/{job['id']}/result")

    assert response.status_code == 202
    assert job["status"] == "success"
    assert job["engine"] == "demucs"
    assert job["result"]["sha256"] == sample_hash(b"normalized-voice")
    assert result.status_code == 200
    assert result.content == b"normalized-voice"


@pytest.mark.parametrize(
    ("processing_preset_id", "expected_model", "expected_demucs_args", "expected_filter"),
    [
        ("fast", "htdemucs", ["--shifts", "1"], None),
        ("balanced", "htdemucs", [], None),
        ("clean", "htdemucs", [], "highpass=f=70,lowpass=f=12000"),
        ("maxIsolation", "htdemucs_ft", ["--shifts", "8", "--overlap", "0.5"], None),
    ],
)
def test_demucs_sample_processor_maps_isolation_presets_to_commands(
    tmp_path: Path,
    processing_preset_id: str,
    expected_model: str,
    expected_demucs_args: list[str],
    expected_filter: str | None,
) -> None:
    demucs_args_path = tmp_path / "demucs-args.json"
    ffmpeg_args_path = tmp_path / "ffmpeg-args.json"
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(tmp_path / "demucs-fake", args_path=demucs_args_path),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake", args_path=ffmpeg_args_path),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "isolateVoice", "processingPresetId": processing_preset_id},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"])

    demucs_args = json.loads(demucs_args_path.read_text(encoding="utf-8"))
    ffmpeg_args = json.loads(ffmpeg_args_path.read_text(encoding="utf-8"))
    assert response.status_code == 202
    assert job["processingPresetId"] == processing_preset_id
    assert demucs_args[demucs_args.index("-n") + 1] == expected_model
    for expected_arg in expected_demucs_args:
        assert expected_arg in demucs_args
    if expected_filter is None:
        assert "-af" not in ffmpeg_args
    else:
        assert ffmpeg_args[ffmpeg_args.index("-af") + 1] == expected_filter


def test_demucs_sample_processor_reports_max_isolation_model_failures(tmp_path: Path) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(
            tmp_path / "demucs-fake",
            exit_code=7,
            stderr="Could not find model htdemucs_ft",
        ),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake"),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "isolateVoice", "processingPresetId": "maxIsolation"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["processingPresetId"] == "maxIsolation"
    assert job["error"] == "demucs failed with exit code 7. Could not find model htdemucs_ft"


def test_demucs_sample_processor_reports_missing_command(tmp_path: Path) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        tmp_path / "missing-demucs",
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake"),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "isolateVoice"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"] == "demucs command was not found."


def test_demucs_sample_processor_reports_nonzero_command(tmp_path: Path) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(tmp_path / "demucs-fake", exit_code=7),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake"),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "isolateVoice"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"] == "demucs failed with exit code 7. demucs failed in test"


def test_demucs_sample_processor_reports_tail_of_long_command_errors(tmp_path: Path) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(tmp_path / "demucs-fake", exit_code=7, stderr=("progress " * 120) + "useful final failure"),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake"),
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "isolateVoice"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"].endswith("useful final failure")


def test_demucs_sample_processor_reports_timeout(tmp_path: Path) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(tmp_path / "demucs-fake"),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake", sleep_seconds=2),
        sample_processing_timeout_seconds=1,
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "isolateVoice"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"] == "ffmpeg timed out."


def test_demucs_sample_processor_rejects_oversized_result(tmp_path: Path) -> None:
    settings = demucs_processing_settings(
        tmp_path,
        demucs_fake_command(tmp_path / "demucs-fake"),
        ffmpeg_fake_command(tmp_path / "ffmpeg-fake", output=b"too-big"),
        max_upload_bytes=5,
    )
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/sample-processing/jobs",
            data={"operationId": "isolateVoice"},
            files={"sourceFile": ("source.wav", b"source-audio", "audio/wav")},
        )
        job = wait_for_processing_job(client, response.json()["job"]["id"], status="error")

    assert response.status_code == 202
    assert job["error"] == "Processed voice sample must be 5 bytes or smaller."


def test_external_command_discards_stdout(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_streams: dict[str, object] = {}

    class FakeProcess:
        returncode = 0

        async def communicate(self) -> tuple[None, bytes]:
            return None, b""

    async def fake_create_subprocess_exec(*args: str, stdout: object, stderr: object) -> FakeProcess:
        captured_streams["stdout"] = stdout
        captured_streams["stderr"] = stderr
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    asyncio.run(_run_external_command(["fake-command"], "fake", 1))

    assert captured_streams == {
        "stdout": asyncio.subprocess.DEVNULL,
        "stderr": asyncio.subprocess.PIPE,
    }


def test_subscription_endpoint_returns_sanitized_quota(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/subscription")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "available": True,
        "error": None,
        "tier": "starter",
        "status": "active",
        "characterCount": 1000,
        "characterLimit": 10000,
        "remainingCharacters": 9000,
        "canExtendCharacterLimit": True,
        "maxCreditLimitExtension": 10000,
        "nextCharacterCountResetUnix": 1770000000,
    }
    assert "openInvoices" not in payload
    assert "xiApiKey" not in payload


def test_subscription_and_models_use_provider_key_header_over_env(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path, api_key="env-key")

    subscription_response = client.get("/api/subscription", headers={"X-Voice-Provider-Key": " browser-key "})
    models_response = client.get("/api/models", headers={"X-Voice-Provider-Key": "browser-key"})

    assert subscription_response.status_code == 200
    assert models_response.status_code == 200
    assert fake_client.subscription_api_keys == ["browser-key"]
    assert fake_client.model_api_keys == ["browser-key"]


def test_blank_provider_key_header_falls_back_to_env(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path, api_key="env-key")

    response = client.get("/api/models", headers={"X-Voice-Provider-Key": "   "})

    assert response.status_code == 200
    assert fake_client.model_api_keys == ["env-key"]


def test_metadata_routes_accept_explicit_provider_id(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path, api_key="env-key")

    subscription_response = client.get("/api/subscription?providerId=elevenlabs")
    models_response = client.get("/api/models?providerId=elevenlabs")

    assert subscription_response.status_code == 200
    assert models_response.status_code == 200
    assert fake_client.subscription_api_keys == ["env-key"]
    assert fake_client.model_api_keys == ["env-key"]


def test_metadata_routes_reject_unknown_provider(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/models?providerId=missing")

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown provider: missing."


def test_subscription_endpoint_sanitizes_errors(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)
    fake_client.subscription_error = ElevenLabsError("ElevenLabs API returned 401: Invalid API key.", 502)

    response = client.get("/api/subscription")

    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["error"] == "ElevenLabs API returned 401: Invalid API key."
    assert "test-key" not in response.text


def test_models_endpoint_returns_default_and_tts_models(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["error"] is None
    assert payload["defaultModelId"] == "eleven_multilingual_v2"
    assert [model["modelId"] for model in payload["models"]] == [
        "eleven_multilingual_v2",
        "eleven_flash_v2_5",
    ]
    assert payload["models"][1]["characterCostMultiplier"] == 0.5
    assert payload["models"][1]["canUseStyle"] is False


def test_models_endpoint_returns_sanitized_unavailable_payload(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)
    fake_client.models_error = ElevenLabsError(
        "ElevenLabs API returned 401: The API key is missing models_read.",
        502,
    )

    response = client.get("/api/models")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "error": "ElevenLabs API returned 401: The API key is missing models_read.",
        "defaultModelId": "eleven_multilingual_v2",
        "models": [],
    }
    assert "test-key" not in response.text


def test_model_payload_filtering_uses_tts_capability() -> None:
    raw_models = [
        {"model_id": "scribe_v2", "name": "Scribe", "can_do_text_to_speech": False},
        {
            "model_id": "eleven_flash_v2_5",
            "name": "Eleven Flash v2.5",
            "can_do_text_to_speech": True,
            "model_rates": {"character_cost_multiplier": 0.5},
        },
    ]

    models = [_model_from_payload(item) for item in raw_models if _is_tts_model(item)]

    assert [model.model_id for model in models] == ["eleven_flash_v2_5"]
    assert models[0].character_cost_multiplier == 0.5


def test_select_tuning_rejects_non_scalar_values() -> None:
    control = ProviderTuningControl(
        id="renderMode",
        label="Render Mode",
        description="Selects the rendering mode.",
        type="select",
        default_value="standard",
        options=(
            ProviderTuningOption(label="Standard", value="standard"),
            ProviderTuningOption(label="Enhanced", value="enhanced"),
        ),
    )

    with pytest.raises(ElevenLabsError) as exc_info:
        _normalize_control_value(control, {"mode": "standard"})

    assert exc_info.value.status_code == 422
    assert str(exc_info.value) == "Render Mode must be a JSON scalar."


def test_audio_response_serializer_sets_public_headers() -> None:
    sample = VoiceSample(
        content=b"sample",
        filename="sample.mp3",
        content_type="audio/mpeg",
        sha256="sample-hash",
    )
    cached_voice = CachedVoice(
        voice_id="voice-123",
        sample_name="sample.mp3",
        created_at="2026-05-28T00:00:00+00:00",
        requires_verification=False,
    )

    response = audio_response(
        b"fake-mp3",
        sample,
        cached_voice,
        "miss",
        "default",
        "eleven_multilingual_v2",
        24,
        "req_test_123",
    )

    assert response.body == b"fake-mp3"
    assert response.media_type == "audio/mpeg"
    assert response.headers["x-app-voice-id"] == "default"
    assert response.headers["x-sample-sha256"] == "sample-hash"
    assert response.headers["x-voice-cache"] == "miss"
    assert response.headers["x-voice-id"] == "voice-123"
    assert response.headers["x-model-id"] == "eleven_multilingual_v2"
    assert response.headers["x-character-count"] == "24"
    assert response.headers["x-request-id"] == "req_test_123"


def test_speech_service_rejects_empty_text(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    fake_client = FakeElevenLabsProvider().bind_settings(settings)
    voice_settings = {
        "stability": 0.5,
        "similarityBoost": 0.75,
        "style": 0,
        "speed": 1,
        "useSpeakerBoost": True,
    }

    async def is_disconnected() -> bool:
        return False

    async def run() -> None:
        with pytest.raises(SpeechServiceError) as exc_info:
            await generate_speech(
                text="   ",
                voice_id="default",
                model_id=None,
                voice_settings=voice_settings,
                settings=settings,
                provider=fake_client,
                voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
                voice_library=VoiceLibrary(settings),
                is_disconnected=is_disconnected,
            )
        assert exc_info.value.status_code == 422
        assert exc_info.value.detail == "Text is required."

    asyncio.run(run())
    assert fake_client.created_samples == []
    assert fake_client.speech_requests == []


def test_default_voice_sample_endpoint_returns_audio(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/voices/default/sample")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert response.content == b"default-sample"


def test_create_speech_clones_once_then_uses_cache(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)
    form = {"text": "Hello from the local app.", "voiceId": "default"}

    first = client.post("/api/speech", data=form)
    second = client.post("/api/speech", data=form)

    assert first.status_code == 200
    assert first.content == b"fake-mp3"
    assert first.headers["x-voice-cache"] == "miss"
    assert second.status_code == 200
    assert second.headers["x-voice-cache"] == "hit"
    assert first.headers["x-app-voice-id"] == "default"
    assert len(fake_client.created_samples) == 1
    assert len(fake_client.speech_requests) == 2


def test_create_speech_uses_provider_key_header_when_env_is_missing(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path, api_key="")

    response = client.post(
        "/api/speech",
        data={"text": "Hello from the local app.", "voiceId": "default"},
        headers={"X-Voice-Provider-Key": "browser-key"},
    )

    assert response.status_code == 200
    assert fake_client.create_voice_api_keys == ["browser-key"]
    assert fake_client.speech_requests[0][4] == "browser-key"


def test_create_speech_cache_is_scoped_by_provider_key(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path, api_key="env-key")
    form = {"text": "Hello from the local app.", "voiceId": "default"}

    first = client.post("/api/speech", data=form, headers={"X-Voice-Provider-Key": "browser-key-a"})
    second = client.post("/api/speech", data=form, headers={"X-Voice-Provider-Key": "browser-key-a"})
    third = client.post("/api/speech", data=form, headers={"X-Voice-Provider-Key": "browser-key-b"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 200
    assert first.headers["x-voice-cache"] == "miss"
    assert second.headers["x-voice-cache"] == "hit"
    assert third.headers["x-voice-cache"] == "miss"
    assert len(fake_client.created_samples) == 2
    assert fake_client.create_voice_api_keys == ["browser-key-a", "browser-key-b"]


def test_create_speech_migrates_legacy_server_cache_entry(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, api_key="env-key")
    fake_client = FakeElevenLabsProvider().bind_settings(settings)
    voice_library = VoiceLibrary(settings)
    voice_cache = VoiceCache(settings.storage_dir / "voice-cache.json")
    sample = voice_library.get_sample("default")
    voice_cache.set(sample, VoiceClone(voice_id="legacy-voice-id", requires_verification=False))

    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_client]),
        voice_cache=voice_cache,
        voice_library=voice_library,
    )
    client = TestClient(app)

    response = client.post("/api/speech", data={"text": "Hello from the local app.", "voiceId": "default"})

    key_context = resolve_elevenlabs_key(settings, None)
    migrated_voice = voice_cache.get(sample.sha256, namespace=key_context.cache_namespace)
    assert response.status_code == 200
    assert response.headers["x-voice-cache"] == "hit"
    assert fake_client.created_samples == []
    assert fake_client.speech_requests[0][0] == "legacy-voice-id"
    assert migrated_voice is not None
    assert migrated_voice.voice_id == "legacy-voice-id"


def test_disconnect_cancels_pending_speech_request(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client, fake_client = make_client(tmp_path)
    fake_client.create_voice_delay = 1.0

    async def is_disconnected(_request: object) -> bool:
        return True

    monkeypatch.setattr("starlette.requests.Request.is_disconnected", is_disconnected)

    response = client.post("/api/speech", data={"text": "Cancel this.", "voiceId": "default"})

    assert response.status_code == 499
    assert response.json()["detail"] == "Speech generation was canceled."
    assert fake_client.created_samples == []
    assert fake_client.speech_requests == []


def test_disconnect_helper_preserves_successful_result() -> None:
    class ConnectedRequest:
        async def is_disconnected(self) -> bool:
            return False

    async def work() -> str:
        await asyncio.sleep(0.001)
        return "done"

    async def run() -> None:
        result = await _await_or_cancel_on_disconnect(ConnectedRequest(), work, poll_interval=0.001)  # type: ignore[arg-type]
        assert result == "done"

    asyncio.run(run())


def test_disconnect_helper_cancels_pending_work() -> None:
    class DisconnectsAfterStartRequest:
        def __init__(self) -> None:
            self.check_count = 0

        async def is_disconnected(self) -> bool:
            self.check_count += 1
            return self.check_count > 1

    was_cancelled = False

    async def work() -> None:
        nonlocal was_cancelled
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            was_cancelled = True
            raise

    async def run() -> None:
        with pytest.raises(SpeechGenerationCanceled):
            await _await_or_cancel_on_disconnect(DisconnectsAfterStartRequest(), work, poll_interval=0.001)  # type: ignore[arg-type]

    asyncio.run(run())
    assert was_cancelled is True


def test_disconnect_helper_does_not_start_work_when_already_disconnected() -> None:
    class DisconnectedRequest:
        async def is_disconnected(self) -> bool:
            return True

    started = False

    async def work() -> None:
        nonlocal started
        started = True

    async def run() -> None:
        with pytest.raises(SpeechGenerationCanceled):
            await _await_or_cancel_on_disconnect(DisconnectedRequest(), work, poll_interval=0.001)  # type: ignore[arg-type]

    asyncio.run(run())
    assert started is False


def test_disconnect_helper_prefers_cancellation_when_work_cleanup_fails() -> None:
    class DisconnectsAfterStartRequest:
        def __init__(self) -> None:
            self.check_count = 0

        async def is_disconnected(self) -> bool:
            self.check_count += 1
            return self.check_count > 1

    async def work() -> None:
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError as exc:
            raise RuntimeError("cleanup failed") from exc

    async def run() -> None:
        with pytest.raises(SpeechGenerationCanceled):
            await _await_or_cancel_on_disconnect(DisconnectsAfterStartRequest(), work, poll_interval=0.001)  # type: ignore[arg-type]

    asyncio.run(run())


def test_create_speech_returns_usage_metadata(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.post("/api/speech", data={"text": "Hello from the local app.", "voiceId": "default"})

    assert response.status_code == 200
    assert response.headers["x-character-count"] == "24"
    assert response.headers["x-model-id"] == "eleven_multilingual_v2"
    assert response.headers["x-request-id"] == "req_test_123"


def test_create_speech_uses_model_fallback_and_override(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)

    fallback = client.post("/api/speech", data={"text": "Default model.", "voiceId": "default"})
    override = client.post(
        "/api/speech",
        data={"text": "Override model.", "voiceId": "default", "modelId": "eleven_flash_v2_5"},
    )

    assert fallback.status_code == 200
    assert override.status_code == 200
    assert fallback.headers["x-model-id"] == "eleven_multilingual_v2"
    assert override.headers["x-model-id"] == "eleven_flash_v2_5"
    assert fake_client.speech_requests[0][3] == "eleven_multilingual_v2"
    assert fake_client.speech_requests[1][3] == "eleven_flash_v2_5"


def test_create_speech_uses_tuning_settings(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)

    response = client.post(
        "/api/speech",
        data={
            "text": "Use these settings.",
            "voiceId": "default",
            "stability": "0.42",
            "similarityBoost": "0.84",
            "style": "0.2",
            "speed": "1.1",
            "useSpeakerBoost": "false",
        },
    )

    assert response.status_code == 200
    settings = fake_client.speech_requests[0][2]
    assert settings == {
        "stability": 0.42,
        "similarityBoost": 0.84,
        "style": 0.2,
        "speed": 1.1,
        "useSpeakerBoost": False,
    }


def test_create_speech_filters_legacy_tuning_for_provider_without_controls(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    provider = FakeNoTuningProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([provider], default_provider_id="notuning"),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    client = TestClient(app)

    response = client.post(
        "/api/speech",
        data={
            "text": "Legacy clients can still post these.",
            "voiceId": "default",
            "providerId": "notuning",
            "stability": "0.42",
            "similarityBoost": "0.84",
            "style": "0.2",
            "speed": "1.1",
            "useSpeakerBoost": "false",
        },
    )

    assert response.status_code == 200
    assert provider.speech_requests[0][2] == {}


def test_create_speech_accepts_generic_voice_settings_and_provider_id(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)

    response = client.post(
        "/api/speech",
        data={
            "text": "Use generic settings.",
            "voiceId": "default",
            "providerId": "elevenlabs",
            "voiceSettings": json.dumps(
                {
                    "stability": 0.31,
                    "similarityBoost": 0.82,
                    "style": 0.14,
                    "speed": 0.93,
                    "useSpeakerBoost": False,
                }
            ),
        },
    )

    assert response.status_code == 200
    assert fake_client.speech_requests[0][2] == {
        "stability": 0.31,
        "similarityBoost": 0.82,
        "style": 0.14,
        "speed": 0.93,
        "useSpeakerBoost": False,
    }


def test_create_speech_rejects_unknown_voice_setting(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)

    response = client.post(
        "/api/speech",
        data={
            "text": "Reject this.",
            "voiceId": "default",
            "voiceSettings": json.dumps({"unsupported": 1}),
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unsupported ElevenLabs voice setting: unsupported."
    assert fake_client.created_samples == []
    assert fake_client.speech_requests == []


def test_add_uploaded_voice_stores_named_asset(tmp_path: Path) -> None:
    ffmpeg_args_path = tmp_path / "voice-ingestion-ffmpeg-args.json"
    client, _ = make_client(
        tmp_path,
        ffmpeg_command=ffmpeg_fake_command(tmp_path / "ffmpeg-fake", args_path=ffmpeg_args_path),
    )

    response = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )

    assert response.status_code == 201
    assert response.json()["voice"]["id"] == "voice-clone-01"
    assert response.json()["voice"]["name"] == "Voice_Clone_01"
    assert response.json()["voice"]["sampleMode"] == "excerpt"
    assert response.json()["voice"]["windowStartSeconds"] is None
    assert response.json()["voice"]["windowDurationSeconds"] is None
    assert response.json()["voice"]["sourceFilePath"] is None
    assert response.json()["voice"]["voicePresetId"] == "standardNarration"
    assert response.json()["voice"]["voiceSettingsByProvider"] == {}
    assert response.json()["voice"]["filePath"] == "voice-clone-01.wav"
    assert response.json()["voice"]["contentType"] == "audio/wav"
    assert response.json()["voice"]["sha256"] == sample_hash(b"normalized-voice")
    assert (tmp_path / "assets" / "voices" / "voice-clone-01.wav").read_bytes() == b"normalized-voice"
    ffmpeg_args = json.loads(ffmpeg_args_path.read_text(encoding="utf-8"))
    assert ffmpeg_args[ffmpeg_args.index("-ac") + 1] == "1"
    assert ffmpeg_args[ffmpeg_args.index("-ar") + 1] == "16000"
    assert "-vn" in ffmpeg_args
    assert ffmpeg_args[ffmpeg_args.index("-c:a") + 1] == "pcm_s16le"
    assert ffmpeg_args[ffmpeg_args.index("-f") + 1] == "wav"


def test_add_uploaded_voice_stores_requested_preset(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01", "voicePresetId": "animatedDialogue"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    voices = client.get("/api/voices")

    assert response.status_code == 201
    assert response.json()["voice"]["voicePresetId"] == "animatedDialogue"
    assert voices.json()["voices"][1]["voicePresetId"] == "animatedDialogue"


def test_add_uploaded_voice_rejects_unknown_preset(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01", "voicePresetId": "unsupported"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Voice preset must be standardNarration or animatedDialogue."
    assert not (tmp_path / "assets" / "voices" / "voice-clone-01.wav").exists()


def test_add_uploaded_voice_rejects_oversized_normalized_sample(tmp_path: Path) -> None:
    client, _ = make_client(
        tmp_path,
        max_upload_bytes=5,
        ffmpeg_command=ffmpeg_fake_command(tmp_path / "ffmpeg-fake", output=b"too-big"),
    )

    response = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.wav", b"input", "audio/wav")},
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "Normalized voice sample must be 5 bytes or smaller."
    assert not (tmp_path / "assets" / "voices" / "voice-clone-01.wav").exists()


def test_add_source_window_voice_stores_active_sample_and_local_source(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)

    response = client.post(
        "/api/voices",
        data={
            "name": "Voice_Clone_01",
            "sampleMode": "sourceWindow",
            "windowStartSeconds": "12.5",
            "windowDurationSeconds": "60",
        },
        files={
            "sampleFile": ("voice-window.wav", b"active-excerpt", "audio/wav"),
            "sourceFile": ("source.mp3", b"original-source", "audio/mpeg"),
        },
    )
    speech = client.post("/api/speech", data={"text": "Use the window.", "voiceId": "voice-clone-01"})

    assert response.status_code == 201
    voice = response.json()["voice"]
    assert voice["sampleMode"] == "sourceWindow"
    assert voice["filePath"] == "voice-clone-01.wav"
    assert voice["sha256"] == sample_hash(b"normalized-voice")
    assert voice["windowStartSeconds"] == 12.5
    assert voice["windowDurationSeconds"] == 60
    assert voice["sourceFilePath"] == "sources/voice-clone-01.mp3"
    assert voice["sourceContentType"] == "audio/mpeg"
    assert voice["sourceSha256"] == sample_hash(b"original-source")
    assert voice["voicePresetId"] == "standardNarration"
    assert (tmp_path / "assets" / "voices" / "voice-clone-01.wav").read_bytes() == b"normalized-voice"
    assert (tmp_path / "assets" / "voices" / "sources" / "voice-clone-01.mp3").read_bytes() == b"original-source"
    assert speech.status_code == 200
    assert fake_client.created_samples[0].filename == "voice-clone-01.wav"
    assert fake_client.created_samples[0].content == b"normalized-voice"


def test_source_window_voice_requires_source_file_and_window(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    missing_source = client.post(
        "/api/voices",
        data={
            "name": "Voice_Clone_01",
            "sampleMode": "sourceWindow",
            "windowStartSeconds": "0",
            "windowDurationSeconds": "60",
        },
        files={"sampleFile": ("voice.wav", b"active-excerpt", "audio/wav")},
    )
    missing_window = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_02", "sampleMode": "sourceWindow"},
        files={
            "sampleFile": ("voice.wav", b"active-excerpt", "audio/wav"),
            "sourceFile": ("source.mp3", b"original-source", "audio/mpeg"),
        },
    )

    assert missing_source.status_code == 422
    assert missing_source.json()["detail"] == "Source file is required for sourceWindow samples."
    assert missing_window.status_code == 422
    assert missing_window.json()["detail"] == "Window start and duration are required for sourceWindow samples."


def test_excerpt_voice_rejects_source_file(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01", "sampleMode": "excerpt"},
        files={
            "sampleFile": ("voice.wav", b"active-excerpt", "audio/wav"),
            "sourceFile": ("source.mp3", b"original-source", "audio/mpeg"),
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Source file is only accepted for sourceWindow samples."
    assert not (tmp_path / "assets" / "voices" / "voice-clone-01.wav").exists()


def test_source_window_original_uses_source_upload_cap(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path, max_source_upload_bytes=1024 * 1024)

    response = client.post(
        "/api/voices",
        data={
            "name": "Voice_Clone_01",
            "sampleMode": "sourceWindow",
            "windowStartSeconds": "0",
            "windowDurationSeconds": "60",
        },
        files={
            "sampleFile": ("voice.wav", b"active-excerpt", "audio/wav"),
            "sourceFile": ("source.mp3", b"x" * (1024 * 1024 + 1), "audio/mpeg"),
        },
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "Uploaded voice sample must be 1 MB or smaller."
    assert not (tmp_path / "assets" / "voices" / "voice-clone-01.wav").exists()
    assert not (tmp_path / "assets" / "voices" / "sources" / "voice-clone-01.mp3").exists()


def test_source_window_cleans_active_file_when_source_write_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = make_client(tmp_path)

    def fail_source_write(sample: VoiceSample, destination: Path) -> VoiceSample:
        raise OSError("source write failed")

    monkeypatch.setattr(voice_library_module, "save_sample_file", fail_source_write)

    with pytest.raises(OSError, match="source write failed"):
        client.post(
            "/api/voices",
            data={
                "name": "Voice_Clone_01",
                "sampleMode": "sourceWindow",
                "windowStartSeconds": "0",
                "windowDurationSeconds": "60",
            },
            files={
                "sampleFile": ("voice-window.wav", b"active-excerpt", "audio/wav"),
                "sourceFile": ("source.mp3", b"original-source", "audio/mpeg"),
            },
        )

    voices = client.get("/api/voices")

    assert voices.status_code == 200
    assert [voice["id"] for voice in voices.json()["voices"]] == ["default"]
    assert not (tmp_path / "assets" / "voices" / "voice-clone-01.wav").exists()
    assert not (tmp_path / "assets" / "voices" / "sources" / "voice-clone-01.mp3").exists()


def test_source_window_duplicate_name_is_rejected_before_source_write(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    first = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )

    response = client.post(
        "/api/voices",
        data={
            "name": "Voice Clone 01",
            "sampleMode": "sourceWindow",
            "windowStartSeconds": "0",
            "windowDurationSeconds": "60",
        },
        files={
            "sampleFile": ("voice-window.wav", b"active-excerpt", "audio/wav"),
            "sourceFile": ("source.mp3", b"original-source", "audio/mpeg"),
        },
    )

    assert first.status_code == 201
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]
    assert not (tmp_path / "assets" / "voices" / "sources").exists()


def test_add_uploaded_voice_rejects_duplicate_slug(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    first = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    second = client.post(
        "/api/voices",
        data={"name": "Voice Clone 01"},
        files={"sampleFile": ("other.mp3", b"other-sample", "audio/mpeg")},
    )

    assert first.status_code == 201
    assert second.status_code == 409
    assert "already exists" in second.json()["detail"]


def test_uploaded_voice_becomes_default_when_no_default_exists(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path, with_default_sample=False)

    response = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    voices = client.get("/api/voices")

    assert response.status_code == 201
    assert voices.json()["defaultVoiceId"] == "voice-clone-01"


def test_rename_voice_updates_display_name_without_changing_asset_identity(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    upload = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    original_voice = upload.json()["voice"]

    response = client.patch("/api/voices/voice-clone-01", json={"name": "Narration Take 01"})
    renamed_voice = next(voice for voice in response.json()["voices"] if voice["id"] == "voice-clone-01")

    assert response.status_code == 200
    assert renamed_voice == {
        **original_voice,
        "name": "Narration Take 01",
    }


def test_voice_library_updates_preset_without_renaming(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    voice_library = VoiceLibrary(settings)
    voice_library.list_payload()

    payload = voice_library.update_asset("default", voice_preset_id="animatedDialogue")

    assert payload["voices"][0]["name"] == "Default voice"
    assert payload["voices"][0]["voicePresetId"] == "animatedDialogue"
    assert json.loads(settings.voice_manifest_path.read_text(encoding="utf-8"))["voices"][0][
        "voicePresetId"
    ] == "animatedDialogue"


def test_patch_voice_updates_preset_without_renaming(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.patch("/api/voices/default", json={"voicePresetId": "animatedDialogue"})

    assert response.status_code == 200
    voice = response.json()["voices"][0]
    assert voice["name"] == "Default voice"
    assert voice["voicePresetId"] == "animatedDialogue"


def test_patch_voice_saves_normalized_provider_tuning(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    fake_provider = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_provider]),
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )

    with TestClient(app) as client:
        response = client.patch(
            "/api/voices/default",
            json={"providerId": "elevenlabs", "voiceSettings": {"speed": 1.15}},
        )

    assert response.status_code == 200
    voice = response.json()["voices"][0]
    assert voice["voiceSettingsByProvider"]["elevenlabs"] == {
        "similarityBoost": 0.75,
        "speed": 1.15,
        "stability": 0.5,
        "style": 0,
        "useSpeakerBoost": True,
    }
    manifest_voice = json.loads(settings.voice_manifest_path.read_text(encoding="utf-8"))["voices"][0]
    assert manifest_voice["voiceSettingsByProvider"] == voice["voiceSettingsByProvider"]


def test_patch_voice_rejects_empty_payload(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.patch("/api/voices/default", json={})

    assert response.status_code == 422
    assert response.json()["detail"] == "Voice name, preset, or settings are required."


def test_patch_voice_rejects_unknown_preset(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.patch("/api/voices/default", json={"voicePresetId": "unsupported"})

    assert response.status_code == 422
    assert response.json()["detail"] == "Voice preset must be standardNarration or animatedDialogue."


def test_patch_voice_rejects_tuning_without_provider(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.patch("/api/voices/default", json={"voiceSettings": {"speed": 1.15}})

    assert response.status_code == 422
    assert response.json()["detail"] == "Provider id is required to save voice settings."


def test_patch_voice_rejects_unknown_provider_tuning(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.patch(
        "/api/voices/default",
        json={"providerId": "missing", "voiceSettings": {"speed": 1.15}},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown provider: missing."


def test_patch_voice_rejects_unsupported_provider_tuning(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.patch(
        "/api/voices/default",
        json={"providerId": "elevenlabs", "voiceSettings": {"unsupported": 1}},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unsupported ElevenLabs voice setting: unsupported."


def test_rename_voice_rejects_duplicate_normalized_name(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    first = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    second = client.post(
        "/api/voices",
        data={"name": "Narration Take 01"},
        files={"sampleFile": ("other.mp3", b"other-sample", "audio/mpeg")},
    )

    response = client.patch("/api/voices/narration-take-01", json={"name": "Voice Clone 01"})

    assert first.status_code == 201
    assert second.status_code == 201
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_add_uploaded_voice_rejects_renamed_display_name_duplicate(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    upload = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    rename = client.patch("/api/voices/voice-clone-01", json={"name": "Narration Take 01"})

    response = client.post(
        "/api/voices",
        data={"name": "Narration Take 01"},
        files={"sampleFile": ("other.mp3", b"other-sample", "audio/mpeg")},
    )

    assert upload.status_code == 201
    assert rename.status_code == 200
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_delete_voice_removes_asset_and_reassigns_default(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    upload = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    assert upload.status_code == 201

    response = client.delete("/api/voices/default")
    voices = client.get("/api/voices")

    assert response.status_code == 200
    assert response.json()["defaultVoiceId"] == "voice-clone-01"
    assert voices.json()["defaultVoiceId"] == "voice-clone-01"
    assert [voice["id"] for voice in voices.json()["voices"]] == ["voice-clone-01"]
    assert not (tmp_path / "assets" / "voices" / "default" / "default-voice.mp3").exists()


def test_delete_last_voice_leaves_empty_library(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path, with_default_sample=False)
    upload = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    assert upload.status_code == 201

    response = client.delete("/api/voices/voice-clone-01")

    assert response.status_code == 200
    assert response.json() == {"defaultVoiceId": "", "voices": []}
    assert not (tmp_path / "assets" / "voices" / "voice-clone-01.wav").exists()


def test_set_default_voice_persists(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    upload = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    assert upload.status_code == 201

    response = client.put("/api/voices/default", json={"voiceId": "voice-clone-01"})
    voices = client.get("/api/voices")

    assert response.status_code == 200
    assert response.json()["defaultVoiceId"] == "voice-clone-01"
    assert voices.json()["defaultVoiceId"] == "voice-clone-01"


def test_selected_voice_sample_is_used_for_speech(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)
    upload = client.post(
        "/api/voices",
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice-clone-01.wav", b"uploaded-wave", "audio/wav")},
    )
    assert upload.status_code == 201

    response = client.post("/api/speech", data={"text": "Use Voice Clone 01.", "voiceId": "voice-clone-01"})

    assert response.status_code == 200
    assert fake_client.created_samples[0].filename == "voice-clone-01.wav"
    assert fake_client.created_samples[0].content == b"normalized-voice"


def test_text_is_required(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.post("/api/speech", data={"text": "   ", "voiceId": "default"})

    assert response.status_code == 422
    assert response.json()["detail"] == "Text is required."


def test_missing_api_key_is_reported_without_calling_elevenlabs(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path, api_key="")

    response = client.post("/api/speech", data={"text": "Hello.", "voiceId": "default"})

    assert response.status_code == 500
    assert response.json()["detail"] == "ELEVENLABS_API_KEY is not configured."
    assert fake_client.created_samples == []


def test_elevenlabs_error_is_sanitized(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)
    fake_client.create_voice_error = ElevenLabsError("ElevenLabs API returned 401: Invalid API key.", 502)

    response = client.post("/api/speech", data={"text": "Hello.", "voiceId": "default"})

    assert response.status_code == 502
    assert response.json()["detail"] == "ElevenLabs API returned 401: Invalid API key."
    assert "test-key" not in response.text
