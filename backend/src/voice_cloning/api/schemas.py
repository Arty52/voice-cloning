from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class DefaultVoiceRequest(BaseModel):
    voiceId: str


class VoiceUpdateRequest(BaseModel):
    name: str | None = None
    providerId: str | None = None
    voicePresetId: str | None = None
    voiceSettings: dict[str, Any] | None = None


class SaveProcessedVoiceRequest(BaseModel):
    name: str
    voicePresetId: str | None = None


class SpeakerNameAssignmentRequest(BaseModel):
    speakerId: str
    name: str | None = None


class SpeakerTranscriptAssignmentRequest(BaseModel):
    itemId: str
    speakerId: str


class UpdateSpeakerAssignmentsRequest(BaseModel):
    speakerNames: list[SpeakerNameAssignmentRequest] = Field(default_factory=list)
    transcriptAssignments: list[SpeakerTranscriptAssignmentRequest] = Field(default_factory=list)


class SaveSpeakerVoiceRequest(BaseModel):
    speakerId: str
    name: str
    voicePresetId: str | None = None


class SaveSpeakerVoicesRequest(BaseModel):
    voices: list[SaveSpeakerVoiceRequest]


class SpeechJobSegmentRequest(BaseModel):
    clientSegmentId: str | None = None
    text: str
    voiceId: str
    assignmentKind: Literal["assigned", "default"] = "assigned"
    voiceSettings: dict[str, Any] | None = None


class CreateSpeechJobRequest(BaseModel):
    text: str
    defaultVoiceId: str
    providerId: str | None = None
    modelId: str | None = None
    segmentGapMs: int | None = Field(default=None, ge=0)
    voiceSettings: dict[str, Any] | None = None
    segments: list[SpeechJobSegmentRequest] = Field(min_length=1)


class RegenerateSpeechSegmentRequest(BaseModel):
    voiceId: str | None = None
    voiceSettings: dict[str, Any] | None = None
