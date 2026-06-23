from __future__ import annotations

from pydantic import BaseModel, Field


class DefaultVoiceRequest(BaseModel):
    voiceId: str


class VoiceUpdateRequest(BaseModel):
    name: str | None = None
    voicePresetId: str | None = None


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
