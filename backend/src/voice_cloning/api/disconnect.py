from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Awaitable, Callable, Protocol, TypeVar

T = TypeVar("T")


class DisconnectAwareRequest(Protocol):
    async def is_disconnected(self) -> bool: ...


class SpeechGenerationCanceled(Exception):
    pass


async def _await_or_cancel_on_disconnect(
    request: DisconnectAwareRequest,
    start_work: Callable[[], Awaitable[T]],
    poll_interval: float = 0.1,
) -> T:
    if await request.is_disconnected():
        raise SpeechGenerationCanceled

    task = asyncio.ensure_future(start_work())
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=poll_interval)
            if task in done:
                return await task
            if await request.is_disconnected():
                await _cancel_and_drain_task(task)
                raise SpeechGenerationCanceled
    except BaseException:
        if not task.done():
            await _cancel_and_drain_task(task)
        raise


async def _cancel_and_drain_task(task: asyncio.Task[object]) -> None:
    task.cancel()
    with suppress(asyncio.CancelledError, Exception):
        await task
