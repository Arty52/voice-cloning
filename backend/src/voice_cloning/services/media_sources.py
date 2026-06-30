from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import shutil
from uuid import uuid4

from fastapi import UploadFile

from ..config import Settings
from ..models import SampleProcessingMediaSource, SampleProcessingMediaSourceChapter
from ..samples import save_uploaded_sample_stream
from .media_commands import (
    non_negative_float as _non_negative_float,
    non_negative_float_from_payload as _non_negative_float_from_payload,
    positive_float as _positive_float,
    positive_float_from_payload as _positive_float_from_payload,
    run_capture_command,
    run_external_command,
    seconds_arg,
)


MEDIA_SOURCE_METADATA_FILENAME = "source.json"
MEDIA_SOURCE_PREVIEW_CONTENT_TYPE = "audio/mpeg"
MEDIA_SOURCE_PREVIEW_MAX_SECONDS = 90.0


class MediaSourceServiceError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class SampleProcessingMediaSourceService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.sources_dir = settings.sample_processing_dir / "sources"

    async def create_source(self, upload: UploadFile) -> SampleProcessingMediaSource:
        source_id = uuid4().hex
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        source_dir = self._source_dir(source_id)
        source_dir.mkdir(parents=True, exist_ok=False)
        try:
            source_path = source_dir / _source_filename(upload.filename)
            stored = await save_uploaded_sample_stream(
                upload,
                source_path,
                self.settings,
                max_bytes=self.settings.max_source_upload_bytes,
            )
            duration_seconds, sample_rate_hz, chapters, warnings = await self._probe_source(stored.path)
            source = SampleProcessingMediaSource(
                id=source_id,
                path=stored.path.name,
                filename=stored.filename,
                content_type=stored.content_type,
                size_bytes=stored.path.stat().st_size,
                sha256=stored.sha256,
                duration_seconds=duration_seconds,
                sample_rate_hz=sample_rate_hz,
                chapters=chapters,
                warnings=warnings,
            )
            self._write_source(source)
            return source
        except Exception:
            shutil.rmtree(source_dir, ignore_errors=True)
            raise

    def get_source(self, source_id: str) -> SampleProcessingMediaSource:
        source_dir = self._source_dir(source_id)
        metadata_path = source_dir / MEDIA_SOURCE_METADATA_FILENAME
        if not metadata_path.exists():
            raise MediaSourceServiceError("Sample processing media source was not found.", 404)
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise MediaSourceServiceError("Sample processing media source metadata is invalid.", 500) from exc
        return _source_from_payload(payload)

    def source_path(self, source_id: str) -> Path:
        source = self.get_source(source_id)
        source_path = (self._source_dir(source_id) / source.path).resolve()
        _require_relative_path(source_path, self._source_dir(source_id))
        if not source_path.exists():
            raise MediaSourceServiceError("Sample processing media source file is missing.", 404)
        return source_path

    async def preview_path(self, source_id: str, start_seconds: float, duration_seconds: float) -> Path:
        source_path = self.source_path(source_id)
        start = _validated_seconds(start_seconds, "startSeconds", allow_zero=True)
        duration = min(
            _validated_seconds(duration_seconds, "durationSeconds", allow_zero=False),
            MEDIA_SOURCE_PREVIEW_MAX_SECONDS,
        )
        source = self.get_source(source_id)
        if source.duration_seconds is not None and start >= source.duration_seconds:
            raise MediaSourceServiceError("Preview start must be within the media source duration.", 422)
        if source.duration_seconds is not None:
            duration = min(duration, max(0.01, source.duration_seconds - start))

        preview_path = self._preview_path(source_id, start, duration)
        if preview_path.exists() and preview_path.stat().st_size > 0:
            return preview_path

        preview_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_preview_path = preview_path.with_name(f"{preview_path.stem}.{uuid4().hex}.tmp")
        try:
            await run_external_command(
                [
                    self.settings.sample_processing_ffmpeg_command,
                    "-y",
                    "-ss",
                    seconds_arg(start),
                    "-t",
                    seconds_arg(duration),
                    "-i",
                    str(source_path),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "libmp3lame",
                    "-f",
                    "mp3",
                    str(temporary_preview_path),
                ],
                "ffmpeg",
                self.settings.sample_processing_timeout_seconds,
                MediaSourceServiceError,
            )
            if not temporary_preview_path.exists() or temporary_preview_path.stat().st_size == 0:
                raise MediaSourceServiceError("FFmpeg did not produce a media source preview.", 502)
            temporary_preview_path.replace(preview_path)
        except Exception:
            temporary_preview_path.unlink(missing_ok=True)
            raise
        return preview_path

    def delete_source(self, source_id: str) -> None:
        source_dir = self._source_dir(source_id)
        if not source_dir.exists():
            raise MediaSourceServiceError("Sample processing media source was not found.", 404)
        shutil.rmtree(source_dir, ignore_errors=True)

    def _source_dir(self, source_id: str) -> Path:
        if not _is_source_id(source_id):
            raise MediaSourceServiceError("Sample processing media source was not found.", 404)
        source_dir = (self.sources_dir / source_id).resolve()
        _require_relative_path(source_dir, self.sources_dir)
        return source_dir

    def _preview_path(self, source_id: str, start_seconds: float, duration_seconds: float) -> Path:
        cache_key = hashlib.sha256(f"{start_seconds:.3f}:{duration_seconds:.3f}".encode("utf-8")).hexdigest()[:16]
        return self._source_dir(source_id) / "previews" / f"{cache_key}.mp3"

    def _write_source(self, source: SampleProcessingMediaSource) -> None:
        metadata_path = self._source_dir(source.id) / MEDIA_SOURCE_METADATA_FILENAME
        payload = {
            **asdict(source),
            "chapters": [asdict(chapter) for chapter in source.chapters],
            "warnings": list(source.warnings),
        }
        metadata_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    async def _probe_source(
        self,
        path: Path,
    ) -> tuple[float | None, int | None, tuple[SampleProcessingMediaSourceChapter, ...], tuple[str, ...]]:
        try:
            stdout, _ = await run_capture_command(
                [
                    self.settings.sample_processing_ffprobe_command,
                    "-v",
                    "error",
                    "-select_streams",
                    "a:0",
                    "-show_entries",
                    "format=duration:stream=sample_rate",
                    "-show_chapters",
                    "-of",
                    "json",
                    str(path),
                ],
                "ffprobe",
                self.settings.sample_processing_timeout_seconds,
                MediaSourceServiceError,
            )
            payload = json.loads(stdout.decode("utf-8"))
        except (MediaSourceServiceError, json.JSONDecodeError):
            return None, None, (), ("FFprobe metadata was unavailable for this media source.",)

        duration_seconds = _positive_float_from_payload(payload.get("format", {}), "duration")
        sample_rate_hz = _sample_rate_from_payload(payload)
        chapters = _chapters_from_payload(payload, duration_seconds)
        return duration_seconds, sample_rate_hz, chapters, ()


def _source_filename(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    return f"source{suffix or '.wav'}"


def _source_from_payload(payload: object) -> SampleProcessingMediaSource:
    if not isinstance(payload, dict):
        raise MediaSourceServiceError("Sample processing media source metadata is invalid.", 500)
    try:
        chapters = tuple(_chapter_from_payload(item) for item in payload.get("chapters", []))
        warnings = tuple(str(item) for item in payload.get("warnings", []))
        return SampleProcessingMediaSource(
            id=str(payload["id"]),
            path=str(payload["path"]),
            filename=str(payload["filename"]),
            content_type=str(payload["content_type"]),
            size_bytes=int(payload["size_bytes"]),
            sha256=str(payload["sha256"]),
            duration_seconds=_optional_float(payload.get("duration_seconds")),
            sample_rate_hz=_optional_int(payload.get("sample_rate_hz")),
            chapters=chapters,
            warnings=warnings,
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise MediaSourceServiceError("Sample processing media source metadata is invalid.", 500) from exc


def _chapter_from_payload(payload: object) -> SampleProcessingMediaSourceChapter:
    if not isinstance(payload, dict):
        raise ValueError("chapter payload must be an object")
    return SampleProcessingMediaSourceChapter(
        id=str(payload["id"]),
        title=str(payload["title"]),
        start_seconds=float(payload["start_seconds"]),
        end_seconds=float(payload["end_seconds"]),
        duration_seconds=float(payload["duration_seconds"]),
    )


def _chapters_from_payload(payload: object, duration_seconds: float | None) -> tuple[SampleProcessingMediaSourceChapter, ...]:
    if not isinstance(payload, dict):
        return ()
    raw_chapters = payload.get("chapters")
    if not isinstance(raw_chapters, list):
        return ()
    chapters: list[SampleProcessingMediaSourceChapter] = []
    for index, raw_chapter in enumerate(raw_chapters, start=1):
        if not isinstance(raw_chapter, dict):
            continue
        start_seconds = _non_negative_float_from_payload(raw_chapter, "start_time")
        end_seconds = _non_negative_float_from_payload(raw_chapter, "end_time")
        if start_seconds is None or end_seconds is None:
            continue
        if duration_seconds is not None:
            end_seconds = min(end_seconds, duration_seconds)
        if end_seconds <= start_seconds:
            continue
        title = _chapter_title(raw_chapter, index)
        chapters.append(
            SampleProcessingMediaSourceChapter(
                id=f"chapter-{index}",
                title=title,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                duration_seconds=end_seconds - start_seconds,
            )
        )
    return tuple(chapters)


def _chapter_title(payload: dict[str, object], index: int) -> str:
    tags = payload.get("tags")
    if isinstance(tags, dict):
        title = tags.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
    return f"Chapter {index}"


def _sample_rate_from_payload(payload: object) -> int | None:
    if not isinstance(payload, dict):
        return None
    streams = payload.get("streams")
    if not isinstance(streams, list) or not streams:
        return None
    sample_rate = _positive_float_from_payload(streams[0], "sample_rate")
    return int(sample_rate) if sample_rate is not None else None


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    parsed = _positive_float(value)
    return parsed


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    return int(value)


def _validated_seconds(value: float, field_name: str, *, allow_zero: bool) -> float:
    if not math.isfinite(value):
        raise MediaSourceServiceError(f"{field_name} must be finite.", 422)
    if allow_zero:
        if value < 0:
            raise MediaSourceServiceError(f"{field_name} must be non-negative.", 422)
    elif value <= 0:
        raise MediaSourceServiceError(f"{field_name} must be greater than 0.", 422)
    return value


def _is_source_id(value: str) -> bool:
    return len(value) == 32 and all(character in "0123456789abcdef" for character in value)


def _require_relative_path(path: Path, root: Path) -> None:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise MediaSourceServiceError("Sample processing media source path is invalid.", 500) from exc
