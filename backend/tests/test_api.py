from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from voice_cloning.api import SpeechGenerationCanceled, _await_or_cancel_on_disconnect, create_app
from voice_cloning.cache import VoiceCache
from voice_cloning.config import Settings
from voice_cloning.elevenlabs_client import (
    ElevenLabsError,
    _is_tts_model,
    _model_from_payload,
)
from voice_cloning.models import (
    ModelSummary,
    SpeechResult,
    SubscriptionSummary,
    VoiceClone,
    VoiceSample,
    VoiceSettings,
)
from voice_cloning.voice_library import VoiceLibrary


class FakeElevenLabsClient:
    def __init__(self) -> None:
        self.created_samples: list[VoiceSample] = []
        self.speech_requests: list[tuple[str, str, VoiceSettings | None, str | None]] = []
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

    async def get_subscription(self) -> SubscriptionSummary:
        if self.subscription_error is not None:
            raise self.subscription_error
        return self.subscription

    async def list_models(self) -> list[ModelSummary]:
        if self.models_error is not None:
            raise self.models_error
        return self.models

    async def create_voice(self, sample: VoiceSample) -> VoiceClone:
        if self.create_voice_error is not None:
            raise self.create_voice_error
        if self.create_voice_delay:
            await asyncio.sleep(self.create_voice_delay)
        self.created_samples.append(sample)
        return VoiceClone(voice_id=f"voice-{sample.sha256[:8]}", requires_verification=False)

    async def create_speech(
        self,
        voice_id: str,
        text: str,
        voice_settings: VoiceSettings | None = None,
        model_id: str | None = None,
    ) -> SpeechResult:
        if self.create_speech_delay:
            await asyncio.sleep(self.create_speech_delay)
        self.speech_requests.append((voice_id, text, voice_settings, model_id))
        return SpeechResult(
            audio=b"fake-mp3",
            character_count=self.speech_character_count,
            request_id=self.speech_request_id,
        )


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
        data={"name": "Voice_Clone_01"},
        files={"sampleFile": ("voice.mp3", b"uploaded-sample", "audio/mpeg")},
    )

    assert response.status_code == 201
    assert response.json()["voice"]["id"] == "voice-clone-01"
    assert response.json()["voice"]["name"] == "Voice_Clone_01"
    assert (tmp_path / "assets" / "voices" / "voice-clone-01.mp3").read_bytes() == b"uploaded-sample"


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
    assert not (tmp_path / "assets" / "voices" / "voice-clone-01.mp3").exists()


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
