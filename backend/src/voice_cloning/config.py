from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


def _default_root_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


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
    cors_allowed_origins: list[str]
    max_upload_bytes: int = 10 * 1024 * 1024
    max_source_upload_bytes: int = 50 * 1024 * 1024
    max_text_chars: int = 5000

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
            cors_allowed_origins=_split_csv(origins),
        )

    def require_api_key(self) -> None:
        if not self.elevenlabs_api_key:
            raise RuntimeError("ELEVENLABS_API_KEY is not configured.")
