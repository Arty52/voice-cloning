import asyncio
from dataclasses import replace
from voice_cloning.transcription_client import engine_metadata, NativeWorkerClient
from voice_cloning.services.sample_processing import SampleProcessingServiceError
from test_api import make_settings


def test_cpu_readiness_requires_registered_processor_but_not_speaker_credentials(tmp_path,monkeypatch):
    monkeypatch.setattr('voice_cloning.transcription_client.importlib.util.find_spec',lambda name:object())
    async def unavailable(self):
        raise SampleProcessingServiceError('Worker unavailable.',503)
    monkeypatch.setattr(NativeWorkerClient,'capabilities',unavailable)
    settings=make_settings(tmp_path)
    disabled=asyncio.run(engine_metadata(settings))
    assert not disabled['engines'][0]['ready']
    enabled=asyncio.run(engine_metadata(replace(settings,sample_processing_enable_diarization=True,sample_processing_hf_token='')))
    assert enabled['engines'][0]['ready']
    assert enabled['defaultEngineId']=='faster-whisper'
    assert all(not engine['ready'] for engine in enabled['engines'][1:])
