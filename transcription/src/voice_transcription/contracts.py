"""Stable inference values; independent of FastAPI and model runtimes."""
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

class InferenceError(Exception):
    def __init__(self, detail: str, status_code: int = 502):
        super().__init__(detail)
        self.detail, self.status_code = detail, status_code

@dataclass(frozen=True)
class Word:
    text: str
    start_seconds: float
    end_seconds: float
    has_word_alignment: bool = True

@dataclass(frozen=True)
class Turn:
    start_seconds: float
    end_seconds: float
    speaker_label: str

@dataclass(frozen=True)
class Diarization:
    turns: tuple[Turn, ...]
    exclusive_turns: tuple[Turn, ...]

class Transcriber(Protocol):
    def transcribe(self, audio: Path, language: str | None = None) -> tuple[Word, ...]: ...

class Diarizer(Protocol):
    def diarize(self, audio: Path) -> Diarization: ...
