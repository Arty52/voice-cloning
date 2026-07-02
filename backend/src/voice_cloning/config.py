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


def _path_env(name: str, default: Path, base_dir: Path) -> Path:
    raw_value = os.getenv(name)
    candidate = Path(raw_value.strip()) if raw_value and raw_value.strip() else default
    if not candidate.is_absolute():
        candidate = base_dir / candidate
    return candidate.resolve()


def _optional_path_env(name: str, base_dir: Path) -> Path | None:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return None
    candidate = Path(raw_value.strip())
    if not candidate.is_absolute():
        candidate = base_dir / candidate
    return candidate.resolve()


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
    generated_audio_storage_dir: Path
    sample_processing_dir: Path
    speech_jobs_dir: Path
    cors_allowed_origins: list[str]
    generated_audio_export_dir: Path | None = None
    database_url: str = ""
    speech_job_segment_gap_ms: int = 250
    max_upload_bytes: int = 10 * 1024 * 1024
    max_source_upload_bytes: int = 1024 * 1024 * 1024
    max_selected_source_audio_bytes: int = 1024 * 1024 * 1024
    max_text_chars: int = 5000
    sample_processing_engine: str = ""
    sample_processing_demucs_command: str = "demucs"
    sample_processing_ffmpeg_command: str = "ffmpeg"
    sample_processing_ffprobe_command: str = "ffprobe"
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

        voice_assets_dir = _path_env("VOICE_ASSETS_DIR", app_root / "assets" / "voices", app_root)
        default_sample = _path_env(
            "DEFAULT_SAMPLE_PATH",
            voice_assets_dir / "default" / "default-voice.mp3",
            app_root,
        )
        voice_manifest = _path_env("VOICE_MANIFEST_PATH", voice_assets_dir / "voices.json", app_root)
        storage_dir = _path_env("STORAGE_DIR", app_root / "storage", app_root)
        generated_audio_storage_dir = _path_env(
            "GENERATED_AUDIO_STORAGE_DIR",
            storage_dir / "generated-audio",
            app_root,
        )
        generated_audio_export_dir = _optional_path_env("GENERATED_AUDIO_EXPORT_DIR", app_root)
        sample_processing_dir = _path_env(
            "SAMPLE_PROCESSING_DIR",
            storage_dir / "sample-processing",
            app_root,
        )
        speech_jobs_dir = _path_env("SPEECH_JOBS_DIR", storage_dir / "speech-jobs", app_root)
        origins = os.getenv(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:4340,http://127.0.0.1:4340",
        )
        max_source_upload_bytes = _positive_int_env("MAX_SOURCE_UPLOAD_BYTES", 1024 * 1024 * 1024)

        return cls(
            app_root=app_root,
            elevenlabs_api_key=os.getenv("ELEVENLABS_API_KEY", "").strip(),
            elevenlabs_api_base_url=os.getenv(
                "ELEVENLABS_API_BASE_URL", "https://api.elevenlabs.io/v1"
            ).rstrip("/"),
            elevenlabs_model_id=os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2"),
            default_sample_path=default_sample,
            voice_assets_dir=voice_assets_dir,
            voice_manifest_path=voice_manifest,
            storage_dir=storage_dir,
            generated_audio_storage_dir=generated_audio_storage_dir,
            generated_audio_export_dir=generated_audio_export_dir,
            sample_processing_dir=sample_processing_dir,
            speech_jobs_dir=speech_jobs_dir,
            cors_allowed_origins=_split_csv(origins),
            database_url=os.getenv("DATABASE_URL", "").strip(),
            speech_job_segment_gap_ms=_non_negative_int_env("SPEECH_JOB_SEGMENT_GAP_MS", 250),
            max_upload_bytes=_positive_int_env("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
            max_source_upload_bytes=max_source_upload_bytes,
            max_selected_source_audio_bytes=_positive_int_env(
                "MAX_SELECTED_SOURCE_AUDIO_BYTES",
                max_source_upload_bytes,
            ),
            sample_processing_engine=os.getenv("SAMPLE_PROCESSING_ENGINE", "").strip().lower(),
            sample_processing_demucs_command=os.getenv("SAMPLE_PROCESSING_DEMUCS_COMMAND", "demucs").strip()
            or "demucs",
            sample_processing_ffmpeg_command=os.getenv("SAMPLE_PROCESSING_FFMPEG_COMMAND", "ffmpeg").strip()
            or "ffmpeg",
            sample_processing_ffprobe_command=os.getenv("SAMPLE_PROCESSING_FFPROBE_COMMAND", "ffprobe").strip()
            or "ffprobe",
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

    def ensure_runtime_directories(self) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.generated_audio_storage_dir.mkdir(parents=True, exist_ok=True)
        if self.generated_audio_export_dir is not None:
            self.generated_audio_export_dir.mkdir(parents=True, exist_ok=True)
        self.voice_assets_dir.mkdir(parents=True, exist_ok=True)
