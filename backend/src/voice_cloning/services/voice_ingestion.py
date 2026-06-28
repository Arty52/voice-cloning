from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
import shutil
from uuid import uuid4

from fastapi import UploadFile

from ..config import Settings
from ..models import VoiceAsset
from ..samples import load_sample_file, save_uploaded_sample_stream
from ..voice_library import VoiceLibrary


PROVIDER_SAMPLE_RATE_HZ = 16000
PROVIDER_SAMPLE_CONTENT_TYPE = "audio/wav"


class VoiceIngestionServiceError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass(frozen=True)
class ProviderSampleNormalizationResult:
    path: Path
    content_type: str = PROVIDER_SAMPLE_CONTENT_TYPE
    sample_rate_hz: int = PROVIDER_SAMPLE_RATE_HZ


class VoiceIngestionService:
    def __init__(self, settings: Settings, voice_library: VoiceLibrary) -> None:
        self.settings = settings
        self.voice_library = voice_library
        self.ingestion_dir = settings.storage_dir / "voice-ingestion"
        self.ingestion_dir.mkdir(parents=True, exist_ok=True)

    async def add_upload(
        self,
        *,
        name: str,
        sample_upload: UploadFile,
        sample_mode: str | None = None,
        source_upload: UploadFile | None = None,
        window_start_seconds: float | None = None,
        window_duration_seconds: float | None = None,
        voice_preset_id: str | None = None,
    ) -> VoiceAsset:
        job_dir = self.ingestion_dir / uuid4().hex
        job_dir.mkdir(parents=True, exist_ok=False)
        try:
            active_source_path = job_dir / _staging_filename("active-source", sample_upload.filename)
            active_source = await save_uploaded_sample_stream(
                sample_upload,
                active_source_path,
                self.settings,
                max_bytes=self.settings.max_upload_bytes,
            )
            normalized = await normalize_provider_sample(
                active_source.path,
                job_dir / "active-16khz.wav",
                self.settings,
            )
            active_sample = load_sample_file(normalized.path, normalized.content_type)

            source_file = None
            if source_upload is not None:
                source_path = job_dir / _staging_filename("retained-source", source_upload.filename)
                source_file = await save_uploaded_sample_stream(
                    source_upload,
                    source_path,
                    self.settings,
                    max_bytes=self.settings.max_source_upload_bytes,
                )

            return self.voice_library.add_prepared_upload(
                name,
                active_sample,
                sample_mode=sample_mode,
                source_file=source_file,
                window_start_seconds=window_start_seconds,
                window_duration_seconds=window_duration_seconds,
                voice_preset_id=voice_preset_id,
            )
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)


async def normalize_provider_sample(
    source_path: Path,
    output_path: Path,
    settings: Settings,
) -> ProviderSampleNormalizationResult:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    await _run_external_command(
        [
            settings.sample_processing_ffmpeg_command,
            "-y",
            "-i",
            str(source_path),
            "-ac",
            "1",
            "-ar",
            str(PROVIDER_SAMPLE_RATE_HZ),
            "-vn",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            str(output_path),
        ],
        "ffmpeg",
        settings.sample_processing_timeout_seconds,
    )
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise VoiceIngestionServiceError("FFmpeg did not produce a normalized voice sample.", 502)
    if output_path.stat().st_size > settings.max_upload_bytes:
        output_path.unlink(missing_ok=True)
        raise VoiceIngestionServiceError(
            f"Normalized voice sample must be {_bytes_label(settings.max_upload_bytes)} or smaller.",
            413,
        )
    return ProviderSampleNormalizationResult(path=output_path)


async def _run_external_command(args: list[str], label: str, timeout_seconds: float) -> None:
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise VoiceIngestionServiceError(f"{label} command was not found.", 503) from exc

    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except asyncio.CancelledError:
        _kill_process(process)
        await process.communicate()
        raise
    except TimeoutError as exc:
        _kill_process(process)
        await process.communicate()
        raise VoiceIngestionServiceError(f"{label} timed out.", 504) from exc

    if process.returncode != 0:
        message = _clean_process_message(stderr.decode("utf-8", errors="replace"))
        detail = f"{label} failed with exit code {process.returncode}."
        if message:
            detail = f"{detail} {message}"
        raise VoiceIngestionServiceError(detail, 502)


def _kill_process(process: asyncio.subprocess.Process) -> None:
    try:
        process.kill()
    except ProcessLookupError:
        pass


def _staging_filename(stem: str, filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    return f"{stem}{suffix or '.wav'}"


def _clean_process_message(value: str) -> str:
    message = " ".join(value.split())
    return message[-500:]


def _bytes_label(max_bytes: int) -> str:
    if max_bytes < 1024 * 1024:
        return f"{max_bytes} bytes"
    mebibytes = max_bytes / (1024 * 1024)
    if mebibytes.is_integer():
        return f"{int(mebibytes)} MB"
    return f"{mebibytes:.1f} MB"
