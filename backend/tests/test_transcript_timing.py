import pytest

from voice_cloning.transcript_timing import has_valid_word_timing, is_valid_time_range


@pytest.mark.parametrize(
    ("start", "end"),
    [(-0.1, 1), (1, 1), (2, 1), (float("nan"), 1), (0, float("nan")),
     (float("-inf"), 1), (0, float("inf"))],
)
def test_rejects_invalid_passage_ranges(start: float, end: float) -> None:
    assert not is_valid_time_range(start, end)
    assert not has_valid_word_timing(start, end, [])


@pytest.mark.parametrize(
    "ranges",
    [
        [(1200.0, 1200.5), (1200.48, 1200.9)],  # Overlap after twenty minutes.
        [(1200.0, 1200.8), (1200.4, 1200.6)],  # Nested interval.
        [(1200.5, 1200.9), (1200.0, 1200.4)],  # Reversed order.
        [(1200.0, 1200.0)],
        [(1200.5, 1200.4)],
        [(-1, 1200.5)],
        [(1199.9, 1200.5)],
        [(1200.5, 1201.1)],
        [(float("nan"), 1200.5)],
        [(1200.0, float("nan"))],
        [(1200.0, float("inf"))],
    ],
)
def test_rejects_unreliable_word_timing(ranges: list[tuple[float, float]]) -> None:
    assert not has_valid_word_timing(1200.0, 1201.0, ranges)


@pytest.mark.parametrize(
    "ranges",
    [[], [(1200.0, 1201.0)], [(1200.0, 1200.5), (1200.5, 1201.0)],
     [(1200.1, 1200.4), (1200.6, 1200.9)]],
)
def test_accepts_optional_alignment_touching_boundaries_and_gaps(
    ranges: list[tuple[float, float]],
) -> None:
    assert is_valid_time_range(1200.0, 1201.0)
    assert has_valid_word_timing(1200.0, 1201.0, iter(ranges))
