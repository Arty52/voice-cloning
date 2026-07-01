from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


VoiceSampleMode = Literal["excerpt", "sourceWindow"]
VoicePresetId = Literal["standardNarration", "animatedDialogue"]
DEFAULT_VOICE_PRESET_ID: VoicePresetId = "standardNarration"
SampleProcessingOperationId = Literal["prepareVoice", "isolateVoice", "trimSilence", "separateSpeakers"]
SampleProcessingPresetId = Literal["fast", "balanced", "clean", "maxIsolation", "trimLight", "trimBalanced", "trimAggressive"]
SampleProcessingSourcePreference = Literal["original", "active"]
SampleProcessingMediaKind = Literal["audio", "video"]
SampleProcessingJobStatus = Literal["pending", "running", "success", "error", "canceled", "interrupted"]
SampleProcessingStepStatus = Literal["pending", "running", "success", "error", "canceled"]
SampleProcessingWorkflowMode = Literal["single", "stack"]
SpeechJobStatus = Literal["pending", "running", "success", "error", "canceled", "interrupted"]
SpeechSegmentStatus = Literal["pending", "running", "success", "error", "canceled"]
SpeechSegmentAssignmentKind = Literal["assigned", "default"]


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
    voice_settings_by_provider: dict[str, dict[str, object]] = field(default_factory=dict)
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
class SampleProcessingMediaSourceChapter:
    id: str
    title: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float


@dataclass(frozen=True)
class SampleProcessingMediaSourceAudioStream:
    index: int
    codec_name: str | None = None
    sample_rate_hz: int | None = None
    channels: int | None = None
    channel_layout: str | None = None
    language: str | None = None
    title: str | None = None


@dataclass(frozen=True)
class SampleProcessingMediaSource:
    id: str
    path: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    duration_seconds: float | None
    sample_rate_hz: int | None
    chapters: tuple[SampleProcessingMediaSourceChapter, ...] = ()
    warnings: tuple[str, ...] = ()
    media_kind: SampleProcessingMediaKind = "audio"
    audio_streams: tuple[SampleProcessingMediaSourceAudioStream, ...] = ()
    selected_audio_stream_index: int | None = None


@dataclass(frozen=True)
class SampleProcessingSourceRange:
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    label: str | None = None


@dataclass(frozen=True)
class SampleProcessingSourceSelection:
    source_media_id: str
    ranges: tuple[SampleProcessingSourceRange, ...]


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


@dataclass(frozen=True)
class PreparedSampleCandidate:
    candidate_id: str
    rank: int
    score: float
    speaker_id: str
    speaker_label: str
    source_start_seconds: float
    source_end_seconds: float
    duration_seconds: float
    sample_rate_hz: int
    content_type: str
    sha256: str
    warnings: tuple[str, ...]
    result: SampleProcessingResult


@dataclass(frozen=True)
class PreparedSamplesResult:
    kind: Literal["preparedSamples"]
    candidates: tuple[PreparedSampleCandidate, ...]
    warnings: tuple[str, ...] = ()


SampleProcessingJobResult = SampleProcessingResult | SpeakerSeparationResult | PreparedSamplesResult


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
class SampleProcessingDurationRange:
    min_seconds: int
    max_seconds: int


@dataclass(frozen=True)
class SampleProcessingProgressPhase:
    id: str
    label: str
    status: SampleProcessingStepStatus
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    detail: str | None = None


@dataclass(frozen=True)
class SampleProcessingJob:
    id: str
    operation_id: SampleProcessingOperationId
    status: SampleProcessingJobStatus
    source_name: str
    source_filename: str
    source_content_type: str
    source_sha256: str
    source_size_bytes: int | None
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
    estimated_duration_range_seconds: SampleProcessingDurationRange | None = None
    progress_phases: tuple[SampleProcessingProgressPhase, ...] = ()
    active_progress_phase_id: str | None = None
    source_selection: SampleProcessingSourceSelection | None = None


@dataclass(frozen=True)
class SpeechJobSegment:
    id: str
    index: int
    text: str
    voice_id: str
    voice_name: str
    assignment_kind: SpeechSegmentAssignmentKind
    voice_settings: dict[str, object] | None = None
    status: SpeechSegmentStatus = "pending"
    generation_count: int = 0
    character_count: int | None = None
    request_id: str | None = None
    cache_state: str | None = None
    result_sha256: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class SpeechJob:
    id: str
    status: SpeechJobStatus
    text: str
    default_voice_id: str
    segment_gap_ms: int
    segments: tuple[SpeechJobSegment, ...]
    created_at: str
    updated_at: str
    provider_id: str | None = None
    model_id: str | None = None
    voice_settings: dict[str, object] | None = None
    active_segment_id: str | None = None
    result_sha256: str | None = None
    error: str | None = None
