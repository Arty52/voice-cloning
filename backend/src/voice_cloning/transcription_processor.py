"""Full-file transcription orchestration, independent of voice preparation."""
import asyncio
from dataclasses import asdict, replace
import time
from voice_transcription.contracts import Word, Turn, InferenceError
from voice_transcription.legacy import FasterWhisperTranscriber, PyannoteDiarizer
from .models import SampleProcessingOperation, SpeakerSeparationResult, SpeakerSeparationTranscript
from .sample_processors import (
    DiarizationSampleProcessor, _normalize_audio, _speaker_separation_result_from_words,
    _speaker_turn_ranges_by_id, _transcript_items_from_words,
)
from .services.sample_processing import SampleProcessingServiceError
from .transcription_client import NativeWorkerClient


class TranscriptionSampleProcessor(DiarizationSampleProcessor):
    @property
    def engine_name(self):
        return 'local-transcription'

    def operations(self):
        return (SampleProcessingOperation(id='transcribe',label='Transcribe',
            description='Transcribe a complete recording with optional speaker detection.',enabled=True),)

    async def process(self, request):
        async with self._lock:
            options=request.transcription_options or {'engineId':'faster-whisper','language':'en','detectSpeakers':True}
            progress={}
            def report(update):
                progress.update(update)
                if callable(request.report_transcription_progress):
                    request.report_transcription_progress(dict(progress))
            started=time.perf_counter()
            report({'normalization':{'status':'running'}})
            normalized=request.job_dir/'normalized-source.wav'
            await _normalize_audio(request.source_path,normalized,self.settings)
            report({'normalization':{'status':'success','elapsedSeconds':time.perf_counter()-started}})
            if options['engineId']=='faster-whisper':
                data=await self._cpu(normalized,options,report)
            else:
                data=await NativeWorkerClient(self.settings).transcribe(request.job_id,normalized,options,report)
            try:
                words=tuple(Word(**word) for word in data['words'])
                diarization=data.get('diarization')
                turns=tuple(Turn(**turn) for turn in diarization['turns']) if diarization else ()
                exclusive=tuple(Turn(**turn) for turn in diarization['exclusive_turns']) if diarization else ()
            except (TypeError,KeyError) as exc:
                raise SampleProcessingServiceError('Transcription engine returned an invalid result.',502) from exc
            metadata={key:data[key] for key in ('engine','model','revision','device','language','asr_seconds','warnings') if key in data}
            metadata['diarizationDevice']='cpu' if turns else None
            metadata['speakerDetectionRequested']=options['detectSpeakers']
            metadata['speakerDetectionSucceeded']=bool(turns)
            if turns and words:
                # Stable IDs come from regular turns; exclusive output only assigns words.
                result=_speaker_separation_result_from_words(turns,words,attribution_turns=exclusive)
                report({'speakerAudio':{'status':'running'}})
                result=await self._attach_speaker_streams(normalized,request.job_dir,result,
                    speaker_ranges_by_id=_speaker_turn_ranges_by_id(turns),max_output_bytes=request.max_output_bytes)
                report({'speakerAudio':{'status':'success'}})
            else:
                items=_transcript_items_from_words(words,(Turn(0.,max((w.end_seconds for w in words),default=1.),'unknown'),),lambda _: 'unassigned') if words else []
                result=SpeakerSeparationResult(kind='transcript',speakers=(),
                    transcript=SpeakerSeparationTranscript(tuple(replace(item,speaker_id=None) for item in items)))
            return replace(result,kind='transcript',metadata={**metadata,
                'total_seconds':time.perf_counter()-started,'stages':dict(progress)})

    async def _cpu(self, normalized, options, report):
        try:
            if self._transcriber is None:
                from faster_whisper import WhisperModel
                self._transcriber=FasterWhisperTranscriber(WhisperModel,self.settings.sample_processing_whisper_model,
                    self.settings.sample_processing_whisper_device,self.settings.sample_processing_whisper_compute_type)
            report({'transcription':{'status':'running'}})
            started=time.perf_counter()
            words=await asyncio.wait_for(asyncio.to_thread(self._transcriber.transcribe,normalized,
                None if options['language']=='auto' else options['language']),self.settings.sample_processing_timeout_seconds)
            elapsed=time.perf_counter()-started
            report({'transcription':{'status':'success','elapsedSeconds':elapsed}})
        except (ImportError,InferenceError,TimeoutError) as exc:
            raise SampleProcessingServiceError('CPU transcription failed. Check dependencies and model configuration.',503) from exc
        data={'words':[asdict(w) for w in words], 'engine':'faster-whisper','model':self.settings.sample_processing_whisper_model,
              'device':self.settings.sample_processing_whisper_device,'language':options['language'],'asr_seconds':elapsed,'warnings':[]}
        if options['detectSpeakers'] and words:
            started=time.perf_counter()
            report({'diarization':{'status':'running'}})
            try:
                if self._diarizer is None:
                    from pyannote.audio import Pipeline
                    self._diarizer=PyannoteDiarizer(Pipeline,self.settings.sample_processing_pyannote_model,self.settings.sample_processing_hf_token)
                result=await asyncio.wait_for(asyncio.to_thread(self._diarizer.diarize,normalized),self.settings.sample_processing_timeout_seconds)
                data['diarization']={'turns':[asdict(t) for t in result.turns],'exclusive_turns':[asdict(t) for t in result.exclusive_turns]}
                report({'diarization':{'status':'success','elapsedSeconds':time.perf_counter()-started}})
            except (ImportError,InferenceError,TimeoutError):
                data['warnings'].append('Speaker detection failed. Transcript text is available without speaker assignments.')
                report({'diarization':{'status':'error','elapsedSeconds':time.perf_counter()-started}})
        return data
