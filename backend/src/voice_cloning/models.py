from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


VoiceSampleMode = Literal["excerpt", "sourceWindow"]
VoicePresetId = Literal["standardNarration", "animatedDialogue"]
DEFAULT_VOICE_PRESET_ID: VoicePresetId = "standardNarration"


@dataclass(frozen=True)
class VoicePreset:
    id: VoicePresetId
    label: str
    description: str


VOICE_PRESETS: tuple[VoicePreset, ...] = (
    VoicePreset(
        id="standardNarration",
        label="Standard Narration",
        description="Balanced clone similarity for steady narration.",
    ),
    VoicePreset(
        id="animatedDialogue",
        label="Animated Dialogue",
        description="More expressive delivery for character reads.",
    ),
)


@dataclass(frozen=True)
class VoiceSample:
    content: bytes
    filename: str
    content_type: str
    sha256: str


@dataclass(frozen=True)
class VoiceAsset:
    id: str
    name: str
    file_path: str
    content_type: str
    sha256: str
    source: Literal["default", "upload"]
    created_at: str
    sample_mode: VoiceSampleMode = "excerpt"
    window_start_seconds: float | None = None
    window_duration_seconds: float | None = None
    source_file_path: str | None = None
    source_content_type: str | None = None
    source_sha256: str | None = None


@dataclass(frozen=True)
class VoiceSettings:
    stability: float
    similarity_boost: float
    style: float
    speed: float
    use_speaker_boost: bool


@dataclass(frozen=True)
class SubscriptionSummary:
    tier: str
    status: str
    character_count: int
    character_limit: int
    remaining_characters: int
    can_extend_character_limit: bool
    max_credit_limit_extension: int | str | None
    next_character_count_reset_unix: int | None


@dataclass(frozen=True)
class ModelSummary:
    model_id: str
    name: str
    description: str
    can_use_style: bool
    can_use_speaker_boost: bool
    character_cost_multiplier: float | None
    max_characters_request_free_user: int | None
    max_characters_request_subscribed_user: int | None
    maximum_text_length_per_request: int | None


@dataclass(frozen=True)
class SpeechResult:
    audio: bytes
    character_count: int | None
    request_id: str | None


@dataclass(frozen=True)
class VoiceClone:
    voice_id: str
    requires_verification: bool


@dataclass(frozen=True)
class CachedVoice:
    voice_id: str
    sample_name: str
    created_at: str
    requires_verification: bool
