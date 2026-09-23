from types import SimpleNamespace

import pytest

from voice_cloning.sample_processors import _transcribed_words
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
