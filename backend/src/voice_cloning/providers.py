from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Literal, Mapping, Protocol

from .config import Settings
from .models import ModelSummary, SpeechResult, SubscriptionSummary, VoiceClone, VoicePresetId, VoiceSample


DEFAULT_PROVIDER_ID = "elevenlabs"
VOICE_PROVIDER_KEY_HEADER = "X-Voice-Provider-Key"
ProviderTuningValue = bool | float | int | str


@dataclass(frozen=True)
class ProviderLink:
    label: str
    href: str


@dataclass(frozen=True)
class ProviderTuningOption:
    label: str
    value: ProviderTuningValue


@dataclass(frozen=True)
class ProviderTuningControl:
    id: str
    label: str
    description: str
    type: Literal["slider", "toggle", "select"]
    default_value: ProviderTuningValue
    min_value: float | None = None
    max_value: float | None = None
    step: float | None = None
    options: tuple[ProviderTuningOption, ...] = ()
    capability: str | None = None


@dataclass(frozen=True)
class ProviderTuningPreset:
    id: str
    label: str
    description: str
    values: Mapping[str, ProviderTuningValue]
    voice_preset_id: VoicePresetId | None = None


@dataclass(frozen=True)
class ProviderTuningMetadata:
    controls: tuple[ProviderTuningControl, ...] = ()
    presets: tuple[ProviderTuningPreset, ...] = ()
    default_values: Mapping[str, ProviderTuningValue] | None = None

    def resolved_default_values(self) -> dict[str, ProviderTuningValue]:
        if self.default_values is not None:
            return dict(self.default_values)
        return {control.id: control.default_value for control in self.controls}


@dataclass(frozen=True)
class ProviderSampleMetadata:
    max_window_seconds: int
    recommended_min_seconds: int
    recommended_max_seconds: int
    target_sample_rate_hz: int = 16000


@dataclass(frozen=True)
class ProviderDescriptor:
    id: str
    label: str
    manage_key_url: str
    docs_url: str
    links: tuple[ProviderLink, ...] = ()
    tuning: ProviderTuningMetadata = ProviderTuningMetadata()
    sample: ProviderSampleMetadata = ProviderSampleMetadata(
        max_window_seconds=120,
        recommended_min_seconds=60,
        recommended_max_seconds=120,
    )


@dataclass(frozen=True)
class ProviderKeyContext:
    provider_id: str
    api_key: str
    source: Literal["browser", "server"]
    fingerprint: str

    @property
    def cache_namespace(self) -> str:
        return f"{self.provider_id}:{self.fingerprint}"


class ProviderError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class ProviderNotFoundError(ProviderError):
    pass


class VoiceProvider(Protocol):
    @property
    def id(self) -> str:
        raise NotImplementedError

    @property
    def descriptor(self) -> ProviderDescriptor:
        raise NotImplementedError

    @property
    def default_model_id(self) -> str:
        raise NotImplementedError

    @property
    def server_key_configured(self) -> bool:
        raise NotImplementedError

    def resolve_key(self, api_key_override: str | None) -> ProviderKeyContext:
        raise NotImplementedError

    def normalize_voice_settings(
        self,
        values: Mapping[str, Any] | None,
    ) -> dict[str, ProviderTuningValue]:
        raise NotImplementedError

    async def get_subscription(self, api_key: str | None = None) -> SubscriptionSummary:
        raise NotImplementedError

    async def list_models(self, api_key: str | None = None) -> list[ModelSummary]:
        raise NotImplementedError

    async def create_voice(self, sample: VoiceSample, api_key: str | None = None) -> VoiceClone:
        raise NotImplementedError

    async def create_speech(
        self,
        voice_id: str,
        text: str,
        voice_settings: Mapping[str, ProviderTuningValue] | None = None,
        model_id: str | None = None,
        api_key: str | None = None,
    ) -> SpeechResult:
        raise NotImplementedError


class ProviderRegistry:
    def __init__(
        self,
        providers: list[VoiceProvider],
        default_provider_id: str = DEFAULT_PROVIDER_ID,
    ) -> None:
        providers_by_id: dict[str, VoiceProvider] = {}
        for provider in providers:
            if provider.id in providers_by_id:
                raise ValueError(f"Duplicate voice provider id: {provider.id!r}.")
            providers_by_id[provider.id] = provider

        self._providers = providers_by_id
        if not self._providers:
            raise ValueError("At least one voice provider must be registered.")
        if default_provider_id not in self._providers:
            raise ValueError(f"Default provider {default_provider_id!r} is not registered.")
        self.default_provider_id = default_provider_id

    def get(self, provider_id: str | None = None) -> VoiceProvider:
        resolved_provider_id = (provider_id or self.default_provider_id).strip() or self.default_provider_id
        provider = self._providers.get(resolved_provider_id)
        if provider is None:
            raise ProviderNotFoundError(f"Unknown provider: {resolved_provider_id}.", status_code=404)
        return provider

    def descriptors(self) -> list[ProviderDescriptor]:
        return [provider.descriptor for provider in self._providers.values()]

    def server_key_configured_by_provider(self) -> dict[str, bool]:
        return {provider.id: provider.server_key_configured for provider in self._providers.values()}


ELEVENLABS_TUNING_METADATA = ProviderTuningMetadata(
    controls=(
        ProviderTuningControl(
            id="stability",
            label="Stability",
            description=(
                "Lower values allow more expressive, variable delivery. Higher values keep the voice "
                "consistent but can flatten emotion."
            ),
            type="slider",
            default_value=0.5,
            min_value=0,
            max_value=1,
            step=0.01,
        ),
        ProviderTuningControl(
            id="similarityBoost",
            label="Similarity",
            description=(
                "Higher values stay closer to the cloned voice. If the source has noise, clicks, or "
                "artifacts, very high similarity can preserve them."
            ),
            type="slider",
            default_value=0.75,
            min_value=0,
            max_value=1,
            step=0.01,
        ),
        ProviderTuningControl(
            id="style",
            label="Style",
            description=(
                "Zero is the most natural and consistent. Higher values exaggerate the speaker's style "
                "and may add latency or artifacts."
            ),
            type="slider",
            default_value=0,
            min_value=0,
            max_value=1,
            step=0.01,
            capability="Requires a model that supports style.",
        ),
        ProviderTuningControl(
            id="speed",
            label="Speed",
            description=(
                "One point zero is the baseline pace. Move toward 0.7 to slow down or 1.2 to speed up; "
                "extremes can reduce quality."
            ),
            type="slider",
            default_value=1,
            min_value=0.7,
            max_value=1.2,
            step=0.01,
        ),
        ProviderTuningControl(
            id="useSpeakerBoost",
            label="Speaker Boost",
            description="Boosts similarity to the selected speaker when the selected model supports it.",
            type="toggle",
            default_value=True,
            capability="Requires a model that supports speaker boost.",
        ),
    ),
    presets=(
        ProviderTuningPreset(
            id="standard",
            label="Standard Narration",
            description="Balanced clone similarity for steady narration.",
            voice_preset_id="standardNarration",
            values={
                "stability": 0.5,
                "similarityBoost": 0.75,
                "style": 0,
                "speed": 1,
                "useSpeakerBoost": True,
            },
        ),
        ProviderTuningPreset(
            id="animated",
            label="Animated Dialogue",
            description="More expressive delivery for character reads.",
            voice_preset_id="animatedDialogue",
            values={
                "stability": 0.4,
                "similarityBoost": 0.75,
                "style": 0.35,
                "speed": 1,
                "useSpeakerBoost": True,
            },
        ),
    ),
)


ELEVENLABS_SAMPLE_METADATA = ProviderSampleMetadata(
    max_window_seconds=120,
    recommended_min_seconds=60,
    recommended_max_seconds=120,
)


ELEVENLABS_PROVIDER_DESCRIPTOR = ProviderDescriptor(
    id=DEFAULT_PROVIDER_ID,
    label="ElevenLabs",
    manage_key_url="https://elevenlabs.io/app/subscription/api",
    docs_url="https://elevenlabs.io/docs/api-reference/authentication",
    links=(
        ProviderLink(
            label="API Requests",
            href="https://elevenlabs.io/app/developers/analytics/api-requests",
        ),
        ProviderLink(
            label="Costs Header",
            href="https://elevenlabs.io/docs/api-reference/introduction",
        ),
        ProviderLink(
            label="Subscription",
            href="https://elevenlabs.io/docs/api-reference/user/subscription/get",
        ),
        ProviderLink(
            label="Models",
            href="https://elevenlabs.io/docs/api-reference/models/list",
        ),
        ProviderLink(
            label="Create Speech",
            href="https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
        ),
    ),
    tuning=ELEVENLABS_TUNING_METADATA,
    sample=ELEVENLABS_SAMPLE_METADATA,
)


def provider_descriptors() -> list[ProviderDescriptor]:
    return [ELEVENLABS_PROVIDER_DESCRIPTOR]


def resolve_elevenlabs_key(settings: Settings, api_key_override: str | None) -> ProviderKeyContext:
    override = (api_key_override or "").strip()
    if override:
        api_key = override
        source: Literal["browser", "server"] = "browser"
    else:
        api_key = settings.elevenlabs_api_key.strip()
        source = "server"

    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured.")

    fingerprint = sha256(api_key.encode("utf-8")).hexdigest()
    return ProviderKeyContext(
        provider_id=ELEVENLABS_PROVIDER_DESCRIPTOR.id,
        api_key=api_key,
        source=source,
        fingerprint=fingerprint,
    )
