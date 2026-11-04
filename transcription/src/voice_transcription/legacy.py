"""Lazy CPU adapters; optional inference dependencies are loaded by the caller."""
from pathlib import Path
from typing import Any, Callable
from .contracts import Diarization, InferenceError, Word
from .normalize import diarization_turns, transcribed_words

class FasterWhisperTranscriber:
    def __init__(self, factory: Callable, model: str, device: str, compute_type: str):
        self.factory, self.model_name, self.device, self.compute_type = factory, model, device, compute_type
        self.model: Any = None

    def transcribe(self, audio: Path, language: str | None = None) -> tuple[Word, ...]:
        if self.model is None:
            try:
                self.model = self.factory(self.model_name, device=self.device, compute_type=self.compute_type)
            except Exception as exc:
                raise InferenceError("Whisper transcription model could not be loaded. Check the configured model and local cache.", 503) from exc
        try:
            options = {"word_timestamps": True}
            if language is not None:
                options["language"] = language
            segments, _ = self.model.transcribe(str(audio), **options)
            return transcribed_words(segments)
        except InferenceError:
            raise
        except Exception as exc:
            raise InferenceError("Whisper transcription failed.") from exc

class PyannoteDiarizer:
    def __init__(self, factory: Callable, model: str, token: str):
        self.factory, self.model_name, self.token = factory, model, token
        self.pipeline: Any = None

    def diarize(self, audio: Path) -> Diarization:
        if not self.token:
            raise InferenceError("Hugging Face token is required for speaker diarization.", 503)
        if self.pipeline is None:
            try:
                self.pipeline = self.factory.from_pretrained(self.model_name, token=self.token)
                if self.pipeline is None:
                    raise ValueError("Model unavailable")
            except Exception as exc:
                raise InferenceError("pyannote diarization model could not be loaded. Accept model conditions and check the Hugging Face token.", 503) from exc
        try:
            output = self.pipeline(str(audio))
        except Exception as exc:
            raise InferenceError("Speaker diarization failed.") from exc
        turns = diarization_turns(output)
        if not turns:
            raise InferenceError("Speaker diarization did not detect any speakers.", 422)
        exclusive = getattr(output, "exclusive_speaker_diarization", None)
        return Diarization(turns, diarization_turns(exclusive) if exclusive is not None else turns)
