from typing import Any
from .contracts import Turn, Word, InferenceError
from .timing import is_valid_time_range

def diarization_turns(diarization: Any) -> tuple[Turn, ...]:
    annotation = getattr(diarization, "speaker_diarization", diarization)
    if hasattr(annotation, "itertracks"):
        raw_turns = annotation.itertracks(yield_label=True)
    else:
        raw_turns = annotation
    turns: list[Turn] = []
    for raw_turn in raw_turns:
        parsed = _parse_diarization_turn(raw_turn)
        if parsed is not None:
            turns.append(parsed)
    turns.sort(key=lambda turn: (turn.start_seconds, turn.end_seconds, turn.speaker_label))
    return tuple(turns)


def _parse_diarization_turn(raw_turn: object) -> Turn | None:
    if not isinstance(raw_turn, tuple):
        return None
    if len(raw_turn) == 3:
        segment, _, speaker_label = raw_turn
    elif len(raw_turn) == 2:
        segment, speaker_label = raw_turn
    else:
        return None
    start_seconds = _optional_float(getattr(segment, "start", None))
    end_seconds = _optional_float(getattr(segment, "end", None))
    if start_seconds is None or end_seconds is None or not is_valid_time_range(start_seconds, end_seconds):
        return None
    return Turn(
        start_seconds=start_seconds,
        end_seconds=end_seconds,
        speaker_label=str(speaker_label),
    )


def transcribed_words(segments: object) -> tuple[Word, ...]:
    words: list[Word] = []
    for segment in segments:
        segment_words = [
            word for word in (getattr(segment, "words", None) or ()) if _transcription_text(word)
        ]
        parsed_words = [_transcribed_word_from_object(word) for word in segment_words]
        if parsed_words and all(word is not None for word in parsed_words):
            words.extend(word for word in parsed_words if word is not None)
            continue
        # One unusable word must not silently delete text from the transcript.
        text = _transcription_text(segment) or _join_word_texts(
            [_transcription_text(word) for word in segment_words]
        )
        if not text:
            continue
        parsed_segment = _transcribed_word_from_object(segment, has_word_alignment=False, text=text)
        if parsed_segment is None:
            raise InferenceError(
                "Whisper transcription has no usable timing for a passage.", 502,
            )
        words.append(parsed_segment)
    # Timestamp sorting can reorder the spoken text when model alignment is bad.
    return tuple(words)


def _transcription_text(value: object) -> str:
    text = getattr(value, "word", getattr(value, "text", ""))
    return text.strip() if isinstance(text, str) else ""


def _transcribed_word_from_object(
    value: object,
    *,
    has_word_alignment: bool = True,
    text: str | None = None,
) -> Word | None:
    text = _transcription_text(value) if text is None else text
    start_seconds = _optional_float(getattr(value, "start", None))
    end_seconds = _optional_float(getattr(value, "end", None))
    if (
        not text
        or start_seconds is None
        or end_seconds is None
        or not is_valid_time_range(start_seconds, end_seconds)
    ):
        return None
    return Word(
        text=text,
        start_seconds=start_seconds,
        end_seconds=end_seconds,
        has_word_alignment=has_word_alignment,
    )


def _optional_float(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _join_word_texts(words: list[str]) -> str:
    text = " ".join(word.strip() for word in words if word.strip())
    for punctuation in (".", ",", "?", "!", ";", ":"):
        text = text.replace(f" {punctuation}", punctuation)
    return text


