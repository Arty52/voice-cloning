from types import SimpleNamespace

import pytest

from voice_cloning.sample_processors import (
    _DiarizationTurn,
    _speaker_separation_result_from_words,
    _transcribed_words,
)
from voice_cloning.services.sample_processing import SampleProcessingServiceError


def word(text: str, start: object, end: object) -> SimpleNamespace:
    return SimpleNamespace(word=text, start=start, end=end)


@pytest.mark.parametrize(
    ("start", "end"),
    [(1200.3, 1200.3), (1200.4, 1200.3), (None, 1200.4), (1200.3, None),
     (-1, 1200.4), (float("nan"), 1200.4), (1200.3, float("inf"))],
)
def test_unusable_word_uses_complete_segment_text_and_timing(start: object, end: object) -> None:
    segment = SimpleNamespace(
        text="Keep every word.", start=1200.0, end=1201.0,
        words=[word("Keep", 1200, 1200.2), word("every", start, end), word("word.", 1200.5, 1201)],
    )
    result = _transcribed_words(iter([segment]))

    assert len(result) == 1
    assert result[0].text == "Keep every word."
    assert (result[0].start_seconds, result[0].end_seconds) == (1200.0, 1201.0)
    assert not result[0].has_word_alignment


@pytest.mark.parametrize("words", [None, []])
def test_missing_word_alignment_uses_segment_timing(words: object) -> None:
    result = _transcribed_words([SimpleNamespace(text="Entire passage.", start=0, end=1, words=words)])
    assert result[0].text == "Entire passage."
    assert not result[0].has_word_alignment


def test_missing_segment_text_uses_all_word_text_with_segment_timing() -> None:
    result = _transcribed_words([
        SimpleNamespace(start=0, end=1, words=[word("Keep", 0, 0), word("me", 0.5, 1), word(".", 1, 1)])
    ])
    assert result[0].text == "Keep me."
    assert not result[0].has_word_alignment


def test_preserves_model_text_order_instead_of_sorting_bad_timestamps() -> None:
    result = _transcribed_words([
        SimpleNamespace(words=[word("First", 0.4, 0.8), word("second", 0.1, 0.3)])
    ])
    assert [item.text for item in result] == ["First", "second"]


def test_empty_tokens_do_not_remove_valid_word_alignment() -> None:
    result = _transcribed_words([
        SimpleNamespace(words=[word(" ", 0, 0), word("Hello", 0.1, 0.4)]),
        SimpleNamespace(text=" ", start=1, end=1, words=[]),
    ])
    assert [item.text for item in result] == ["Hello"]
    assert result[0].has_word_alignment


@pytest.mark.parametrize(("start", "end"), [(None, None), (1, 1), (-1, 1), (0, float("nan"))])
def test_missing_usable_word_and_passage_timing_fails_explicitly(start: object, end: object) -> None:
    with pytest.raises(SampleProcessingServiceError, match="no usable timing for a passage"):
        _transcribed_words([
            SimpleNamespace(text="Keep me.", start=start, end=end, words=[word("Keep me.", 0, 0)])
        ])


@pytest.mark.parametrize(
    "ranges",
    [
        [(1200.0, 1200.5), (1200.48, 1200.9)],
        [(1200.0, 1200.8), (1200.4, 1200.6)],
        [(1200.4, 1200.8), (1200.0, 1200.3)],
        [(1200.0, 1200.8), (1200.0, 1200.6)],
    ],
)
def test_unreliable_alignment_keeps_text_and_full_passage_envelope(
    ranges: list[tuple[float, float]],
) -> None:
    words = _transcribed_words([
        SimpleNamespace(words=[word(text, *bounds) for text, bounds in zip(["First", "second."], ranges)])
    ])
    result = _speaker_separation_result_from_words((_DiarizationTurn(1190, 1210, "A"),), words)

    item, = result.transcript.items
    assert item.text == "First second."
    assert item.words is None
    assert item.start_seconds == min(start for start, _ in ranges)
    assert item.end_seconds == max(end for _, end in ranges)
    assert result.speakers[0].transcript_item_ids == (item.id,)


def test_passage_fallback_does_not_disable_neighboring_word_alignment() -> None:
    words = _transcribed_words([
        SimpleNamespace(words=[word("Before.", 1200, 1200.4)]),
        SimpleNamespace(text="Keep the missing word.", start=1200.5, end=1201,
                        words=[word("Keep", 1200.5, 1200.5)]),
        SimpleNamespace(words=[word("After.", 1201.1, 1201.5)]),
    ])
    result = _speaker_separation_result_from_words((_DiarizationTurn(1190, 1210, "A"),), words)

    before, fallback, after = result.transcript.items
    assert [item.text for item in result.transcript.items] == ["Before.", "Keep the missing word.", "After."]
    assert before.words is not None
    assert fallback.words is None
    assert after.words is not None


def test_touching_word_boundaries_keep_exact_alignment() -> None:
    words = _transcribed_words([
        SimpleNamespace(words=[word("First", 1200, 1200.5), word("second.", 1200.5, 1201)])
    ])
    item, = _speaker_separation_result_from_words((_DiarizationTurn(1190, 1210, "A"),), words).transcript.items

    assert item.words is not None
    assert [(word.start_seconds, word.end_seconds) for word in item.words] == [(1200, 1200.5), (1200.5, 1201)]
