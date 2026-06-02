from __future__ import annotations

import asyncio
import json
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
    _normalize_control_value,
)
from voice_cloning.api.serializers import audio_response
from voice_cloning.models import (
    CachedVoice,
    ModelSummary,
    SpeechResult,
    SubscriptionSummary,
    VoiceClone,
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
    resolve_elevenlabs_key,
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
) -> tuple[TestClient, FakeElevenLabsProvider]:
    settings = make_settings(tmp_path, api_key=api_key, with_default_sample=with_default_sample)
    fake_client = FakeElevenLabsProvider().bind_settings(settings)
    app = create_app(
        settings=settings,
        provider_registry=ProviderRegistry([fake_client]),
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


def test_providers_endpoint_returns_public_provider_descriptor(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path, api_key="server-secret")

    response = client.get("/api/providers")

    assert response.status_code == 200
    payload = response.json()
    provider = payload["providers"][0]
    assert payload["defaultProviderId"] == "elevenlabs"
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
