from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


def _default_root_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized_value = raw_value.strip()
    if not normalized_value:
        return default
    return float(normalized_value)


def _non_negative_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized_value = raw_value.strip()
    if not normalized_value:
        return default
    try:
        value = int(normalized_value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a non-negative integer.") from exc
    if value < 0:
        raise ValueError(f"{name} must be non-negative.")
    return value


def _positive_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized_value = raw_value.strip()
    if not normalized_value:
        return default
    try:
        value = int(normalized_value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive integer.") from exc
    if value <= 0:
        raise ValueError(f"{name} must be positive.")
    return value


def _bool_env(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    normalized_value = raw_value.strip().lower()
    if not normalized_value:
        return default
    return normalized_value in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_root: Path
    elevenlabs_api_key: str
    elevenlabs_api_base_url: str
    elevenlabs_model_id: str
    default_sample_path: Path
    voice_assets_dir: Path
    voice_manifest_path: Path
    storage_dir: Path
    sample_processing_dir: Path
    speech_jobs_dir: Path
    cors_allowed_origins: list[str]
    speech_job_segment_gap_ms: int = 250
    max_upload_bytes: int = 10 * 1024 * 1024
    max_source_upload_bytes: int = 1024 * 1024 * 1024
    max_text_chars: int = 5000
    sample_processing_engine: str = ""
    sample_processing_demucs_command: str = "demucs"
    sample_processing_ffmpeg_command: str = "ffmpeg"
    sample_processing_demucs_model: str = "htdemucs"
    sample_processing_demucs_device: str = ""
    sample_processing_timeout_seconds: float = 900
    sample_processing_enable_diarization: bool = False
    sample_processing_pyannote_model: str = "pyannote/speaker-diarization-community-1"
    sample_processing_hf_token: str = ""
    sample_processing_whisper_model: str = "medium"
    sample_processing_whisper_device: str = "cpu"
    sample_processing_whisper_compute_type: str = "int8"

    @classmethod
    def from_env(cls) -> "Settings":
        app_root = Path(os.getenv("APP_ROOT", _default_root_dir())).resolve()
        load_dotenv(app_root / ".env")

        voice_assets_dir = Path(os.getenv("VOICE_ASSETS_DIR", app_root / "assets" / "voices"))
        default_sample = Path(
            os.getenv("DEFAULT_SAMPLE_PATH", voice_assets_dir / "default" / "default-voice.mp3")
        )
        voice_manifest = Path(os.getenv("VOICE_MANIFEST_PATH", voice_assets_dir / "voices.json"))
        storage_dir = Path(os.getenv("STORAGE_DIR", app_root / "storage"))
        sample_processing_dir = Path(
            os.getenv("SAMPLE_PROCESSING_DIR", storage_dir / "sample-processing")
        )
        speech_jobs_dir = Path(os.getenv("SPEECH_JOBS_DIR", storage_dir / "speech-jobs"))
        origins = os.getenv(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:4340,http://127.0.0.1:4340",
        )

        return cls(
            app_root=app_root,
            elevenlabs_api_key=os.getenv("ELEVENLABS_API_KEY", "").strip(),
            elevenlabs_api_base_url=os.getenv(
                "ELEVENLABS_API_BASE_URL", "https://api.elevenlabs.io/v1"
            ).rstrip("/"),
            elevenlabs_model_id=os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2"),
            default_sample_path=default_sample.resolve(),
            voice_assets_dir=voice_assets_dir.resolve(),
            voice_manifest_path=voice_manifest.resolve(),
            storage_dir=storage_dir.resolve(),
            sample_processing_dir=sample_processing_dir.resolve(),
            speech_jobs_dir=speech_jobs_dir.resolve(),
            cors_allowed_origins=_split_csv(origins),
            speech_job_segment_gap_ms=_non_negative_int_env("SPEECH_JOB_SEGMENT_GAP_MS", 250),
            max_upload_bytes=_positive_int_env("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
            max_source_upload_bytes=_positive_int_env("MAX_SOURCE_UPLOAD_BYTES", 1024 * 1024 * 1024),
            sample_processing_engine=os.getenv("SAMPLE_PROCESSING_ENGINE", "").strip().lower(),
            sample_processing_demucs_command=os.getenv("SAMPLE_PROCESSING_DEMUCS_COMMAND", "demucs").strip()
            or "demucs",
            sample_processing_ffmpeg_command=os.getenv("SAMPLE_PROCESSING_FFMPEG_COMMAND", "ffmpeg").strip()
            or "ffmpeg",
            sample_processing_demucs_model=os.getenv("SAMPLE_PROCESSING_DEMUCS_MODEL", "htdemucs").strip()
            or "htdemucs",
            sample_processing_demucs_device=os.getenv("SAMPLE_PROCESSING_DEMUCS_DEVICE", "").strip(),
            sample_processing_timeout_seconds=_float_env("SAMPLE_PROCESSING_TIMEOUT_SECONDS", 900),
            sample_processing_enable_diarization=_bool_env("SAMPLE_PROCESSING_ENABLE_DIARIZATION"),
            sample_processing_pyannote_model=(
                os.getenv("SAMPLE_PROCESSING_PYANNOTE_MODEL", "pyannote/speaker-diarization-community-1").strip()
                or "pyannote/speaker-diarization-community-1"
            ),
            sample_processing_hf_token=(
                os.getenv("SAMPLE_PROCESSING_HF_TOKEN", "").strip()
                or os.getenv("HF_TOKEN", "").strip()
            ),
            sample_processing_whisper_model=os.getenv("SAMPLE_PROCESSING_WHISPER_MODEL", "medium").strip()
            or "medium",
            sample_processing_whisper_device=os.getenv("SAMPLE_PROCESSING_WHISPER_DEVICE", "cpu").strip()
            or "cpu",
            sample_processing_whisper_compute_type=os.getenv("SAMPLE_PROCESSING_WHISPER_COMPUTE_TYPE", "int8").strip()
            or "int8",
        )

    def require_api_key(self) -> None:
        if not self.elevenlabs_api_key:
            raise RuntimeError("ELEVENLABS_API_KEY is not configured.")
