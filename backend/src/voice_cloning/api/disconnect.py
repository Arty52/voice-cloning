from __future__ import annotations

from ..services.cancellation import SpeechGenerationCanceled, _await_or_cancel_on_disconnect

__all__ = ["SpeechGenerationCanceled", "_await_or_cancel_on_disconnect"]
