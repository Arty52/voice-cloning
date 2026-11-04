from __future__ import annotations

import asyncio
import importlib.util
from dataclasses import dataclass, replace
import importlib
import os
from pathlib import Path
from typing import Any, Awaitable, TypeVar

from voice_transcription.contracts import InferenceError, Turn as _DiarizationTurn, Word as _TranscribedWord
from voice_transcription.legacy import FasterWhisperTranscriber, PyannoteDiarizer
from voice_transcription.normalize import transcribed_words

from .config import Settings
from .models import (
    SampleProcessingOperation,
    SampleProcessingResult,
    SpeakerSeparationResult,
    SpeakerSeparationSpeaker,
    SpeakerSeparationTranscript,
    SpeakerTranscriptItem,
    SpeakerTranscriptWord,
)
from .samples import load_sample_file
from .transcript_timing import has_valid_word_timing, is_valid_time_range
from .services.sample_processing import (
    DEFAULT_ISOLATION_PROCESSING_PRESET_ID,
    DEFAULT_TRIM_SILENCE_PROCESSING_PRESET_ID,
    ISOLATION_PROCESSING_PRESETS,
    RESULT_CONTENT_TYPE,
    SpeakerAssignmentRequest,
    SampleProcessingRequest,
    SampleProcessor,
    SampleProcessingServiceError,
    TRIM_SILENCE_PROCESSING_PRESETS,
    UnavailableSampleProcessor,
    apply_speaker_assignment_metadata,
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

_T = TypeVar("_T")


def _kill_process(process: asyncio.subprocess.Process) -> None:
    try:
        process.kill()
    except ProcessLookupError:
        pass


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
                "16000",
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
        _reject_oversized_output(request.output_path, _output_cap_for_request(request, self.settings))


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


class CompositeSampleProcessor:
    def __init__(self, processors: tuple[SampleProcessor, ...]) -> None:
        self.processors = processors

    @property
    def engine_name(self) -> str:
        return "+".join(processor.engine_name for processor in self.processors)

    def engine_name_for_operation(self, operation_id: str) -> str:
        return self._processor_for_operation(operation_id).engine_name_for_operation(operation_id)

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        operations_by_id: dict[str, SampleProcessingOperation] = {}
        for processor in self.processors:
            for operation in processor.operations():
                operations_by_id[operation.id] = operation
        return tuple(operations_by_id.values())

    async def process(self, request: SampleProcessingRequest) -> SampleProcessingResult | SpeakerSeparationResult | None:
        return await self._processor_for_operation(request.operation_id).process(request)

    async def update_speaker_assignments(self, request: SpeakerAssignmentRequest) -> SpeakerSeparationResult:
        for processor in self.processors:
            update_assignments = getattr(processor, "update_speaker_assignments", None)
            if update_assignments is not None:
                return await update_assignments(request)
        raise SampleProcessingServiceError("Speaker assignment updates are not available for this processor.", 503)

    def _processor_for_operation(self, operation_id: str) -> SampleProcessor:
        for processor in self.processors:
            for operation in processor.operations():
                if operation.id == operation_id and operation.enabled:
                    return processor
        raise SampleProcessingServiceError(f"Unsupported sample processing operation: {operation_id}.", 422)


class DiarizationSampleProcessor:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        os.environ.setdefault("PYANNOTE_METRICS_ENABLED", "0")
        self._lock = asyncio.Lock()
        self._diarizer: PyannoteDiarizer | None = None
        self._transcriber: FasterWhisperTranscriber | None = None

    @property
    def engine_name(self) -> str:
        return "pyannote-community-1+faster-whisper"

    def engine_name_for_operation(self, operation_id: str) -> str:
        return self.engine_name

    def operations(self) -> tuple[SampleProcessingOperation, ...]:
        return (
            SampleProcessingOperation(
                id="separateSpeakers",
                label="Separate Speakers",
                description="Identify speaker turns locally with pyannote.audio and transcribe them with faster-whisper.",
                enabled=True,
            ),
        )

    async def process(self, request: SampleProcessingRequest) -> SpeakerSeparationResult:
        async with self._lock:
            normalized_path = request.job_dir / "normalized-source.wav"
            await _normalize_audio(request.source_path, normalized_path, self.settings)
            turns = await _run_model_step_with_timeout(
                asyncio.to_thread(self._diarize, normalized_path),
                "Speaker diarization",
                self.settings.sample_processing_timeout_seconds,
            )
            words = await _run_model_step_with_timeout(
                asyncio.to_thread(self._transcribe, normalized_path),
                "Whisper transcription",
                self.settings.sample_processing_timeout_seconds,
            )
            result = _speaker_separation_result_from_words(turns, words)
            return await self._attach_speaker_streams(
                normalized_path,
                request.job_dir,
                result,
                speaker_ranges_by_id=_speaker_turn_ranges_by_id(turns),
                max_output_bytes=request.max_output_bytes,
            )

    async def update_speaker_assignments(self, request: SpeakerAssignmentRequest) -> SpeakerSeparationResult:
        async with self._lock:
            normalized_path = request.job_dir / "normalized-source.wav"
            if not normalized_path.exists():
                await _normalize_audio(request.source_path, normalized_path, self.settings)
            updated = apply_speaker_assignment_metadata(
                request.result,
                speaker_names=request.speaker_names,
                transcript_assignments=request.transcript_assignments,
            )
            return await self._attach_speaker_streams(
                normalized_path,
                request.job_dir,
                updated,
                max_output_bytes=self.settings.max_source_upload_bytes,
            )

    def _diarize(self, normalized_path: Path) -> tuple["_DiarizationTurn", ...]:
        if not self.settings.sample_processing_hf_token:
            raise SampleProcessingServiceError("Hugging Face token is required for speaker diarization.", 503)
        if self._diarizer is None:
            self._diarizer = PyannoteDiarizer(
                _load_diarization_dependencies().pipeline_class,
                self.settings.sample_processing_pyannote_model,
                self.settings.sample_processing_hf_token,
            )
        try:
            return self._diarizer.diarize(normalized_path).turns
        except InferenceError as exc:
            raise SampleProcessingServiceError(exc.detail, exc.status_code) from exc

    def _transcribe(self, normalized_path: Path) -> tuple["_TranscribedWord", ...]:
        if self._transcriber is None:
            self._transcriber = FasterWhisperTranscriber(
                _load_diarization_dependencies().whisper_model_class,
                self.settings.sample_processing_whisper_model,
                self.settings.sample_processing_whisper_device,
                self.settings.sample_processing_whisper_compute_type,
            )
        try:
            return self._transcriber.transcribe(normalized_path)
        except InferenceError as exc:
            raise SampleProcessingServiceError(exc.detail, exc.status_code) from exc

    async def _attach_speaker_streams(
        self,
        normalized_path: Path,
        job_dir: Path,
        result: SpeakerSeparationResult,
        *,
        speaker_ranges_by_id: dict[str, list[tuple[float, float]]] | None = None,
        max_output_bytes: int | None = None,
    ) -> SpeakerSeparationResult:
        speakers: list[SpeakerSeparationSpeaker] = []
        for speaker in result.speakers:
            ranges = (
                speaker_ranges_by_id.get(speaker.id, [])
                if speaker_ranges_by_id is not None
                else [
                    (item.start_seconds, item.end_seconds)
                    for item in result.transcript.items
                    if item.speaker_id == speaker.id
                ]
            )
            speaker_path = job_dir / f"{speaker.id}.wav"
            await _write_speaker_stream(
                normalized_path,
                ranges,
                speaker_path,
                job_dir,
                self.settings,
                max_output_bytes=max_output_bytes,
            )
            sample = load_sample_file(speaker_path, RESULT_CONTENT_TYPE)
            speakers.append(
                replace(
                    speaker,
                    result=SampleProcessingResult(
                        path=speaker_path.relative_to(job_dir.parent).as_posix(),
                        filename=speaker_path.name,
                        content_type=sample.content_type,
                        sha256=sample.sha256,
                    ),
                )
            )
        return replace(
            result,
            speakers=tuple(speakers),
        )


def create_sample_processor(
    settings: Settings,
) -> SampleProcessor:
    processors: list[SampleProcessor] = []
    if settings.sample_processing_engine == "demucs":
        processors.append(DemucsSampleProcessor(settings))
    elif settings.sample_processing_engine == "ffmpeg":
        processors.append(FFmpegSampleProcessor(settings))
    if settings.sample_processing_enable_diarization:
        processors.append(DiarizationSampleProcessor(settings))
    if settings.sample_processing_enable_diarization or settings.transcription_worker_url or importlib.util.find_spec('faster_whisper') is not None:
        from .transcription_processor import TranscriptionSampleProcessor
        processors.append(TranscriptionSampleProcessor(settings))
    if not processors:
        return UnavailableSampleProcessor()
    if len(processors) == 1:
        return processors[0]
    return CompositeSampleProcessor(tuple(processors))


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
        "16000",
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
    _reject_oversized_output(request.output_path, _output_cap_for_request(request, settings))


async def _normalize_audio(source_path: Path, output_path: Path, settings: Settings) -> None:
    ffmpeg_args = [
        settings.sample_processing_ffmpeg_command,
        "-y",
        "-i",
        str(source_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-vn",
        "-f",
        "wav",
        str(output_path),
    ]
    await _run_external_command(
        ffmpeg_args,
        "ffmpeg",
        settings.sample_processing_timeout_seconds,
    )
    if not output_path.exists():
        raise SampleProcessingServiceError("FFmpeg did not produce a normalized sample.", 502)


async def _run_model_step_with_timeout(awaitable: Awaitable[_T], label: str, timeout_seconds: float) -> _T:
    try:
        return await asyncio.wait_for(awaitable, timeout=timeout_seconds)
    except TimeoutError as exc:
        raise SampleProcessingServiceError(f"{label} timed out.", 504) from exc


async def _write_speaker_stream(
    normalized_path: Path,
    ranges: list[tuple[float, float]],
    output_path: Path,
    job_dir: Path,
    settings: Settings,
    *,
    max_output_bytes: int | None = None,
) -> None:
    chunks_dir = job_dir / "speaker-chunks" / output_path.stem
    chunks_dir.mkdir(parents=True, exist_ok=True)
    if not ranges:
        await _write_silence(output_path, settings)
        _reject_oversized_output(output_path, _resolved_output_cap(max_output_bytes, settings))
        return

    chunk_paths: list[Path] = []
    for index, (start_seconds, end_seconds) in enumerate(ranges):
        duration = max(0.01, end_seconds - start_seconds)
        chunk_path = chunks_dir / f"{index:04d}.wav"
        await _run_external_command(
            [
                settings.sample_processing_ffmpeg_command,
                "-y",
                "-ss",
                _seconds_arg(start_seconds),
                "-t",
                _seconds_arg(duration),
                "-i",
                str(normalized_path),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-vn",
                "-f",
                "wav",
                str(chunk_path),
            ],
            "ffmpeg",
            settings.sample_processing_timeout_seconds,
        )
        if not chunk_path.exists():
            raise SampleProcessingServiceError("FFmpeg did not produce a speaker segment.", 502)
        chunk_paths.append(chunk_path)

    concat_path = chunks_dir / "concat.txt"
    concat_path.write_text(
        "\n".join(["ffconcat version 1.0", *(f"file '{_escape_ffconcat_path(path)}'" for path in chunk_paths)]),
        encoding="utf-8",
    )
    await _run_external_command(
        [
            settings.sample_processing_ffmpeg_command,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-vn",
            "-f",
            "wav",
            str(output_path),
        ],
        "ffmpeg",
        settings.sample_processing_timeout_seconds,
    )
    if not output_path.exists():
        raise SampleProcessingServiceError("FFmpeg did not produce a speaker stream.", 502)
    _reject_oversized_output(output_path, _resolved_output_cap(max_output_bytes, settings))


async def _write_silence(output_path: Path, settings: Settings) -> None:
    await _run_external_command(
        [
            settings.sample_processing_ffmpeg_command,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=mono:sample_rate=16000",
            "-t",
            "0.1",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-vn",
            "-f",
            "wav",
            str(output_path),
        ],
        "ffmpeg",
        settings.sample_processing_timeout_seconds,
    )
    if not output_path.exists():
        raise SampleProcessingServiceError("FFmpeg did not produce a speaker stream.", 502)


@dataclass(frozen=True)
class _DiarizationDependencies:
    pipeline_class: Any
    whisper_model_class: Any


def _load_diarization_dependencies() -> _DiarizationDependencies:
    try:
        pyannote_audio = importlib.import_module("pyannote.audio")
        faster_whisper = importlib.import_module("faster_whisper")
    except ImportError as exc:
        raise SampleProcessingServiceError(
            "Speaker diarization dependencies are not installed. Install backend[diarization].",
            503,
        ) from exc
    return _DiarizationDependencies(
        pipeline_class=_required_diarization_symbol(pyannote_audio, "Pipeline"),
        whisper_model_class=_required_diarization_symbol(faster_whisper, "WhisperModel"),
    )


def _required_diarization_symbol(module: Any, name: str) -> Any:
    try:
        return getattr(module, name)
    except AttributeError as exc:
        raise SampleProcessingServiceError(
            "Speaker diarization dependencies are not installed. Install backend[diarization].",
            503,
        ) from exc


def _transcribed_words(segments: object) -> tuple[_TranscribedWord, ...]:
    try:
        return transcribed_words(segments)
    except InferenceError as exc:
        raise SampleProcessingServiceError(exc.detail, exc.status_code) from exc


def _speaker_separation_result_from_words(
    turns: tuple[_DiarizationTurn, ...],
    words: tuple[_TranscribedWord, ...],
    *,
    attribution_turns: tuple[_DiarizationTurn, ...] | None = None,
) -> SpeakerSeparationResult:
    speaker_ids = _speaker_ids_by_diarization_label(turns)
    speaker_labels = {
        speaker_id: f"Speaker {index + 1}"
        for index, speaker_id in enumerate(speaker_ids.values())
    }

    def resolve_speaker(original_label: str) -> str:
        return speaker_ids[original_label]

    items = _transcript_items_from_words(words, attribution_turns or turns, resolve_speaker)
    if not items:
        items = _fallback_transcript_items_from_turns(turns, resolve_speaker)

    item_ids_by_speaker_id: dict[str, list[str]] = {speaker_id: [] for speaker_id in speaker_labels}
    for item in items:
        item_ids_by_speaker_id[item.speaker_id].append(item.id)

    speakers = tuple(
        SpeakerSeparationSpeaker(
            id=speaker_id,
            label=speaker_labels[speaker_id],
            transcript_item_ids=tuple(item_ids_by_speaker_id[speaker_id]),
        )
        for speaker_id in speaker_labels
    )
    return SpeakerSeparationResult(
        kind="speakerSeparation",
        speakers=speakers,
        transcript=SpeakerSeparationTranscript(items=tuple(items)),
    )


def _speaker_ids_by_diarization_label(turns: tuple[_DiarizationTurn, ...]) -> dict[str, str]:
    speaker_ids: dict[str, str] = {}
    for turn in turns:
        if turn.speaker_label not in speaker_ids:
            speaker_ids[turn.speaker_label] = f"speaker-{len(speaker_ids) + 1}"
    return speaker_ids


def _speaker_turn_ranges_by_id(turns: tuple[_DiarizationTurn, ...]) -> dict[str, list[tuple[float, float]]]:
    speaker_ids = _speaker_ids_by_diarization_label(turns)
    ranges: dict[str, list[tuple[float, float]]] = {speaker_id: [] for speaker_id in speaker_ids.values()}
    for turn in turns:
        ranges[speaker_ids[turn.speaker_label]].append((turn.start_seconds, turn.end_seconds))
    return ranges


def _transcript_items_from_words(
    words: tuple[_TranscribedWord, ...],
    turns: tuple[_DiarizationTurn, ...],
    resolve_speaker: Any,
) -> list[SpeakerTranscriptItem]:
    items: list[SpeakerTranscriptItem] = []
    current_words: list[_TranscribedWord] = []
    current_speaker_id: str | None = None

    def flush() -> None:
        nonlocal current_words, current_speaker_id
        if not current_words or current_speaker_id is None:
            return
        item_id = f"item-{len(items) + 1}"
        start_seconds = min(word.start_seconds for word in current_words)
        end_seconds = max(word.end_seconds for word in current_words)
        if not is_valid_time_range(start_seconds, end_seconds):
            raise SampleProcessingServiceError(
                "Whisper transcription has no usable timing for a passage.", 502,
            )
        has_word_alignment = all(word.has_word_alignment for word in current_words) and has_valid_word_timing(
            start_seconds,
            end_seconds,
            ((word.start_seconds, word.end_seconds) for word in current_words),
        )
        items.append(
            SpeakerTranscriptItem(
                id=item_id,
                text=_join_words(current_words),
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                speaker_id=current_speaker_id,
                words=(
                    tuple(
                        SpeakerTranscriptWord(
                            id=f"{item_id}-word-{index + 1}",
                            text=word.text,
                            start_seconds=word.start_seconds,
                            end_seconds=word.end_seconds,
                        )
                        for index, word in enumerate(current_words)
                    )
                    if has_word_alignment
                    else None
                ),
            )
        )
        current_words = []
        current_speaker_id = None

    for word in words:
        speaker_label = _speaker_label_for_range(word.start_seconds, word.end_seconds, turns)
        speaker_id = resolve_speaker(speaker_label)
        gap_seconds = word.start_seconds - current_words[-1].end_seconds if current_words else 0
        # Keep a segment-level fallback from disabling its neighbors' word timing.
        fallback_boundary = bool(current_words) and (
            not word.has_word_alignment or not current_words[-1].has_word_alignment
        )
        if current_speaker_id != speaker_id or gap_seconds > 0.8 or fallback_boundary:
            flush()
            current_speaker_id = speaker_id
        current_words.append(word)
    flush()
    return items


def _fallback_transcript_items_from_turns(
    turns: tuple[_DiarizationTurn, ...],
    resolve_speaker: Any,
) -> list[SpeakerTranscriptItem]:
    items: list[SpeakerTranscriptItem] = []
    for turn in turns:
        speaker_id = resolve_speaker(turn.speaker_label)
        items.append(
            SpeakerTranscriptItem(
                id=f"item-{len(items) + 1}",
                text="Speech segment",
                start_seconds=turn.start_seconds,
                end_seconds=turn.end_seconds,
                speaker_id=speaker_id,
            )
        )
    return items


def _speaker_label_for_range(
    start_seconds: float,
    end_seconds: float,
    turns: tuple[_DiarizationTurn, ...],
) -> str:
    best_turn = max(
        turns,
        key=lambda turn: _overlap_seconds(start_seconds, end_seconds, turn.start_seconds, turn.end_seconds),
    )
    best_overlap = _overlap_seconds(start_seconds, end_seconds, best_turn.start_seconds, best_turn.end_seconds)
    if best_overlap > 0:
        return best_turn.speaker_label

    midpoint = (start_seconds + end_seconds) / 2
    for turn in turns:
        if turn.start_seconds <= midpoint <= turn.end_seconds:
            return turn.speaker_label
    nearest_turn = min(
        turns,
        key=lambda turn: abs(midpoint - ((turn.start_seconds + turn.end_seconds) / 2)),
    )
    return nearest_turn.speaker_label


def _overlap_seconds(first_start: float, first_end: float, second_start: float, second_end: float) -> float:
    return max(0.0, min(first_end, second_end) - max(first_start, second_start))


def _join_words(words: list[_TranscribedWord]) -> str:
    return _join_word_texts([word.text for word in words])


def _join_word_texts(words: list[str]) -> str:
    text = " ".join(word.strip() for word in words if word.strip())
    for punctuation in (".", ",", "?", "!", ";", ":"):
        text = text.replace(f" {punctuation}", punctuation)
    return text


def _seconds_arg(value: float) -> str:
    return f"{max(0.0, value):.3f}"


def _escape_ffconcat_path(path: Path) -> str:
    return str(path).replace("\\", "\\\\").replace("'", "\\'")


def _optional_float(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


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


def _output_cap_for_request(request: SampleProcessingRequest, settings: Settings) -> int:
    return _resolved_output_cap(request.max_output_bytes, settings)


def _resolved_output_cap(max_output_bytes: int | None, settings: Settings) -> int:
    return settings.max_upload_bytes if max_output_bytes is None else max_output_bytes


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
    except asyncio.CancelledError:
        _kill_process(process)
        await process.communicate()
        raise
    except TimeoutError as exc:
        _kill_process(process)
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
