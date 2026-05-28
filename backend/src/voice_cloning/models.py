from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


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


@dataclass(frozen=True)
class VoiceSettings:
    stability: float
    similarity_boost: float
    style: float
    speed: float
    use_speaker_boost: bool


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
