import asyncio
from pathlib import Path
import httpx
import pytest
from voice_cloning.transcription_client import NativeWorkerClient
from voice_cloning.services.sample_processing import SampleProcessingServiceError
from test_api import make_settings


def test_worker_transport_sends_audio_bytes_and_preserves_result(tmp_path, monkeypatch):
    source=tmp_path/'private-recording.wav'
    source.write_bytes(b'normalized-audio')
    requests=[]
    async def handler(request):
        requests.append(request)
        if request.method=='POST':
            assert await request.aread()==b'normalized-audio'
            assert 'private-recording' not in str(request.url)
            assert request.url.params['detectSpeakers']=='false'
            return httpx.Response(202,json={'id':'job'})
        if request.method=='GET':
            return httpx.Response(200,json={'status':'success','stages':{'transcription':{'status':'success'}},
                'result':{'words':[],'device':'apple-gpu'}})
        return httpx.Response(200,json={'deleted':True})
    monkeypatch.setattr(NativeWorkerClient,'_client',lambda self:httpx.AsyncClient(
        base_url='http://worker',transport=httpx.MockTransport(handler)))
    progress=[]
    result=asyncio.run(NativeWorkerClient(make_settings(tmp_path)).transcribe('job',source,
        {'engineId':'parakeet-mlx','language':'en','detectSpeakers':False},progress.append))
    assert result['device']=='apple-gpu'
    assert progress==[{'transcription':{'status':'success'}}]
    assert [r.method for r in requests]==['POST','GET','DELETE']


@pytest.mark.parametrize('cancel',[False,True])
def test_disconnect_or_api_cancellation_requests_worker_cleanup(tmp_path,monkeypatch,cancel):
    source=tmp_path/'audio.wav'
    source.write_bytes(b'audio')
    deleted=[]
    async def scenario():
        polling=asyncio.Event()
        async def handler(request):
            if request.method=='POST':
                return httpx.Response(202,json={})
            if request.method=='DELETE':
                await asyncio.sleep(.01)
                deleted.append(request.url.path)
                return httpx.Response(200,json={})
            polling.set()
            if cancel:
                await asyncio.Event().wait()
            raise httpx.ReadTimeout('private details')
        monkeypatch.setattr(NativeWorkerClient,'_client',lambda self:httpx.AsyncClient(
            base_url='http://worker',transport=httpx.MockTransport(handler)))
        task=asyncio.create_task(NativeWorkerClient(make_settings(tmp_path)).transcribe('job',source,{},lambda _:None))
        await polling.wait()
        if cancel:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(SampleProcessingServiceError,match='selected engine was not changed'):
                await task
    asyncio.run(scenario())
    assert deleted==['/v1/jobs/job']
