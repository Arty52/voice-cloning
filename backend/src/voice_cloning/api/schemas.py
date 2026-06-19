from __future__ import annotations

from pydantic import BaseModel


class DefaultVoiceRequest(BaseModel):
    voiceId: str


class VoiceUpdateRequest(BaseModel):
    name: str | None = None
    voicePresetId: str | None = None


class SaveProcessedVoiceRequest(BaseModel):
    name: str
    voicePresetId: str | None = None
