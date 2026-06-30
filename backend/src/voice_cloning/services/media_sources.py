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
from ..models import (
    SampleProcessingMediaKind,
    SampleProcessingMediaSource,
    SampleProcessingMediaSourceAudioStream,
    SampleProcessingMediaSourceChapter,
)
from ..samples import save_uploaded_media_source_stream
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
            stored = await save_uploaded_media_source_stream(
                upload,
                source_path,
                self.settings,
                max_bytes=self.settings.max_source_upload_bytes,
            )
            media_kind, audio_streams, duration_seconds, sample_rate_hz, chapters, warnings = await self._probe_source(stored.path)
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
                media_kind=media_kind,
                audio_streams=audio_streams,
                selected_audio_stream_index=audio_streams[0].index if audio_streams else None,
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
                    "-map",
                    "0:a:0",
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
    ) -> tuple[
        SampleProcessingMediaKind,
        tuple[SampleProcessingMediaSourceAudioStream, ...],
        float | None,
        int | None,
        tuple[SampleProcessingMediaSourceChapter, ...],
        tuple[str, ...],
    ]:
        try:
            stdout, _ = await run_capture_command(
                [
                    self.settings.sample_processing_ffprobe_command,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration:stream=index,codec_type,codec_name,sample_rate,channels,channel_layout:stream_tags=language,title:stream_disposition=attached_pic",
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
            return "audio", (), None, None, (), ("FFprobe metadata was unavailable for this media source.",)

        media_kind = _media_kind_from_payload(payload)
        audio_streams = _audio_streams_from_payload(payload)
        if media_kind == "video" and not audio_streams:
            raise MediaSourceServiceError("Video source must include at least one audio stream.", 422)
        duration_seconds = _positive_float_from_payload(payload.get("format", {}), "duration")
        sample_rate_hz = audio_streams[0].sample_rate_hz if audio_streams else None
        chapters = _chapters_from_payload(payload, duration_seconds)
        return media_kind, audio_streams, duration_seconds, sample_rate_hz, chapters, ()


def _source_filename(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    return f"source{suffix or '.wav'}"


def _source_from_payload(payload: object) -> SampleProcessingMediaSource:
    if not isinstance(payload, dict):
        raise MediaSourceServiceError("Sample processing media source metadata is invalid.", 500)
    try:
        chapters = tuple(_chapter_from_payload(item) for item in payload.get("chapters", []))
        warnings = tuple(str(item) for item in payload.get("warnings", []))
        audio_streams = tuple(_audio_stream_from_payload(item) for item in payload.get("audio_streams", []))
        selected_audio_stream_index = _optional_int(payload.get("selected_audio_stream_index"))
        if selected_audio_stream_index is None and audio_streams:
            selected_audio_stream_index = audio_streams[0].index
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
            media_kind=_media_kind_from_value(payload.get("media_kind")),
            audio_streams=audio_streams,
            selected_audio_stream_index=selected_audio_stream_index,
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


def _audio_stream_from_payload(payload: object) -> SampleProcessingMediaSourceAudioStream:
    if not isinstance(payload, dict):
        raise ValueError("audio stream payload must be an object")
    return SampleProcessingMediaSourceAudioStream(
        index=int(payload["index"]),
        codec_name=_optional_string(payload.get("codec_name")),
        sample_rate_hz=_optional_int(payload.get("sample_rate_hz")),
        channels=_optional_int(payload.get("channels")),
        channel_layout=_optional_string(payload.get("channel_layout")),
        language=_optional_string(payload.get("language")),
        title=_optional_string(payload.get("title")),
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


def _media_kind_from_payload(payload: object) -> SampleProcessingMediaKind:
    if not isinstance(payload, dict):
        return "audio"
    streams = payload.get("streams")
    if not isinstance(streams, list):
        return "audio"
    return "video" if any(_is_real_video_stream(stream) for stream in streams if isinstance(stream, dict)) else "audio"


def _media_kind_from_value(value: object) -> SampleProcessingMediaKind:
    return "video" if value == "video" else "audio"


def _is_real_video_stream(stream: dict[str, object]) -> bool:
    if stream.get("codec_type") != "video":
        return False
    disposition = stream.get("disposition")
    if not isinstance(disposition, dict):
        return True
    return disposition.get("attached_pic") not in (1, "1", True)


def _audio_streams_from_payload(payload: object) -> tuple[SampleProcessingMediaSourceAudioStream, ...]:
    if not isinstance(payload, dict):
        return ()
    streams = payload.get("streams")
    if not isinstance(streams, list):
        return ()
    audio_streams: list[SampleProcessingMediaSourceAudioStream] = []
    for position, stream in enumerate(streams):
        if not isinstance(stream, dict):
            continue
        codec_type = stream.get("codec_type")
        if codec_type not in (None, "audio"):
            continue
        stream_index = _optional_int(stream.get("index"))
        if stream_index is None:
            stream_index = position
        tags = stream.get("tags")
        audio_streams.append(
            SampleProcessingMediaSourceAudioStream(
                index=stream_index,
                codec_name=_optional_string(stream.get("codec_name")),
                sample_rate_hz=_sample_rate_from_stream(stream),
                channels=_optional_int(stream.get("channels")),
                channel_layout=_optional_string(stream.get("channel_layout")),
                language=_optional_string(tags.get("language")) if isinstance(tags, dict) else None,
                title=_optional_string(tags.get("title")) if isinstance(tags, dict) else None,
            )
        )
    return tuple(audio_streams)


def _sample_rate_from_stream(payload: dict[str, object]) -> int | None:
    sample_rate = _positive_float_from_payload(payload, "sample_rate")
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


def _optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


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
