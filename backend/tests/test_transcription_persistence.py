from dataclasses import replace
from voice_cloning.models import SpeakerSeparationResult, SpeakerSeparationTranscript, SpeakerTranscriptItem
from voice_cloning.persistence.database import create_database_engine, create_session_factory, unit_of_work
from voice_cloning.persistence.models import Base
from voice_cloning.persistence.jobs import SqlAlchemySampleProcessingJobRepository
from voice_cloning.api.serializers import sample_processing_job_payload
from test_persistence import _sample_processing_job


def test_text_only_job_roundtrips_options_progress_and_provenance():
    engine = create_database_engine('sqlite+pysqlite:///:memory:')
    Base.metadata.create_all(engine)
    sessions = create_session_factory(engine)
    job = replace(_sample_processing_job('text-only'), operation_id='transcribe',
        transcription_options={'engineId':'parakeet-mlx','language':'en','detectSpeakers':False},
        transcription_progress={'asr':{'status':'success','elapsedSeconds':1.2}},
        result=SpeakerSeparationResult(kind='transcript',speakers=(),
            transcript=SpeakerSeparationTranscript((SpeakerTranscriptItem(
                id='item-1', text='Hello again.', start_seconds=1.,end_seconds=2.,speaker_id=None),)),
            metadata={'engine':'parakeet-mlx','device':'apple-gpu','warnings':[],'asr_seconds':1.2}))
    with unit_of_work(sessions) as session:
        SqlAlchemySampleProcessingJobRepository(session).save_job(job)
    with unit_of_work(sessions) as session:
        restored = SqlAlchemySampleProcessingJobRepository(session).get_job(job.id)
    assert restored == job
    payload = sample_processing_job_payload(restored)
    assert payload['result']['transcript']['items'][0]['speakerId'] is None
    assert payload['result']['metadata']['device'] == 'apple-gpu'
    assert payload['transcriptionOptions']['detectSpeakers'] is False
