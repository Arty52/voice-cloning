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


def parakeet_segments(result):
    """Contain a malformed subword's fallback to its sentence, not its whole chunk."""
    from types import SimpleNamespace
    for sentence in result.sentences:
        words = parakeet_words(sentence.tokens)
        yield SimpleNamespace(text=sentence.text, start=sentence.start, end=sentence.end,
            words=[SimpleNamespace(word=w.text, start=w.start_seconds, end=w.end_seconds) for w in words])


def merge_overlap(previous, current, overlap_start, overlap_end):
    """Choose one shared acoustic/text anchor, allowing small alignment drift.

    Match two consecutive words at the same source time. Repeated phrases at
    different times are never collapsed. Fall back to timestamp ownership when
    the overlap contains no shared speech, keeping segment fallbacks whole.
    """
    import re
    if not previous:
        return list(current)
    if not current:
        return list(previous)
    midpoint = (overlap_start+overlap_end)/2
    normalize = lambda word: re.sub(r'\W+', '', word.text.casefold())
    candidates = []
    left = [(i,w) for i,w in enumerate(previous[:-1]) if overlap_start <= w.start_seconds < overlap_end]
    right = [(j,w) for j,w in enumerate(current[:-1]) if overlap_start <= w.start_seconds < overlap_end]
    for i,a in left:
        for j,b in right:
            if (a.has_word_alignment and b.has_word_alignment and normalize(a) and normalize(a)==normalize(b)
                and previous[i+1].has_word_alignment and current[j+1].has_word_alignment
                and normalize(previous[i+1])
                and normalize(previous[i+1])==normalize(current[j+1])
                and abs(a.start_seconds-b.start_seconds) <= .6
                and abs(previous[i+1].start_seconds-current[j+1].start_seconds) <= .6):
                # Repeated phrases can produce several text matches inside the
                # tolerance. Prefer the same acoustic occurrence before choosing
                # a convenient splice position near the overlap midpoint.
                timing_error = sum(abs(getattr(left_word, field)-getattr(right_word, field))
                    for left_word, right_word in ((a,b), (previous[i+1],current[j+1]))
                    for field in ('start_seconds','end_seconds'))
                candidates.append((timing_error, abs(previous[i+1].end_seconds-midpoint), i+2, j+2))
    if candidates:
        _, _, i, j = min(candidates)
        return list(previous[:i])+list(current[j:])
    cut = midpoint
    # A fallback sentence is indivisible: don't let a midpoint split duplicate
    # its prefix/suffix from the neighboring chunk.
    for word in previous:
        if not word.has_word_alignment and word.start_seconds < cut < word.end_seconds:
            cut = word.end_seconds
    for word in current:
        if not word.has_word_alignment and word.start_seconds < cut < word.end_seconds:
            cut = word.start_seconds
    return [w for w in previous if (w.start_seconds+w.end_seconds)/2 < cut] + [
        w for w in current if (w.start_seconds+w.end_seconds)/2 >= cut]
