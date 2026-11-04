from copy import deepcopy
import pytest
from voice_transcription.qualify import qualify, CATEGORIES


def reports():
    rows=[]
    for index, category in enumerate(sorted(CATEGORIES)):
        for condition in ('cold','warm'):
            rows.append(dict(id=str(index),condition=condition,category=category,corpus_fingerprint='fingerprint-'+str(index),
                duration_seconds=7200 if index==0 else 1800 if index==1 else 60,
                reference_words=0 if category=='silence' else 100,word_errors=0,silence_insertions=0,
                asr_seconds=20,total_seconds=30,peak_rss_bytes=1000,boundary_omissions=0,boundary_duplicates=0,
                timestamp_p95_seconds=.1,annotated_words=100,timestamp_matched_words=100,
                diarization={'rate':.05},speaker_matched_words=100,speaker_word_errors=2))
    baseline={'reviewed_corpus':True,'configuration':{'engine':'faster-whisper','model':'medium','compute_type':'int8'},'recordings':rows}
    candidate=deepcopy(baseline);candidate['configuration']={'engine':'parakeet-mlx'}
    for report in (baseline, candidate):
        report['hardware']={'system':'Darwin','processor':'Apple M2 Max','memory_bytes':96*1024**3}
        report['configuration'].update(language='en',power_mode='automatic-ac',preprocessing='mono-16khz-pcm16',revision='prepared-revision')
    for row in candidate['recordings']:row.update(asr_seconds=10,total_seconds=29)
    return baseline,candidate


def test_complete_evidence_is_required_for_promotion():
    b,c=reports()
    assert qualify(b,c)['eligible']
    assert qualify({}, {})['default_engine_id']=='faster-whisper'


@pytest.mark.parametrize('change',[
    lambda c:c.pop('reviewed_corpus'),
    lambda c:c.pop('hardware'),
    lambda c:c['configuration'].pop('revision'),
    lambda c:c['configuration'].update(language='auto'),
    lambda c:c['configuration'].update(preprocessing='other'),
    lambda c:c['configuration'].update(power_mode='low-power'),
    lambda c:c['recordings'][0].update(corpus_fingerprint='different'),
    lambda c:c['recordings'][0].update(total_seconds=None),
    lambda c:c['recordings'][0].update(synthetic=True),
    lambda c:c['recordings'][0].update(word_errors=2),
    lambda c:c['recordings'][0].update(timestamp_p95_seconds=.2),
    lambda c:c['recordings'][0].update(timestamp_matched_words=99),
    lambda c:c['recordings'][0].update(diarization={'rate':.06}),
    lambda c:c['recordings'][0].update(boundary_duplicates=1),
    lambda c:c['recordings'][1].update(asr_seconds=11),
    lambda c:c['recordings'][1].update(total_seconds=40),
    lambda c:c['recordings'][0].update(peak_rss_bytes=None),
])
def test_missing_or_regressed_measurements_keep_default(change):
    b,c=reports();change(c)
    result=qualify(b,c)
    assert not result['eligible'] and result['reasons']
    assert result['default_engine_id']=='faster-whisper'


@pytest.mark.parametrize('metric', ['duration_seconds','reference_words','word_errors','asr_seconds',
    'timestamp_matched_words','annotated_words','speaker_matched_words'])
def test_null_measurements_fail_closed(metric):
    b,c=reports();c['recordings'][0][metric]=None
    assert not qualify(b,c)['eligible']


@pytest.mark.parametrize('rows', [None,{},[None],[{}],[{'id':[]}],[{'id':'','condition':'cold'}],
    [{'id':'clip','condition':[]}],[{'id':'clip','condition':'hot'}]])
def test_malformed_recording_index_fails_closed(rows):
    b,c=reports();c['recordings']=rows
    result=qualify(b,c)
    assert not result['eligible'] and result['reasons']
    assert result['default_engine_id']=='faster-whisper'
