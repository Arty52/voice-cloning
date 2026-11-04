"""Local worker transport and public engine descriptors; credentials stay server-side."""
from __future__ import annotations
import asyncio
import importlib.util
from pathlib import Path
import time
import httpx
from voice_transcription.catalog import MODELS, model_for
from .config import Settings
from .services.sample_processing import SampleProcessingServiceError

CPU_LANGUAGES = ('auto', 'en', 'ru', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'zh', 'ko')


def validate_options(engine_id, language, detect_speakers):
    engine_id = engine_id or 'faster-whisper'
    language = language or 'en'
    if engine_id == 'faster-whisper':
        languages = CPU_LANGUAGES
    else:
        try:
            languages = model_for(engine_id).languages
        except ValueError as exc:
            raise SampleProcessingServiceError(str(exc), 422) from exc
    if language not in languages:
        raise SampleProcessingServiceError('Unsupported language for the selected transcription engine.', 422)
    return {'engineId':engine_id, 'language':language, 'detectSpeakers':True if detect_speakers is None else detect_speakers}


class NativeWorkerClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _client(self):
        if not self.settings.transcription_worker_url:
            raise SampleProcessingServiceError('Native worker is not configured.', 503)
        try:
            path = Path(self.settings.transcription_worker_token_path) if self.settings.transcription_worker_token_path else self.settings.storage_dir/'transcription-worker'/'token'
            token = path.read_text().strip()
        except OSError as exc:
            raise SampleProcessingServiceError('Native worker token file is unavailable.', 503) from exc
        if len(token)<32:
            raise SampleProcessingServiceError('Native worker token is invalid.', 503)
        # These are per-chunk network inactivity limits, not the job duration.
        # Inference is asynchronous; uploads stream and status requests return promptly.
        return httpx.AsyncClient(base_url=self.settings.transcription_worker_url.rstrip('/'),
            headers={'Authorization':'Bearer '+token}, timeout=httpx.Timeout(30.,connect=3.), trust_env=False)

    async def capabilities(self):
        try:
            async with self._client() as client:
                response = await client.get('/v1/capabilities')
                response.raise_for_status()
                data=response.json()
                if data.get('protocolVersion') != 1:
                    raise ValueError('unsupported protocol')
                return data
        except (httpx.HTTPError, ValueError) as exc:
            raise SampleProcessingServiceError('Native worker is unavailable or incompatible. Check its status and token.', 503) from exc

    async def transcribe(self, job_id, source: Path, options: dict, report_progress):
        async def audio_bytes():
            with source.open('rb') as handle:
                while chunk := await asyncio.to_thread(handle.read, 1024*1024):
                    yield chunk
        async with self._client() as client:
            submitted = False
            try:
                submitted = True  # A lost response may still have created the job.
                response = await client.post('/v1/jobs', params=options, content=audio_bytes(),
                    headers={'Content-Type':'audio/wav', 'Idempotency-Key':job_id})
                if response.status_code in (401,409,422,503):
                    details={401:'Native worker authentication failed.',409:'Native worker is busy. Retry when the current job finishes.',422:'Native worker rejected the transcription settings or audio.',503:'Prepare the selected native model before transcription.'}
                    raise SampleProcessingServiceError(details[response.status_code], response.status_code)
                response.raise_for_status()
                deadline=time.monotonic()+self.settings.sample_processing_timeout_seconds
                previous=None
                while True:
                    response=await client.get(f'/v1/jobs/{job_id}')
                    response.raise_for_status()
                    data=response.json()
                    progress=data.get('stages', {})
                    if progress != previous:
                        report_progress(progress)
                        previous=progress
                    if data['status']=='success':
                        return data['result']
                    if data['status'] in ('error','canceled'):
                        raise SampleProcessingServiceError('Native transcription was canceled.' if data['status']=='canceled' else 'Native transcription failed. Check worker status and prepared models.', 502)
                    if time.monotonic()>deadline:
                        raise SampleProcessingServiceError('Native transcription timed out.',504)
                    await asyncio.sleep(.5)
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                raise SampleProcessingServiceError('Native worker connection failed. The selected engine was not changed.',503) from exc
            finally:
                if submitted:
                    # DELETE also cancels computation; cleanup must run after API cancellation.
                    try:
                        await asyncio.shield(client.delete(f'/v1/jobs/{job_id}', timeout=5.))
                    except (httpx.HTTPError, asyncio.CancelledError):
                        pass


async def engine_metadata(settings: Settings):
    cpu_ready=importlib.util.find_spec('faster_whisper') is not None
    engines=[{'id':'faster-whisper','label':'Whisper CPU','model':settings.sample_processing_whisper_model,
              'device':'cpu' if settings.sample_processing_whisper_device=='cpu' else settings.sample_processing_whisper_device,
              'languages':list(CPU_LANGUAGES),'ready':cpu_ready,
              'unavailableReason':None if cpu_ready else 'Install backend[diarization] for CPU transcription.'}]
    native = None
    reason='Configure and start the native Mac worker.'
    try:
        native=await NativeWorkerClient(settings).capabilities()
    except SampleProcessingServiceError as exc:
        reason=exc.detail
    for model in MODELS:
        found=next((x for x in (native or {}).get('engines',[]) if x.get('id')==model.id),None)
        engines.append({'id':model.id,'label':model.label,'model':model.repository,'device':model.device,
            'languages':list(model.languages),'ready':bool(found and found.get('ready')),
            'unavailableReason':found.get('unavailableReason') if found else reason})
    return {'defaultEngineId':'faster-whisper','engines':engines,
            'nativeDiarizationReady':bool(native and native.get('diarizationReady'))}
