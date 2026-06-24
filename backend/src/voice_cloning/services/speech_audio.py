from __future__ import annotations

import asyncio
from pathlib import Path

from ..config import Settings


SPEECH_RESULT_FILENAME = "result.mp3"
SPEECH_RESULT_CONTENT_TYPE = "audio/mpeg"
SPEECH_SEGMENT_GAP_PREFIX = "segment-gap"


class SpeechAudioProcessorError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class SpeechAudioProcessor:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def concatenate(self, segment_paths: tuple[Path, ...], output_path: Path) -> None:
        if not segment_paths:
            raise SpeechAudioProcessorError("Speech job has no generated segments.", 422)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        gap_path = await self._prepare_gap_audio(segment_paths, output_path)
        concat_paths = _interleave_gap_audio(segment_paths, gap_path)
        concat_path = output_path.parent / "concat.txt"
        concat_path.write_text(
            "\n".join(["ffconcat version 1.0", *(f"file '{_escape_ffconcat_path(path)}'" for path in concat_paths)]),
            encoding="utf-8",
        )

        await _run_external_command(
            [
                self.settings.sample_processing_ffmpeg_command,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_path),
                "-vn",
                "-c:a",
                "libmp3lame",
                "-f",
                "mp3",
                str(output_path),
            ],
            "ffmpeg",
            self.settings.sample_processing_timeout_seconds,
        )
        if not output_path.exists():
            raise SpeechAudioProcessorError("FFmpeg did not produce combined speech audio.", 502)

    async def _prepare_gap_audio(self, segment_paths: tuple[Path, ...], output_path: Path) -> Path | None:
        gap_ms = self.settings.speech_job_segment_gap_ms
        if gap_ms <= 0 or len(segment_paths) < 2:
            return None

        gap_path = output_path.parent / f"{SPEECH_SEGMENT_GAP_PREFIX}-{gap_ms}ms.mp3"
        await _run_external_command(
            [
                self.settings.sample_processing_ffmpeg_command,
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=mono:sample_rate=44100",
                "-t",
                _format_gap_seconds(gap_ms),
                "-vn",
                "-c:a",
                "libmp3lame",
                "-f",
                "mp3",
                str(gap_path),
            ],
            "ffmpeg",
            self.settings.sample_processing_timeout_seconds,
        )
        if not gap_path.exists():
            raise SpeechAudioProcessorError("FFmpeg did not produce speech segment gap audio.", 502)
        return gap_path


async def _run_external_command(args: list[str], label: str, timeout_seconds: float) -> None:
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise SpeechAudioProcessorError(f"{label} command was not found.", 503) from exc

    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except asyncio.CancelledError:
        _kill_process(process)
        await process.communicate()
        raise
    except TimeoutError as exc:
        _kill_process(process)
        await process.communicate()
        raise SpeechAudioProcessorError(f"{label} timed out.", 504) from exc

    if process.returncode != 0:
        message = _clean_process_message(stderr.decode("utf-8", errors="replace"))
        detail = f"{label} failed with exit code {process.returncode}."
        if message:
            detail = f"{detail} {message}"
        raise SpeechAudioProcessorError(detail, 502)


def _kill_process(process: asyncio.subprocess.Process) -> None:
    try:
        process.kill()
    except ProcessLookupError:
        pass


def _clean_process_message(value: str) -> str:
    return " ".join(value.split())[-500:]


def _interleave_gap_audio(segment_paths: tuple[Path, ...], gap_path: Path | None) -> tuple[Path, ...]:
    if gap_path is None:
        return segment_paths

    concat_paths: list[Path] = []
    for index, segment_path in enumerate(segment_paths):
        if index > 0:
            concat_paths.append(gap_path)
        concat_paths.append(segment_path)
    return tuple(concat_paths)


def _format_gap_seconds(gap_ms: int) -> str:
    return f"{gap_ms / 1000:.3f}"


def _escape_ffconcat_path(path: Path) -> str:
    return str(path).replace("\\", "\\\\").replace("'", "\\'")
