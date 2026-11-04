import json
from voice_transcription.evaluate import evaluate, diarization_error, run_manifest


def test_edit_errors_and_silence():
    assert evaluate({'text':'one two three'}, {'text':'One too three four'})['word_errors'] == 2
    assert evaluate({'text':''}, {'text':'invented speech'})['silence_insertions'] == 2
    assert evaluate({'text':''}, {'text':''})['wer'] is None


def test_speaker_mapping_and_overlap():
    def turn(s, e, speaker):
        return dict(start_seconds=s, end_seconds=e, speaker_label=speaker)
    ref = [turn(0, 2, 'a'), turn(1, 3, 'b')]
    hyp = [turn(0, 2, 'speaker2'), turn(1, 3, 'speaker1')]
    assert diarization_error(ref, hyp)['rate'] == 0
    assert diarization_error(ref, [])['rate'] == 1


def test_timing_requires_real_alignment():
    word = dict(text='hello', start_seconds=0., end_seconds=1.)
    result = evaluate({'text':'hello', 'words':[word]}, {'text':'hello', 'words':[{**word, 'start_seconds':.1}]})
    assert result['timestamp_p95_seconds'] == .1
    result = evaluate({'text':'hello', 'words':[word]}, {'text':'hello', 'words':[{**word, 'has_word_alignment':False}]})
    assert result['timestamp_p95_seconds'] is None


def test_report_has_no_transcript_or_paths(tmp_path):
    (tmp_path/'reference.json').write_text(json.dumps({'text':'private content'}))
    (tmp_path/'hypothesis.json').write_text(json.dumps({'text':'private content', 'asr_seconds':2}))
    manifest={'schema_version':1, 'recordings':[{'id':'clip-1','category':'narration','reference':'reference.json','hypothesis':'hypothesis.json','duration_seconds':3}]}
    (tmp_path/'manifest.json').write_text(json.dumps(manifest))
    run_manifest(tmp_path/'manifest.json', 'evaluate', tmp_path/'report.json')
    result=(tmp_path/'report.json').read_text()
    assert 'private content' not in result
    assert str(tmp_path) not in result
    assert 'reference.json' not in result
    assert json.loads(result)['recordings'][0]['total_seconds'] is None
    assert json.loads(result)['recordings'][0]['corpus_fingerprint'] is None


def test_corpus_fingerprint_tracks_content_not_location(tmp_path):
    from voice_transcription.evaluate import _fingerprint
    audio,reference=tmp_path/'audio',tmp_path/'reference'
    audio.write_bytes(b'audio');reference.write_text('reference')
    first=_fingerprint(audio,reference)
    moved=tmp_path/'moved';audio.rename(moved)
    assert _fingerprint(moved,reference)==first
    reference.write_text('corrected')
    assert _fingerprint(moved,reference)!=first
