from __future__ import annotations

import asyncio
from pathlib import Path

from .config import Settings
from .models import SampleProcessingOperation
from .services.sample_processing import (
    DEFAULT_ISOLATION_PROCESSING_PRESET_ID,
    DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID,
    ISOLATION_PROCESSING_PRESETS,
    SampleProcessingRequest,
    SampleProcessingServiceError,
    TRIM_SILENCE_PROCESSING_PRESETS,
    UnavailableSampleProcessor,
)


TRIM_SILENCE_FILTERS = {
    "trimLight": (
        "silenceremove="
        "start_periods=1:start_duration=0.2:start_threshold=-50dB:start_silence=0.15:"
        "stop_periods=-1:stop_duration=1.0:stop_threshold=-50dB:stop_silence=0.25:"
        "detection=peak"
    ),
    "trimBalanced": (
        "silenceremove="
        "start_periods=1:start_duration=0.15:start_threshold=-45dB:start_silence=0.1:"
        "stop_periods=-1:stop_duration=0.6:stop_threshold=-45dB:stop_silence=0.2:"
        "detection=peak"
    ),
    "trimAggressive": (
        "silenceremove="
        "start_periods=1:start_duration=0.1:start_threshold=-38dB:start_silence=0.05:"
        "stop_periods=-1:stop_duration=0.35:stop_threshold=-38dB:stop_silence=0.1:"
        "detection=peak"
    ),
}


class DemucsSampleProcessor:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()

    @property
    def engine_name(self) -> str:
        return "demucs"

    def engine_name_for_operation(self, operation_id: str) -> str:
        if operation_id == "trimSilence":
            return "ffmpeg"
        return self.engine_name

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
            _trim_silence_operation(),
        )

    async def process(self, request: SampleProcessingRequest) -> None:
        async with self._lock:
            if request.operation_id == "trimSilence":
                await _trim_silence(request, self.settings)
                return
            await self._process_isolation_locked(request)

    async def _process_isolation_locked(self, request: SampleProcessingRequest) -> None:
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
        _reject_oversized_output(request.output_path, self.settings.max_upload_bytes)


class FFmpegSampleProcessor:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()

    @property
    def engine_name(self) -> str:
        return "ffmpeg"

    def engine_name_for_operation(self, operation_id: str) -> str:
        return self.engine_name

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        return (_trim_silence_operation(),)

    async def process(self, request: SampleProcessingRequest) -> None:
        async with self._lock:
            await _trim_silence(request, self.settings)


def create_sample_processor(settings: Settings) -> DemucsSampleProcessor | FFmpegSampleProcessor | UnavailableSampleProcessor:
    if settings.sample_processing_engine == "demucs":
        return DemucsSampleProcessor(settings)
    if settings.sample_processing_engine == "ffmpeg":
        return FFmpegSampleProcessor(settings)
    return UnavailableSampleProcessor()


def _trim_silence_operation() -> SampleProcessingOperation:
    return SampleProcessingOperation(
        id="trimSilence",
        label="Trim Silence",
        description="Remove leading, trailing, and long interior empty sections with FFmpeg.",
        enabled=True,
        processing_presets=TRIM_SILENCE_PROCESSING_PRESETS,
        default_processing_preset_id=DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID,
    )


async def _trim_silence(request: SampleProcessingRequest, settings: Settings) -> None:
    preset_id = request.processing_preset_id or DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID
    ffmpeg_args = [
        settings.sample_processing_ffmpeg_command,
        "-y",
        "-i",
        str(request.source_path),
        "-af",
        _trim_silence_filter_for_preset(preset_id),
        "-ac",
        "1",
        "-ar",
        "32000",
        "-vn",
        "-f",
        "wav",
        str(request.output_path),
    ]
    await _run_external_command(
        ffmpeg_args,
        "ffmpeg",
        settings.sample_processing_timeout_seconds,
    )
    if not request.output_path.exists():
        raise SampleProcessingServiceError("FFmpeg did not produce a normalized sample.", 502)
    _reject_oversized_output(request.output_path, settings.max_upload_bytes)


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


def _trim_silence_filter_for_preset(preset_id: str) -> str:
    return TRIM_SILENCE_FILTERS.get(preset_id, TRIM_SILENCE_FILTERS[DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID])


def _reject_oversized_output(output_path: Path, max_upload_bytes: int) -> None:
    if output_path.stat().st_size > max_upload_bytes:
        output_path.unlink(missing_ok=True)
        raise SampleProcessingServiceError(
            f"Processed voice sample must be {_bytes_label(max_upload_bytes)} or smaller.",
            413,
        )


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
