from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from voice_cloning.api import create_app
from voice_cloning.cache import VoiceCache
from voice_cloning.config import Settings
from voice_cloning.elevenlabs_client import ElevenLabsError
from voice_cloning.models import VoiceClone, VoiceSample, VoiceSettings
from voice_cloning.voice_library import VoiceLibrary


class FakeElevenLabsClient:
    def __init__(self) -> None:
        self.created_samples: list[VoiceSample] = []
        self.speech_requests: list[tuple[str, str, VoiceSettings | None]] = []
        self.create_voice_error: ElevenLabsError | None = None

    async def create_voice(self, sample: VoiceSample) -> VoiceClone:
        if self.create_voice_error is not None:
            raise self.create_voice_error
        self.created_samples.append(sample)
        return VoiceClone(voice_id=f"voice-{sample.sha256[:8]}", requires_verification=False)

    async def create_speech(self, voice_id: str, text: str, voice_settings: VoiceSettings | None = None) -> bytes:
        self.speech_requests.append((voice_id, text, voice_settings))
        return b"fake-mp3"


def make_settings(tmp_path: Path, api_key: str = "test-key", with_default_sample: bool = True) -> Settings:
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
        cors_allowed_origins=["http://localhost:4340"],
    )


def make_client(
    tmp_path: Path,
    api_key: str = "test-key",
    with_default_sample: bool = True,
) -> tuple[TestClient, FakeElevenLabsClient]:
    settings = make_settings(tmp_path, api_key=api_key, with_default_sample=with_default_sample)
    fake_client = FakeElevenLabsClient()
    app = create_app(
        settings=settings,
        elevenlabs_client=fake_client,  # type: ignore[arg-type]
        voice_cache=VoiceCache(settings.storage_dir / "voice-cache.json"),
        voice_library=VoiceLibrary(settings),
    )
    return TestClient(app), fake_client


def test_health_reports_default_sample(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["defaultSampleAvailable"] is True
    assert response.json()["defaultVoiceId"] == "default"


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


def test_voice_manifest_bootstraps_default_voice(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.get("/api/voices")

    assert response.status_code == 200
    assert response.json()["defaultVoiceId"] == "default"
    assert response.json()["voices"][0]["name"] == "Default voice"
    assert response.json()["voices"][0]["filePath"] == "default/default-voice.mp3"


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
    assert settings == VoiceSettings(
        stability=0.42,
        similarity_boost=0.84,
        style=0.2,
        speed=1.1,
        use_speaker_boost=False,
    )


def test_add_uploaded_voice_stores_named_asset(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    response = client.post(
        "/api/voices",
        data={"name": "Gray"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )

    assert response.status_code == 201
    assert response.json()["voice"]["id"] == "gray"
    assert response.json()["voice"]["name"] == "Gray"
    assert (tmp_path / "assets" / "voices" / "gray.mp3").read_bytes() == b"uploaded-sample"


def test_add_uploaded_voice_rejects_duplicate_slug(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)

    first = client.post(
        "/api/voices",
        data={"name": "Gray"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    second = client.post(
        "/api/voices",
        data={"name": "Gray!"},
        files={"sampleFile": ("other.mp3", b"other-sample", "audio/mpeg")},
    )

    assert first.status_code == 201
    assert second.status_code == 409
    assert "already exists" in second.json()["detail"]


def test_set_default_voice_persists(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    upload = client.post(
        "/api/voices",
        data={"name": "Gray"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )
    assert upload.status_code == 201

    response = client.put("/api/voices/default", json={"voiceId": "gray"})
    voices = client.get("/api/voices")

    assert response.status_code == 200
    assert response.json()["defaultVoiceId"] == "gray"
    assert voices.json()["defaultVoiceId"] == "gray"


def test_selected_voice_sample_is_used_for_speech(tmp_path: Path) -> None:
    client, fake_client = make_client(tmp_path)
    upload = client.post(
        "/api/voices",
        data={"name": "Gray"},
        files={"sampleFile": ("gray.wav", b"uploaded-wave", "audio/wav")},
    )
    assert upload.status_code == 201

    response = client.post("/api/speech", data={"text": "Use Gray.", "voiceId": "gray"})

    assert response.status_code == 200
    assert fake_client.created_samples[0].filename == "gray.wav"
    assert fake_client.created_samples[0].content == b"uploaded-wave"


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
