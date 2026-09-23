"""Timing invariants shared by transcript producers and consumers."""

from collections.abc import Iterable
import math


def is_valid_time_range(start_seconds: float, end_seconds: float) -> bool:
    return (
        math.isfinite(start_seconds)
        and math.isfinite(end_seconds)
        and 0 <= start_seconds < end_seconds
    )


def has_valid_word_timing(
    start_seconds: float,
    end_seconds: float,
    word_ranges: Iterable[tuple[float, float]],
) -> bool:
    """Require positive, ordered word intervals inside a valid passage."""
    if not is_valid_time_range(start_seconds, end_seconds):
        return False
    previous_end_seconds = start_seconds
    for word_start, word_end in word_ranges:
        if (
            not is_valid_time_range(word_start, word_end)
            or word_start < previous_end_seconds
            or word_end > end_seconds
        ):
            return False
        previous_end_seconds = word_end
    return True
