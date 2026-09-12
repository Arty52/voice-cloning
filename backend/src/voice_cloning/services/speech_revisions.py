"""Build immutable speech revisions without provider or persistence side effects."""
from dataclasses import dataclass, replace
from typing import Mapping

from ..models import SpeechJob, SpeechJobSegment


@dataclass(frozen=True)
class SpeechSegmentReplacement:
    segment_id: str
    text: str
    voice_id: str
    voice_settings: Mapping[str, object]


def revision_segments(
    base: SpeechJob,
    replacements: tuple[SpeechSegmentReplacement, ...],
    *,
    max_text_chars: int,
) -> tuple[SpeechJobSegment, ...]:
    known_ids = {segment.id for segment in base.segments}
    changes: dict[str, SpeechSegmentReplacement] = {}
    for change in replacements:
        if change.segment_id not in known_ids:
            raise ValueError("A replacement refers to an unknown speech segment.")
        if change.segment_id in changes:
            raise ValueError("Each speech segment can be replaced only once.")
        if not change.text.strip():
            raise ValueError("Speech segments must contain speakable text.")
        if not change.voice_id.strip():
            raise ValueError("A voice is required for each replacement.")
        changes[change.segment_id] = change

    segments = tuple(
        replace(
            segment,
            text=change.text,
            voice_id=change.voice_id,
            voice_settings=dict(change.voice_settings),
            status="pending",
            character_count=None,
            request_id=None,
            cache_state=None,
            result_sha256=None,
            error=None,
        ) if (change := changes.get(segment.id)) else segment
        for segment in base.segments
    )
    if len("".join(segment.text for segment in segments)) > max_text_chars:
        raise ValueError(f"Text must be {max_text_chars} characters or fewer.")
    return segments
