from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
import shutil
from typing import Callable

from fastapi import HTTPException, UploadFile

from .config import Settings
from .models import VoiceSample

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".m4b", ".aac", ".ogg", ".flac"}
ALLOWED_AUDIO_CONTENT_TYPES = {
    "audio/aac",
    "audio/flac",
    "audio/m4a",
    "audio/m4b",
    "audio/mpeg",
    "audio/mp4",
    "audio/mp4a-latm",
    "audio/mp3",
    "audio/ogg",
    "audio/wav",
    "audio/wave",
    "audio/x-m4a",
    "audio/x-m4b",
    "audio/x-wav",
}
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov"}
ALLOWED_VIDEO_CONTENT_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
}
ALLOWED_MEDIA_SOURCE_EXTENSIONS = ALLOWED_AUDIO_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS
ALLOWED_MEDIA_SOURCE_CONTENT_TYPES = ALLOWED_AUDIO_CONTENT_TYPES | ALLOWED_VIDEO_CONTENT_TYPES
GENERIC_UPLOAD_CONTENT_TYPE = "application/octet-stream"
MEDIA_SOURCE_CONTENT_TYPES_BY_EXTENSION = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".m4b": "audio/mp4",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
}
UPLOAD_CHUNK_SIZE_BYTES = 1024 * 1024


@dataclass(frozen=True)
class StoredSampleFile:
    path: Path
    filename: str
    content_type: str
    sha256: str


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
    if not _has_allowed_upload_type(suffix, normalized_content_type, ALLOWED_AUDIO_EXTENSIONS, ALLOWED_AUDIO_CONTENT_TYPES):
        raise HTTPException(
            status_code=422,
            detail="Voice sample must be an audio file: mp3, wav, m4a, m4b, aac, ogg, or flac.",
        )


def _validate_media_source_file(filename: str, content_type: str | None) -> None:
    suffix = Path(filename).suffix.lower()
    normalized_content_type = (content_type or "").lower()
    if not _has_allowed_upload_type(
        suffix,
        normalized_content_type,
        ALLOWED_MEDIA_SOURCE_EXTENSIONS,
        ALLOWED_MEDIA_SOURCE_CONTENT_TYPES,
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Source media must be an audio or video file: mp3, wav, m4a, m4b, aac, ogg, flac, "
                "mp4, m4v, or mov."
            ),
        )


def _has_allowed_upload_type(
    suffix: str,
    content_type: str,
    allowed_extensions: set[str],
    allowed_content_types: set[str],
) -> bool:
    if suffix in allowed_extensions:
        return True
    if content_type == GENERIC_UPLOAD_CONTENT_TYPE:
        return False
    return content_type in allowed_content_types


def media_source_response_content_type(filename: str, content_type: str | None) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in MEDIA_SOURCE_CONTENT_TYPES_BY_EXTENSION:
        return MEDIA_SOURCE_CONTENT_TYPES_BY_EXTENSION[suffix]
    normalized_content_type = (content_type or "").lower()
    if normalized_content_type in ALLOWED_MEDIA_SOURCE_CONTENT_TYPES:
        return normalized_content_type
    return GENERIC_UPLOAD_CONTENT_TYPE


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
    content_type = upload.content_type or GENERIC_UPLOAD_CONTENT_TYPE
    _validate_audio_file(filename, content_type)

    resolved_max_bytes = settings.max_upload_bytes if max_bytes is None else max_bytes
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=422, detail="Uploaded voice sample is empty.")
    if len(content) > resolved_max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded voice sample must be {_upload_limit_label(resolved_max_bytes)} or smaller.",
        )

    return VoiceSample(
        content=content,
        filename=filename,
        content_type=content_type,
        sha256=_sample_hash(content),
    )


async def save_uploaded_sample_stream(
    upload: UploadFile,
    destination: Path,
    settings: Settings,
    max_bytes: int | None = None,
) -> StoredSampleFile:
    return await _save_uploaded_stream(
        upload,
        destination,
        settings,
        max_bytes=max_bytes,
        validate_file=_validate_audio_file,
        empty_detail="Uploaded voice sample is empty.",
        limit_detail_prefix="Uploaded voice sample",
    )


async def save_uploaded_media_source_stream(
    upload: UploadFile,
    destination: Path,
    settings: Settings,
    max_bytes: int | None = None,
) -> StoredSampleFile:
    return await _save_uploaded_stream(
        upload,
        destination,
        settings,
        max_bytes=max_bytes,
        validate_file=_validate_media_source_file,
        empty_detail="Uploaded source media is empty.",
        limit_detail_prefix="Uploaded source media",
    )


async def _save_uploaded_stream(
    upload: UploadFile,
    destination: Path,
    settings: Settings,
    *,
    max_bytes: int | None,
    validate_file: Callable[[str, str | None], None],
    empty_detail: str,
    limit_detail_prefix: str,
) -> StoredSampleFile:
    filename = upload.filename or "uploaded-sample"
    content_type = upload.content_type or GENERIC_UPLOAD_CONTENT_TYPE
    validate_file(filename, content_type)

    resolved_max_bytes = settings.max_upload_bytes if max_bytes is None else max_bytes
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_suffix(f"{destination.suffix}.tmp")
    digest = hashlib.sha256()
    total_bytes = 0
    try:
        with temp_path.open("wb") as output:
            while True:
                chunk = await upload.read(UPLOAD_CHUNK_SIZE_BYTES)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > resolved_max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"{limit_detail_prefix} must be {_upload_limit_label(resolved_max_bytes)} or smaller.",
                    )
                digest.update(chunk)
                output.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=422, detail=empty_detail)
        shutil.move(str(temp_path), str(destination))
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    return StoredSampleFile(
        path=destination,
        filename=filename,
        content_type=content_type,
        sha256=digest.hexdigest(),
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


def _upload_limit_label(max_bytes: int) -> str:
    if max_bytes < 1024 * 1024:
        return f"{max_bytes} bytes"
    mebibytes = max_bytes / (1024 * 1024)
    if mebibytes.is_integer():
        return f"{int(mebibytes)} MB"
    return f"{mebibytes:.1f} MB"
