from __future__ import annotations

import asyncio
from collections.abc import Callable


CommandErrorFactory = Callable[[str, int], Exception]


async def run_capture_command(
    args: list[str],
    label: str,
    timeout_seconds: float,
    make_error: CommandErrorFactory,
) -> tuple[bytes, bytes]:
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise make_error(f"{label} command was not found.", 503) from exc

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except asyncio.CancelledError:
        _kill_process(process)
        await process.communicate()
        raise
    except TimeoutError as exc:
        _kill_process(process)
        await process.communicate()
        raise make_error(f"{label} timed out.", 504) from exc

    if process.returncode != 0:
        message = " ".join(stderr.decode("utf-8", errors="replace").split())[-500:]
        detail = f"{label} failed with exit code {process.returncode}."
        if message:
            detail = f"{detail} {message}"
        raise make_error(detail, 502)
    return stdout, stderr


async def run_external_command(
    args: list[str],
    label: str,
    timeout_seconds: float,
    make_error: CommandErrorFactory,
) -> None:
    await run_capture_command(args, label, timeout_seconds, make_error)


def positive_float_from_payload(payload: object, key: str) -> float | None:
    if not isinstance(payload, dict):
        return None
    return positive_float(payload.get(key))


def non_negative_float_from_payload(payload: object, key: str) -> float | None:
    if not isinstance(payload, dict):
        return None
    return non_negative_float(payload.get(key))


def positive_float(value: object) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return parsed


def non_negative_float(value: object) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return parsed


def seconds_arg(value: float) -> str:
    return f"{max(0.0, value):.3f}".rstrip("0").rstrip(".") or "0"


def _kill_process(process: asyncio.subprocess.Process) -> None:
    try:
        process.kill()
    except ProcessLookupError:
        pass
