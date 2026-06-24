from __future__ import annotations

import asyncio
from dataclasses import replace
import json
import os
from pathlib import Path

import pytest

from voice_cloning.config import Settings
from voice_cloning.services.speech_audio import SpeechAudioProcessor, SpeechAudioProcessorError


def make_settings(tmp_path: Path, *, ffmpeg_command: Path, timeout_seconds: float = 1) -> Settings:
    voice_assets_dir = tmp_path / "assets" / "voices"
    default_sample_path = voice_assets_dir / "default" / "default-voice.mp3"
    return Settings(
        app_root=tmp_path,
        elevenlabs_api_key="test-key",
        elevenlabs_api_base_url="https://api.elevenlabs.test/v1",
        elevenlabs_model_id="eleven_multilingual_v2",
        default_sample_path=default_sample_path,
        voice_assets_dir=voice_assets_dir,
        voice_manifest_path=voice_assets_dir / "voices.json",
        storage_dir=tmp_path / "storage",
        sample_processing_dir=tmp_path / "storage" / "sample-processing",
        speech_jobs_dir=tmp_path / "storage" / "speech-jobs",
        cors_allowed_origins=["http://localhost:4340"],
        sample_processing_ffmpeg_command=str(ffmpeg_command),
        sample_processing_timeout_seconds=timeout_seconds,
    )


def write_fake_ffmpeg(
    path: Path,
    *,
    output: bytes = b"combined-audio",
    args_log_path: Path | None = None,
    sleep_seconds: float = 0,
    exit_code: int = 0,
    stderr: str = "ffmpeg failed in test",
) -> Path:
    if exit_code:
        script = f"""
import sys
sys.stderr.write({stderr!r})
raise SystemExit({exit_code})
"""
    else:
        args_log_literal = "None" if args_log_path is None else repr(str(args_log_path))
        script = f"""
from pathlib import Path
import json
import time
import sys
args_log_path = {args_log_literal}
if args_log_path:
    log_path = Path(args_log_path)
    entries = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else []
    entries.append(sys.argv[1:])
    log_path.write_text(json.dumps(entries), encoding="utf-8")
time.sleep({sleep_seconds!r})
Path(sys.argv[-1]).write_bytes({output!r})
"""
    path.write_text("#!/usr/bin/env python3\n" + script.lstrip(), encoding="utf-8")
    os.chmod(path, 0o755)
    return path


def write_segments(tmp_path: Path) -> tuple[Path, ...]:
    one = tmp_path / "one.mp3"
    two = tmp_path / "two.mp3"
    one.write_bytes(b"one")
    two.write_bytes(b"two")
    return (one, two)


def test_speech_audio_processor_concatenates_segments(tmp_path: Path) -> None:
    output = tmp_path / "result.mp3"
    args_log_path = tmp_path / "ffmpeg-calls.json"
    processor = SpeechAudioProcessor(
        make_settings(
            tmp_path,
            ffmpeg_command=write_fake_ffmpeg(tmp_path / "ffmpeg", args_log_path=args_log_path),
        )
    )

    asyncio.run(processor.concatenate(write_segments(tmp_path), output))

    assert output.read_bytes() == b"combined-audio"
    concat_manifest = output.parent / "concat.txt"
    gap_path = output.parent / "segment-gap-250ms.mp3"
    assert gap_path.exists()
    assert concat_manifest.read_text(encoding="utf-8").splitlines() == [
        "ffconcat version 1.0",
        f"file '{tmp_path / 'one.mp3'}'",
        f"file '{gap_path}'",
        f"file '{tmp_path / 'two.mp3'}'",
    ]
    calls = json.loads(args_log_path.read_text(encoding="utf-8"))
    assert len(calls) == 2
    assert calls[0][calls[0].index("-t") + 1] == "0.250"


def test_speech_audio_processor_omits_gap_for_single_segment(tmp_path: Path) -> None:
    output = tmp_path / "result.mp3"
    args_log_path = tmp_path / "ffmpeg-calls.json"
    segment_path = tmp_path / "one.mp3"
    segment_path.write_bytes(b"one")
    processor = SpeechAudioProcessor(
        make_settings(
            tmp_path,
            ffmpeg_command=write_fake_ffmpeg(tmp_path / "ffmpeg", args_log_path=args_log_path),
        )
    )

    asyncio.run(processor.concatenate((segment_path,), output))

    assert not (output.parent / "segment-gap-250ms.mp3").exists()
    assert (output.parent / "concat.txt").read_text(encoding="utf-8").splitlines() == [
        "ffconcat version 1.0",
        f"file '{segment_path}'",
    ]
    assert len(json.loads(args_log_path.read_text(encoding="utf-8"))) == 1


def test_speech_audio_processor_allows_gapless_concat(tmp_path: Path) -> None:
    output = tmp_path / "result.mp3"
    args_log_path = tmp_path / "ffmpeg-calls.json"
    settings = replace(
        make_settings(
            tmp_path,
            ffmpeg_command=write_fake_ffmpeg(tmp_path / "ffmpeg", args_log_path=args_log_path),
        ),
        speech_job_segment_gap_ms=0,
    )
    processor = SpeechAudioProcessor(settings)

    asyncio.run(processor.concatenate(write_segments(tmp_path), output))

    assert not (output.parent / "segment-gap-0ms.mp3").exists()
    assert (output.parent / "concat.txt").read_text(encoding="utf-8").splitlines() == [
        "ffconcat version 1.0",
        f"file '{tmp_path / 'one.mp3'}'",
        f"file '{tmp_path / 'two.mp3'}'",
    ]
    assert len(json.loads(args_log_path.read_text(encoding="utf-8"))) == 1


def test_speech_audio_processor_reports_missing_command(tmp_path: Path) -> None:
    processor = SpeechAudioProcessor(make_settings(tmp_path, ffmpeg_command=tmp_path / "missing-ffmpeg"))

    with pytest.raises(SpeechAudioProcessorError, match="ffmpeg command was not found.") as exc_info:
        asyncio.run(processor.concatenate(write_segments(tmp_path), tmp_path / "result.mp3"))

    assert exc_info.value.status_code == 503


def test_speech_audio_processor_reports_nonzero_exit(tmp_path: Path) -> None:
    processor = SpeechAudioProcessor(
        make_settings(tmp_path, ffmpeg_command=write_fake_ffmpeg(tmp_path / "ffmpeg", exit_code=7))
    )

    with pytest.raises(SpeechAudioProcessorError, match="ffmpeg failed with exit code 7.") as exc_info:
        asyncio.run(processor.concatenate(write_segments(tmp_path), tmp_path / "result.mp3"))

    assert exc_info.value.status_code == 502
    assert "ffmpeg failed in test" in exc_info.value.detail


def test_speech_audio_processor_reports_timeout(tmp_path: Path) -> None:
    processor = SpeechAudioProcessor(
        make_settings(
            tmp_path,
            ffmpeg_command=write_fake_ffmpeg(tmp_path / "ffmpeg", sleep_seconds=1),
            timeout_seconds=0.05,
        )
    )

    with pytest.raises(SpeechAudioProcessorError, match="ffmpeg timed out.") as exc_info:
        asyncio.run(processor.concatenate(write_segments(tmp_path), tmp_path / "result.mp3"))

    assert exc_info.value.status_code == 504


def test_speech_audio_processor_kills_process_on_cancellation(tmp_path: Path) -> None:
    output = tmp_path / "result.mp3"
    processor = SpeechAudioProcessor(
        make_settings(tmp_path, ffmpeg_command=write_fake_ffmpeg(tmp_path / "ffmpeg", sleep_seconds=5))
    )

    async def run_and_cancel() -> None:
        task = asyncio.create_task(processor.concatenate(write_segments(tmp_path), output))
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run_and_cancel())

    assert not output.exists()
