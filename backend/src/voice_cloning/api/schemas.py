from __future__ import annotations

from pydantic import BaseModel


class DefaultVoiceRequest(BaseModel):
    voiceId: str


class RenameVoiceRequest(BaseModel):
    name: str
