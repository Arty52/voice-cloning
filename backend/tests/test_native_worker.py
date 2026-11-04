import asyncio
import io
from pathlib import Path
import time
import wave
from fastapi.testclient import TestClient
from voice_transcription.worker import create_app, JobManager

TOKEN='t'*48

def capabilities(root):
    return {'protocolVersion':1,'engines':[{'id':'parakeet-mlx','ready':True}], 'diarizationReady':False}

def wav():
    stream=io.BytesIO()
    with wave.open(stream,'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000)
        audio.writeframes(b'\0'*320)
    return stream.getvalue()

def slow_process(stage, incoming, outgoing):
    incoming.get()
    time.sleep(30)

def test_authentication_validation_and_rejected_upload_cleanup(tmp_path):
    (tmp_path/'token').write_text(TOKEN)
    with TestClient(create_app(tmp_path, capability_reader=capabilities)) as client:
        assert client.get('/v1/capabilities').status_code==401
        client.headers['Authorization']='Bearer '+TOKEN
        assert client.get('/v1/capabilities').status_code==200
        assert client.post('/v1/jobs?engineId=unknown').status_code==422
        assert client.post('/v1/jobs?engineId=parakeet-mlx&language=ru').status_code==422
        response=client.post('/v1/jobs?engineId=parakeet-mlx',content=b'invalid',headers={'Content-Type':'audio/wav'})
        assert response.status_code==422
        assert not list((tmp_path/'jobs').glob('*.wav'))
        assert client.app.state.jobs.active is None


def test_cancel_kills_inference_process_and_cleans_audio(tmp_path):
    async def run():
        source=tmp_path/'source.wav'; source.write_bytes(wav())
        manager=JobManager(tmp_path,process_target=slow_process)
        manager.start('a'*32,source,{'detectSpeakers':False})
        await asyncio.sleep(.2)
        process=manager.workers['transcription'][0]
        await manager.cancel('a'*32)
        assert not process.is_alive()
        assert manager.jobs['a'*32]['status']=='canceled'
        assert not source.exists()
        assert manager.active is None
    asyncio.run(run())


def partial_process(stage, incoming, outgoing):
    while True:
        job_id, *_ = incoming.get()
        if stage == 'diarization':
            outgoing.put((job_id,stage,'error','model unavailable',.1))
        else:
            outgoing.put((job_id,stage,'success',{'words':[], 'text':'retained'},.1))


def test_partial_failure_preserves_text_and_supports_warm_reuse(tmp_path):
    async def run():
        manager=JobManager(tmp_path,process_target=partial_process)
        try:
            for i in range(2):
                source=tmp_path/f'{i}.wav'; source.write_bytes(wav())
                manager.start(str(i)*32,source,{'detectSpeakers':True})
                await asyncio.wait_for(manager.task,10)
                job=manager.jobs[str(i)*32]
                assert job['status']=='success'
                assert job['result']['text']=='retained'
                assert job['result']['diarization'] is None
                assert job['result']['warnings']
                assert len(manager.workers)==2
        finally:
            await manager.stop_workers()
    asyncio.run(run())


def test_cancel_before_task_starts(tmp_path):
    async def run():
        source=tmp_path/'source.wav'; source.write_bytes(wav())
        manager=JobManager(tmp_path,process_target=slow_process)
        manager.start('b'*32,source,{'detectSpeakers':False})
        await manager.cancel('b'*32)
        assert manager.active is None
        assert not source.exists()
    asyncio.run(run())
