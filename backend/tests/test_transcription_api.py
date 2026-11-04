import asyncio
from dataclasses import replace
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from voice_cloning.api import create_app
from voice_cloning.models import SampleProcessingOperation, SpeakerSeparationResult, SpeakerSeparationTranscript, SpeakerTranscriptItem
from voice_cloning.sample_processors import _speaker_separation_result_from_words, _speaker_turn_ranges_by_id
from voice_cloning.transcription_processor import TranscriptionSampleProcessor
from voice_transcription.contracts import Turn, Word, InferenceError
from test_api import make_settings, wait_for_processing_job, ffmpeg_fake_command


class TextProcessor:
    engine_name = 'test-transcription'
    def operations(self):
        return (SampleProcessingOperation(id='transcribe',label='Transcribe',description='Transcribe.',enabled=True),)
    def engine_name_for_operation(self, operation_id):
        return self.engine_name
    async def process(self, request):
        self.request = request
        request.report_transcription_progress({'asr':{'status':'success','elapsedSeconds':.25}})
        return SpeakerSeparationResult(kind='transcript', speakers=(),
            transcript=SpeakerSeparationTranscript((SpeakerTranscriptItem(
                id='item-1', text='Original words.',start_seconds=0.,end_seconds=1.,speaker_id=None),)),
            metadata={'engine':request.transcription_options['engineId'],'device':'apple-gpu',
                'warnings':['Speaker detection failed. Transcript text is available without speaker assignments.']})


def test_transcription_contract_keeps_text_corrections_and_prepare_audio_separate(tmp_path):
    processor = TextProcessor()
    with TestClient(create_app(settings=make_settings(tmp_path),sample_processor=processor)) as client:
        create = client.post('/api/sample-processing/jobs',data={'operationId':'transcribe',
            'transcriptionEngineId':'parakeet-mlx','language':'en','detectSpeakers':'false'},
            files={'sourceFile':('source.wav',b'audio','audio/wav')})
        assert create.status_code == 202, create.text
        job_id=create.json()['job']['id']
        job=wait_for_processing_job(client,job_id)
        assert job['transcriptionOptions']=={'engineId':'parakeet-mlx','language':'en','detectSpeakers':False}
        assert job['transcriptionProgress']['asr']['elapsedSeconds']==.25
        assert job['result']['transcript']['items'][0]['speakerId'] is None
        assert job['result']['metadata']['warnings']
        patched=client.patch(f'/api/sample-processing/jobs/{job_id}/transcript-items',json={
            'items':[{'itemId':'item-1','text':'Corrected words.'}]})
        assert patched.status_code==200,patched.text
        assert patched.json()['job']['result']['kind']=='transcript'
        assert patched.json()['job']['result']['metadata']==job['result']['metadata']
        assert client.get(f'/api/sample-processing/jobs/{job_id}/speakers/speaker-1/result').status_code==404
        options=client.get('/api/sample-processing/options').json()
        assert all(op['id']!='transcribe' for op in options['operations'])


@pytest.mark.parametrize('fields',[
    {'transcriptionEngineId':'cloud'},
    {'transcriptionEngineId':'parakeet-mlx','language':'fr'},
    {'processingPresetId':'default'},
    {'workflowSteps':'[{"operationId":"transcribe"}]'},
])
def test_invalid_transcription_choices_are_rejected_before_inference(tmp_path,fields):
    with TestClient(create_app(settings=make_settings(tmp_path),sample_processor=TextProcessor())) as client:
        response=client.post('/api/sample-processing/jobs',data={'operationId':'transcribe',**fields},
            files={'sourceFile':('audio.wav',b'audio','audio/wav')})
        assert response.status_code==422,response.text


def test_exclusive_order_does_not_change_extracted_speaker_identity():
    regular=(Turn(0.,3.,'a'),Turn(0.,4.,'b'))
    exclusive=(Turn(0.,2.,'b'),Turn(2.,3.,'a'))
    result=_speaker_separation_result_from_words(regular,(Word('Hello',.1,.5),Word('Again',2.1,2.5)),attribution_turns=exclusive)
    assert [item.speaker_id for item in result.transcript.items]==['speaker-2','speaker-1']
    assert _speaker_turn_ranges_by_id(regular)=={'speaker-1':[(0.,3.)],'speaker-2':[(0.,4.)]}


def test_cpu_speaker_failure_preserves_text_without_credentials(tmp_path):
    settings=make_settings(tmp_path,sample_processing_ffmpeg_command=str(ffmpeg_fake_command(tmp_path/'ffmpeg')))
    processor=TranscriptionSampleProcessor(settings)
    processor._transcriber=SimpleNamespace(transcribe=lambda *args:(Word('Hello',0.,1.),))
    def fail(*args):
        raise InferenceError('Missing token.',503)
    processor._diarizer=SimpleNamespace(diarize=fail)
    stages={}
    result=asyncio.run(processor._cpu(tmp_path/'audio.wav',{'language':'en','detectSpeakers':True},stages.update))
    assert result['words'][0]['text']=='Hello'
    assert result['warnings']
    assert stages['diarization']['status']=='error'
    assert 'diarization' not in result
