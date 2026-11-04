"""Allowlisted, revision-pinned native models. Preparation is always explicit."""
from dataclasses import asdict, dataclass
import importlib.util
from pathlib import Path
import platform

@dataclass(frozen=True)
class Model:
    id: str
    label: str
    repository: str
    revision: str
    module: str
    device: str
    languages: tuple[str, ...]

MODELS = (
    Model('parakeet-mlx', 'Parakeet English', 'mlx-community/parakeet-tdt-0.6b-v2',
          '8ae155301e23d820d82aa60d24817c900e69e487', 'parakeet_mlx', 'apple-gpu', ('en',)),
    Model('whisper-mlx', 'Whisper Multilingual', 'mlx-community/whisper-large-v3-mlx',
          '49e6aa286ad60c14352c404340ded53710378a11', 'mlx_whisper', 'apple-gpu', ('auto', 'en', 'ru', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'zh', 'ko')),
)
DIARIZATION_REPO = 'pyannote/speaker-diarization-community-1'
DIARIZATION_REVISION = '3533c8cf8e369892e6b79ff1bf80f7b0286a54ee'


def model_for(engine_id: str) -> Model:
    for model in MODELS:
        if model.id == engine_id:
            return model
    raise ValueError('Unsupported transcription engine.')


def model_path(root: Path, model: Model) -> Path:
    return root / 'models' / model.id / model.revision


def ready(path: Path) -> bool:
    return (path / '.prepared').is_file()


def capabilities(root: Path) -> dict:
    supported = platform.system() == 'Darwin' and platform.machine() == 'arm64'
    engines = []
    for model in MODELS:
        installed = importlib.util.find_spec(model.module) is not None
        prepared = ready(model_path(root, model))
        reason = None if supported and installed and prepared else (
            'Apple Silicon macOS is required.' if not supported else
            'Install the native worker dependencies.' if not installed else 'Prepare this model before transcription.')
        engines.append({**asdict(model), 'ready': reason is None, 'unavailableReason': reason})
    return {'protocolVersion':1, 'engines':engines,
            'diarizationReady':ready(root/'models'/'diarization'/DIARIZATION_REVISION)}
