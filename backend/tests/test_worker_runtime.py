import json
from pathlib import Path
from unittest.mock import patch
from voice_transcription.cli import live_capabilities
from voice_transcription.native import configure_runtime


def test_worker_caches_are_confined_to_runtime_root(tmp_path,monkeypatch):
    for name in ('HF_HOME','HF_HUB_CACHE','TORCH_HOME','MPLCONFIGDIR','HF_HUB_DISABLE_TELEMETRY','PYANNOTE_METRICS_ENABLED'):
        monkeypatch.delenv(name,raising=False)
    configure_runtime(tmp_path)
    import os
    for name in ('HF_HOME','HF_HUB_CACHE','TORCH_HOME','MPLCONFIGDIR'):
        assert Path(os.environ[name]).is_relative_to(tmp_path)


def test_doctor_does_not_claim_live_health_when_token_or_worker_is_missing(tmp_path):
    assert live_capabilities(tmp_path) is None
    (tmp_path/'token').write_text('x'*48)
    with patch('urllib.request.urlopen',side_effect=OSError('not running')):
        assert live_capabilities(tmp_path) is None
