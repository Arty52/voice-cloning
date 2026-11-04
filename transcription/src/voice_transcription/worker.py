"""Authenticated local job server. No browser access or client filesystem paths."""
from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
import hmac
import multiprocessing as mp
import os
from pathlib import Path
import queue
import re
import signal
import time
import uuid
import wave
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from .catalog import capabilities, model_for
from .contracts import InferenceError

MAX_AUDIO_BYTES = 1_000_000_000
JOB_ID = re.compile(r'^[a-f0-9]{32}$')


def inference_process(stage, incoming, outgoing):
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['PYANNOTE_METRICS_ENABLED'] = '0'
    from .native import NativeInference
    inference = NativeInference()
    while True:
        message = incoming.get()
        if message is None:
            return
        job_id, source, root, options = message
        started = time.perf_counter()
        try:
            result = inference.run(stage, Path(source), Path(root), options)
            outgoing.put((job_id, stage, 'success', result, time.perf_counter()-started))
        except Exception as exc:
            message = str(exc) if isinstance(exc, InferenceError) else f'{stage.capitalize()} inference failed; check model preparation and worker installation.'
            outgoing.put((job_id, stage, 'error', message, time.perf_counter()-started))


class JobManager:
    def __init__(self, root: Path, *, process_target=inference_process, timeout=1800):
        self.root, self.process_target, self.timeout = root, process_target, timeout
        self.jobs = {}
        self.uploads = {}
        self.active = None
        self.task = None
        self.source = None
        self.context = mp.get_context('spawn')
        self.workers = {}
        self.outgoing = self.context.Queue()

    def _worker(self, stage):
        previous = self.workers.get(stage)
        if previous is not None and previous[0].is_alive():
            return previous
        if previous is not None:
            previous[0].join()
            previous[0].close()
            previous[1].cancel_join_thread()
            previous[1].close()
        incoming = self.context.Queue()
        process = self.context.Process(target=self.process_target, args=(stage, incoming, self.outgoing), daemon=True)
        process.start()
        self.workers[stage] = (process, incoming)
        return process, incoming

    async def stop_workers(self):
        workers, self.workers = self.workers, {}
        for process, _ in workers.values():
            if process.is_alive():
                process.terminate()
        for process, incoming in workers.values():
            await asyncio.to_thread(process.join, 2)
            if process.is_alive():
                process.kill()
                await asyncio.to_thread(process.join, 2)
            incoming.close()
        # Killing a writer can leave a multiprocessing pipe mid-message. A new
        # generation must never consume the terminated processes' queue.
        self.outgoing.cancel_join_thread()
        self.outgoing.close()
        self.outgoing = self.context.Queue()

    def start(self, job_id, source, options):
        self.jobs[job_id] = {'id':job_id, 'status':'running', 'stages':{}, 'result':None, 'error':None}
        self.active = job_id
        self.source = source
        self.task = asyncio.create_task(self._run(job_id, source, options))
        return self.jobs[job_id]

    async def _run(self, job_id, source, options):
        job = self.jobs[job_id]
        started = time.perf_counter()
        stages = ['transcription'] + (['diarization'] if options['detectSpeakers'] else [])
        results = {}
        warnings = []
        try:
            for stage in stages:
                _, incoming = self._worker(stage)
                incoming.put((job_id, str(source), str(self.root), options))
                job['stages'][stage] = {'status':'running'}
            pending = set(stages)
            while pending:
                if time.perf_counter()-started > self.timeout:
                    if 'transcription' not in results:
                        raise TimeoutError()
                    await self.stop_workers()
                    warnings.append('Speaker detection timed out. Transcript text is available without speaker assignments.')
                    job['stages']['diarization'] = {'status':'error', 'elapsedSeconds':time.perf_counter()-started}
                    break
                for stage in tuple(pending):
                    if not self.workers[stage][0].is_alive():
                        if stage == 'transcription':
                            raise RuntimeError('worker exited')
                        pending.remove(stage)
                        warnings.append('Speaker detection stopped unexpectedly. Transcript text is available without speaker assignments.')
                        job['stages'][stage] = {'status':'error', 'elapsedSeconds':time.perf_counter()-started}
                if not pending:
                    break
                try:
                    event_id, stage, status, value, elapsed = self.outgoing.get_nowait()
                except queue.Empty:
                    await asyncio.sleep(.05)
                    continue
                if event_id != job_id or stage not in pending:
                    continue
                pending.remove(stage)
                job['stages'][stage] = {'status':status, 'elapsedSeconds':elapsed}
                if status == 'success':
                    results[stage] = value
                elif stage == 'transcription':
                    raise InferenceError(value)
                else:
                    warnings.append('Speaker detection failed. Transcript text is available without speaker assignments.')
            job.update(status='success', result={**results['transcription'],
                'diarization':results.get('diarization'), 'warnings':results['transcription'].get('warnings', [])+warnings,
                'total_seconds':time.perf_counter()-started,
                'asr_seconds':job['stages']['transcription']['elapsedSeconds']})
        except asyncio.CancelledError:
            await self.stop_workers()
            job.update(status='canceled', error='Transcription was canceled.')
        except Exception as exc:
            await self.stop_workers()
            job.update(status='error', error=str(exc) if isinstance(exc, InferenceError) else 'Transcription timed out.' if isinstance(exc, TimeoutError) else 'Native transcription failed. Check worker status and prepared models.')
        finally:
            source.unlink(missing_ok=True)
            self.active = None
            # Bound terminal metadata, which contains transcript content until collected.
            while len(self.jobs) > 50:
                del self.jobs[next(iter(self.jobs))]

    async def cancel(self, job_id):
        upload = self.uploads.get(job_id)
        if upload is not None:
            upload.cancel()
            try:
                await upload
            except asyncio.CancelledError:
                pass
            self.jobs[job_id].update(status='canceled', error='Transcription was canceled during upload.')
            return self.jobs[job_id]
        if self.active == job_id and self.task is not None:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                await self.stop_workers()
                if self.source is not None:
                    self.source.unlink(missing_ok=True)
                self.active = None
                self.jobs[job_id].update(status='canceled', error='Transcription was canceled.')
        return self.jobs[job_id]


def create_app(root: Path, *, manager=None, capability_reader=capabilities):
    root.mkdir(parents=True, exist_ok=True)
    try:
        token = (root/'token').read_text().strip()
    except OSError as exc:
        raise ValueError('Initialize a worker authentication token first.') from exc
    if len(token) < 32:
        raise ValueError('Initialize a worker authentication token first.')
    jobs = manager or JobManager(root)
    spool = root/'jobs'
    spool.mkdir(exist_ok=True)

    @asynccontextmanager
    async def lifespan(app):
        # Uploaded audio from interrupted processes is never reused.
        for path in spool.glob('*.wav'):
            path.unlink()
        yield
        if jobs.active:
            await jobs.cancel(jobs.active)
        await jobs.stop_workers()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.jobs = jobs

    def authorize(authorization: str | None = Header(None)):
        if not hmac.compare_digest(authorization or '', 'Bearer '+token):
            raise HTTPException(401, 'Worker authentication required.')

    @app.get('/v1/capabilities', dependencies=[Depends(authorize)])
    async def describe():
        return capability_reader(root)

    @app.post('/v1/jobs', status_code=202, dependencies=[Depends(authorize)])
    async def create(request: Request, engineId: str, language: str='en', detectSpeakers: bool=True,
                     idempotency_key: str | None = Header(None)):
        try:
            model = model_for(engineId)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if language not in model.languages:
            raise HTTPException(422, 'Unsupported language for this engine.')
        job_id = idempotency_key or uuid.uuid4().hex
        if not JOB_ID.fullmatch(job_id):
            raise HTTPException(422, 'Invalid job identifier.')
        options = {'engineId':engineId, 'language':language, 'detectSpeakers':detectSpeakers}
        if job_id in jobs.jobs:
            if jobs.jobs[job_id].get('options') != options:
                raise HTTPException(409, 'This job identifier belongs to different settings.')
            return jobs.jobs[job_id]
        if jobs.active is not None:
            raise HTTPException(409, 'The native worker is busy.')
        info = capability_reader(root)
        entry = next((x for x in info.get('engines', []) if x.get('id') == engineId), None)
        if entry is None or entry.get('ready') is not True:
            raise HTTPException(503, 'Prepare the selected model before transcription.')
        if request.headers.get('content-type', '').split(';')[0] != 'audio/wav':
            raise HTTPException(415, 'Upload normalized mono 16 kHz PCM WAV audio.')
        jobs.active = job_id  # Reserve before awaiting upload chunks.
        source = spool/f'{job_id}.wav'
        jobs.jobs[job_id] = {'id':job_id, 'status':'uploading', 'stages':{}, 'result':None, 'error':None, 'options':options}
        jobs.uploads[job_id] = asyncio.current_task()
        try:
            size = 0
            with source.open('xb') as handle:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_AUDIO_BYTES:
                        raise HTTPException(413, 'Audio exceeds the worker upload limit.')
                    handle.write(chunk)
            try:
                with wave.open(str(source)) as audio:
                    valid = audio.getnchannels()==1 and audio.getframerate()==16000 and audio.getsampwidth()==2 and audio.getnframes()>0
            except (wave.Error, EOFError):
                valid = False
            if not valid:
                raise HTTPException(422, 'Expected non-empty mono 16 kHz PCM16 WAV audio.')
            result = jobs.start(job_id, source, options)
            result['options'] = options
            return result
        except BaseException as exc:
            jobs.active = None
            source.unlink(missing_ok=True)
            if isinstance(exc, asyncio.CancelledError):
                jobs.jobs[job_id].update(status='canceled', error='Transcription was canceled during upload.')
            else:
                jobs.jobs.pop(job_id, None)
            raise
        finally:
            jobs.uploads.pop(job_id, None)

    def get_job(job_id):
        if job_id not in jobs.jobs:
            raise HTTPException(404, 'Worker job not found.')
        return jobs.jobs[job_id]

    @app.get('/v1/jobs/{job_id}', dependencies=[Depends(authorize)])
    async def status(job_id: str):
        return get_job(job_id)

    @app.post('/v1/jobs/{job_id}/cancel', dependencies=[Depends(authorize)])
    async def cancel(job_id: str):
        get_job(job_id)
        return await jobs.cancel(job_id)

    @app.delete('/v1/jobs/{job_id}', dependencies=[Depends(authorize)])
    async def delete(job_id: str):
        get_job(job_id)
        await jobs.cancel(job_id)
        del jobs.jobs[job_id]
        return {'deleted':True}

    @app.post('/v1/shutdown', dependencies=[Depends(authorize)])
    async def shutdown():
        asyncio.get_running_loop().call_later(.2, os.kill, os.getpid(), signal.SIGTERM)
        return {'stopping':True}

    return app
