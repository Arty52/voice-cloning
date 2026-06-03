from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
import re

from fastapi import HTTPException, UploadFile

from .config import Settings
from .models import VoiceSample

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
ALLOWED_AUDIO_CONTENT_TYPES = {
    "audio/aac",
    "audio/flac",
    "audio/m4a",
    "audio/mpeg",
    "audio/mp3",
    "audio/ogg",
    "audio/wav",
    "audio/wave",
    "audio/x-m4a",
    "audio/x-wav",
    "application/octet-stream",
}


def _sample_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sample_hash(content: bytes) -> str:
    return _sample_hash(content)


def slugify_voice_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "voice"


def _validate_audio_file(filename: str, content_type: str | None) -> None:
    suffix = Path(filename).suffix.lower()
    normalized_content_type = (content_type or "").lower()
    if suffix not in ALLOWED_AUDIO_EXTENSIONS and normalized_content_type not in ALLOWED_AUDIO_CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail="Voice sample must be an audio file: mp3, wav, m4a, aac, ogg, or flac.",
        )


def load_default_sample(settings: Settings) -> VoiceSample:
    sample_path = settings.default_sample_path
    if not sample_path.exists():
        raise HTTPException(status_code=500, detail="Default voice sample is missing.")

    content = sample_path.read_bytes()
    if not content:
        raise HTTPException(status_code=500, detail="Default voice sample is empty.")

    _validate_audio_file(sample_path.name, "audio/mpeg")
    return VoiceSample(
        content=content,
        filename=sample_path.name,
        content_type="audio/mpeg",
        sha256=_sample_hash(content),
    )


def load_sample_file(path: Path, content_type: str) -> VoiceSample:
    if not path.exists():
        raise HTTPException(status_code=404, detail="Voice sample is missing.")
    content = path.read_bytes()
    if not content:
        raise HTTPException(status_code=500, detail="Voice sample is empty.")
    _validate_audio_file(path.name, content_type)
    return VoiceSample(
        content=content,
        filename=path.name,
        content_type=content_type,
        sha256=_sample_hash(content),
    )


async def load_uploaded_sample(upload: UploadFile, settings: Settings, max_bytes: int | None = None) -> VoiceSample:
    filename = upload.filename or "uploaded-sample"
    content_type = upload.content_type or "application/octet-stream"
    _validate_audio_file(filename, content_type)

    resolved_max_bytes = settings.max_upload_bytes if max_bytes is None else max_bytes
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=422, detail="Uploaded voice sample is empty.")
    if len(content) > resolved_max_bytes:
        raise HTTPException(status_code=413, detail="Uploaded voice sample must be 10 MB or smaller.")

    return VoiceSample(
        content=content,
        filename=filename,
        content_type=content_type,
        sha256=_sample_hash(content),
    )


def save_sample_file(sample: VoiceSample, destination: Path) -> VoiceSample:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_suffix(f"{destination.suffix}.tmp")
    temp_path.write_bytes(sample.content)
    shutil.move(str(temp_path), str(destination))
    return VoiceSample(
        content=sample.content,
        filename=destination.name,
        content_type=sample.content_type,
        sha256=sample.sha256,
    )


async def save_uploaded_sample(upload: UploadFile, destination: Path, settings: Settings) -> VoiceSample:
    sample = await load_uploaded_sample(upload, settings)
    return save_sample_file(sample, destination)
