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


def test_cancel_during_upload_releases_reservation_without_starting_inference(tmp_path):
    import httpx
    async def run():
        (tmp_path/'token').write_text(TOKEN)
        manager=JobManager(tmp_path,process_target=slow_process)
        app=create_app(tmp_path,manager=manager,capability_reader=capabilities)
        started=asyncio.Event()
        async def content():
            yield wav()[:20]
            started.set()
            await asyncio.Event().wait()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://worker',headers={'Authorization':'Bearer '+TOKEN}) as client:
            task=asyncio.create_task(client.post('/v1/jobs?engineId=parakeet-mlx',content=content(),headers={'Content-Type':'audio/wav','Idempotency-Key':'c'*32}))
            await started.wait()
            response=await client.post('/v1/jobs/'+'c'*32+'/cancel')
            assert response.json()['status']=='canceled'
            try: await task
            except asyncio.CancelledError: pass
        assert manager.active is None
        assert not manager.workers
        assert not list((tmp_path/'jobs').glob('*.wav'))
    asyncio.run(run())


def crash_process(stage, incoming, outgoing):
    import os
    incoming.get()
    os._exit(1)


def test_worker_crash_fails_job_and_a_fresh_process_can_run_next_job(tmp_path):
    async def run():
        manager=JobManager(tmp_path,process_target=crash_process)
        source=tmp_path/'crash.wav';source.write_bytes(wav())
        manager.start('d'*32,source,{'detectSpeakers':False})
        await asyncio.wait_for(manager.task,10)
        assert manager.jobs['d'*32]['status']=='error'
        assert not source.exists()
        manager.process_target=partial_process
        source=tmp_path/'retry.wav';source.write_bytes(wav())
        manager.start('e'*32,source,{'detectSpeakers':False})
        await asyncio.wait_for(manager.task,10)
        assert manager.jobs['e'*32]['status']=='success'
        await manager.stop_workers()
    asyncio.run(run())


def test_missing_token_and_missing_engine_have_actionable_failures(tmp_path):
    import pytest
    with pytest.raises(ValueError,match='Initialize'):
        create_app(tmp_path)
    (tmp_path/'token').write_text(TOKEN)
    with TestClient(create_app(tmp_path,capability_reader=lambda root:{'engines':[]})) as client:
        client.headers['Authorization']='Bearer '+TOKEN
        assert client.post('/v1/jobs?engineId=parakeet-mlx',content=wav(),headers={'Content-Type':'audio/wav'}).status_code==503
        assert client.app.state.jobs.active is None


def test_inference_errors_preserve_safe_details_and_elapsed_time(monkeypatch,tmp_path):
    import queue
    from voice_transcription import native,worker
    from voice_transcription.contracts import InferenceError
    class FailedInference:
        def run(self,*args): raise InferenceError('Prepare the selected model first.')
    monkeypatch.setattr(native,'NativeInference',FailedInference)
    incoming,outgoing=queue.Queue(),queue.Queue()
    incoming.put(('job',str(tmp_path/'audio'),str(tmp_path),{}));incoming.put(None)
    worker.inference_process('transcription',incoming,outgoing)
    event=outgoing.get_nowait()
    assert event[2]=='error' and event[3]=='Prepare the selected model first.' and event[4]>0
