"""Bounded overlapping reads with disjoint timestamp ownership."""
from dataclasses import replace
from .contracts import Word


def windows(duration: float, length: float = 120., overlap: float = 15.):
    if duration <= 0 or length <= 0 or not 0 <= overlap < length:
        raise ValueError('Invalid chunk duration or overlap.')
    start = 0.
    while start < duration:
        end = min(duration, start+length)
        yield start, end, start+overlap/2 if start else 0., end-overlap/2 if end < duration else duration
        if end == duration:
            break
        start += length-overlap


def owned_words(words, offset, keep_start, keep_end, duration):
    """Keep each acoustic interval once; never deduplicate legitimate repeated text."""
    for word in words:
        start, end = word.start_seconds+offset, word.end_seconds+offset
        if keep_start <= (start+end)/2 < keep_end and 0 <= start < end <= duration:
            yield replace(word, start_seconds=start, end_seconds=end)


def parakeet_words(tokens):
    """Parakeet emits subword pieces; concatenate them before exposing word timings."""
    current = []
    for token in tokens:
        if token.text[:1].isspace() and current:
            yield _word(current)
            current = []
        current.append(token)
    if current:
        yield _word(current)


def _word(parts):
    return Word(''.join(x.text for x in parts).strip(), parts[0].start, parts[-1].end)
