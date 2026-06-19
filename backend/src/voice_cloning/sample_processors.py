from __future__ import annotations

import asyncio
from pathlib import Path

from .config import Settings
from .models import SampleProcessingOperation
from .services.sample_processing import (
    DEFAULT_ISOLATION_PROCESSING_PRESET_ID,
    ISOLATION_PROCESSING_PRESETS,
    SampleProcessingRequest,
    SampleProcessingServiceError,
    UnavailableSampleProcessor,
)


class DemucsSampleProcessor:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()

    @property
    def engine_name(self) -> str:
        return "demucs"

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        return (
            SampleProcessingOperation(
                id="isolateVoice",
                label="Isolate Voice",
                description="Separate the vocal stem from music or background audio with Demucs.",
                enabled=True,
                processing_presets=ISOLATION_PROCESSING_PRESETS,
                default_processing_preset_id=DEFAULT_ISOLATION_PROCESSING_PRESET_ID,
            ),
        )

    async def process(self, request: SampleProcessingRequest) -> None:
        async with self._lock:
            await self._process_locked(request)

    async def _process_locked(self, request: SampleProcessingRequest) -> None:
        output_root = request.job_dir / "demucs-output"
        preset_id = request.processing_preset_id or DEFAULT_ISOLATION_PROCESSING_PRESET_ID
        model_name = _demucs_model_name(preset_id, self.settings.sample_processing_demucs_model)
        demucs_args = [
            self.settings.sample_processing_demucs_command,
            "--two-stems=vocals",
            "-n",
            model_name,
            "-o",
            str(output_root),
        ]
        demucs_args.extend(_demucs_preset_args(preset_id))
        if self.settings.sample_processing_demucs_device:
            demucs_args.extend(["-d", self.settings.sample_processing_demucs_device])
        demucs_args.append(str(request.source_path))

        await _run_external_command(
            demucs_args,
            "demucs",
            self.settings.sample_processing_timeout_seconds,
        )

        vocals_path = (
            output_root
            / model_name
            / request.source_path.stem
            / "vocals.wav"
        )
        if not vocals_path.exists():
            raise SampleProcessingServiceError("Demucs did not produce a vocals stem.", 502)

        ffmpeg_args = [
            self.settings.sample_processing_ffmpeg_command,
            "-y",
            "-i",
            str(vocals_path),
        ]
        ffmpeg_filter = _ffmpeg_filter_for_preset(preset_id)
        if ffmpeg_filter:
            ffmpeg_args.extend(["-af", ffmpeg_filter])
        ffmpeg_args.extend(
            [
                "-ac",
                "1",
                "-ar",
                "32000",
                "-vn",
                "-f",
                "wav",
                str(request.output_path),
            ]
        )
        await _run_external_command(
            ffmpeg_args,
            "ffmpeg",
            self.settings.sample_processing_timeout_seconds,
        )

        if not request.output_path.exists():
            raise SampleProcessingServiceError("FFmpeg did not produce a normalized sample.", 502)
        if request.output_path.stat().st_size > self.settings.max_upload_bytes:
            request.output_path.unlink(missing_ok=True)
            raise SampleProcessingServiceError(
                f"Processed voice sample must be {_bytes_label(self.settings.max_upload_bytes)} or smaller.",
                413,
            )


def create_sample_processor(settings: Settings) -> DemucsSampleProcessor | UnavailableSampleProcessor:
    if settings.sample_processing_engine == "demucs":
        return DemucsSampleProcessor(settings)
    return UnavailableSampleProcessor()


def _demucs_model_name(preset_id: str, configured_model_name: str) -> str:
    if preset_id == "maxIsolation":
        return "htdemucs_ft"
    return configured_model_name


def _demucs_preset_args(preset_id: str) -> list[str]:
    if preset_id == "fast":
        return ["--shifts", "1"]
    if preset_id == "maxIsolation":
        return ["--shifts", "8", "--overlap", "0.5"]
    return []


def _ffmpeg_filter_for_preset(preset_id: str) -> str | None:
    if preset_id == "clean":
        return "highpass=f=70,lowpass=f=12000"
    return None


async def _run_external_command(args: list[str], label: str, timeout_seconds: float) -> None:
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise SampleProcessingServiceError(f"{label} command was not found.", 503) from exc

    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise SampleProcessingServiceError(f"{label} timed out.", 504) from exc

    if process.returncode != 0:
        message = _clean_process_message(stderr.decode("utf-8", errors="replace"))
        detail = f"{label} failed with exit code {process.returncode}."
        if message:
            detail = f"{detail} {message}"
        raise SampleProcessingServiceError(detail, 502)


def _clean_process_message(value: str) -> str:
    message = " ".join(value.split())
    return message[-500:]


def _bytes_label(max_bytes: int) -> str:
    mebibytes = max_bytes / (1024 * 1024)
    if mebibytes.is_integer():
        return f"{int(mebibytes)} MB"
    if max_bytes < 1024:
        return f"{max_bytes} bytes"
    return f"{mebibytes:.1f} MB"
