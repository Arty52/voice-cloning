from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


VoiceSampleMode = Literal["excerpt", "sourceWindow"]
VoicePresetId = Literal["standardNarration", "animatedDialogue"]
DEFAULT_VOICE_PRESET_ID: VoicePresetId = "standardNarration"
SampleProcessingOperationId = Literal["isolateVoice", "trimSilence", "separateSpeakers"]
SampleProcessingPresetId = Literal["fast", "balanced", "clean", "maxIsolation", "trimLight", "trimBalanced", "trimAggressive"]
SampleProcessingSourcePreference = Literal["original", "active"]
SampleProcessingJobStatus = Literal["pending", "running", "success", "error", "canceled"]
SampleProcessingStepStatus = Literal["pending", "running", "success", "error", "canceled"]
SampleProcessingWorkflowMode = Literal["single", "stack"]


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
VOICE_PRESET_IDS = frozenset(preset.id for preset in VOICE_PRESETS)


@dataclass(frozen=True)
class VoiceSample:
    content: bytes
    filename: str
    content_type: str
    sha256: str


@dataclass(frozen=True)
class VoiceProcessingStep:
    id: str
    label: str
    operation_id: SampleProcessingOperationId
    created_at: str
    source_sha256: str
    result_sha256: str
    engine: str | None = None
    processing_preset_id: SampleProcessingPresetId | None = None
    processing_preset_label: str | None = None
    speaker_id: str | None = None
    speaker_label: str | None = None


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
    voice_preset_id: VoicePresetId = DEFAULT_VOICE_PRESET_ID
    processing_steps: tuple[VoiceProcessingStep, ...] = ()


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


@dataclass(frozen=True)
class SampleProcessingOperation:
    id: SampleProcessingOperationId
    label: str
    description: str
    enabled: bool
    processing_presets: tuple[SampleProcessingPreset, ...] = ()
    default_processing_preset_id: SampleProcessingPresetId | None = None


@dataclass(frozen=True)
class SampleProcessingPreset:
    id: SampleProcessingPresetId
    label: str
    description: str


@dataclass(frozen=True)
class SampleProcessingResult:
    path: str
    filename: str
    content_type: str
    sha256: str


@dataclass(frozen=True)
class SpeakerTranscriptItem:
    id: str
    text: str
    start_seconds: float
    end_seconds: float
    speaker_id: str


@dataclass(frozen=True)
class SpeakerSeparationTranscript:
    items: tuple[SpeakerTranscriptItem, ...]


@dataclass(frozen=True)
class SpeakerSeparationSpeaker:
    id: str
    label: str
    transcript_item_ids: tuple[str, ...]
    assigned_name: str | None = None
    result: SampleProcessingResult | None = None


@dataclass(frozen=True)
class SpeakerSeparationResult:
    kind: Literal["speakerSeparation"]
    speakers: tuple[SpeakerSeparationSpeaker, ...]
    transcript: SpeakerSeparationTranscript


SampleProcessingJobResult = SampleProcessingResult | SpeakerSeparationResult


@dataclass(frozen=True)
class SampleProcessingJobStep:
    id: str
    operation_id: SampleProcessingOperationId
    operation_label: str
    status: SampleProcessingStepStatus
    engine: str | None = None
    processing_preset_id: SampleProcessingPresetId | None = None
    processing_preset_label: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    source_sha256: str | None = None
    result_sha256: str | None = None


@dataclass(frozen=True)
class SampleProcessingJob:
    id: str
    operation_id: SampleProcessingOperationId
    status: SampleProcessingJobStatus
    source_name: str
    source_filename: str
    source_content_type: str
    source_sha256: str
    source_preference: SampleProcessingSourcePreference
    created_at: str
    updated_at: str
    error: str | None = None
    result: SampleProcessingJobResult | None = None
    engine: str | None = None
    processing_preset_id: SampleProcessingPresetId | None = None
    processing_preset_label: str | None = None
    workflow_mode: SampleProcessingWorkflowMode = "single"
    steps: tuple[SampleProcessingJobStep, ...] = ()
    active_step_id: str | None = None
