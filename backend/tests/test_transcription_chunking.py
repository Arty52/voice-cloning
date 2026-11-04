from types import SimpleNamespace
import pytest
from voice_transcription.chunking import windows, owned_words, parakeet_words
from voice_transcription.contracts import Word


def test_windows_cover_long_audio_without_unbounded_chunks():
    chunks=list(windows(7200))
    assert chunks[0][2]==0 and chunks[-1][3]==7200
    assert all(b-a<=120 for a,b,_,_ in chunks)
    assert all(left[3]==right[2] for left,right in zip(chunks,chunks[1:]))
    with pytest.raises(ValueError): list(windows(10,overlap=120))


def test_overlap_keeps_once_and_preserves_legitimate_repetitions():
    original=[Word('yes',111,112),Word('yes',113,114),Word('boundary',112,113)]
    result=[]
    for start,end,keep_start,keep_end in windows(150):
        local=[Word(w.text,w.start_seconds-start,w.end_seconds-start) for w in original if start<=w.start_seconds and w.end_seconds<=end]
        result.extend(owned_words(local,start,keep_start,keep_end,150))
    assert sorted(result,key=lambda w:w.start_seconds)==sorted(original,key=lambda w:w.start_seconds)


def test_subwords_are_not_presented_as_separate_words():
    pieces=[SimpleNamespace(text=t,start=i*.1,end=(i+1)*.1) for i,t in enumerate([' Un','believ','able','!',' Yes'])]
    words=list(parakeet_words(pieces))
    assert [w.text for w in words]==['Unbelievable!','Yes']
    assert words[0].start_seconds==0 and words[0].end_seconds==.4


def test_overlap_reconciles_alignment_drift_without_losing_repeated_words():
    from voice_transcription.chunking import merge_overlap
    left=[Word('yes',110.,110.5),Word('yes',111.,111.5),Word('again',112.,112.4),Word('please',113.,113.4)]
    right=[Word('yes',111.2,111.7),Word('again',112.2,112.6),Word('please',113.2,113.6),Word('now',114.,114.5)]
    merged=merge_overlap(left,right,110.,115.)
    assert [w.text for w in merged]==['yes','yes','again','please','now']
    assert all(a.start_seconds <= b.start_seconds for a,b in zip(merged,merged[1:]))


def test_malformed_parakeet_word_only_falls_back_its_sentence():
    from voice_transcription.chunking import parakeet_segments
    from voice_transcription.normalize import transcribed_words
    result=SimpleNamespace(sentences=[
        SimpleNamespace(text='Good words.', start=1.,end=2.,tokens=[SimpleNamespace(text=' Good',start=1.,end=1.5),SimpleNamespace(text=' words.',start=1.5,end=2.)]),
        SimpleNamespace(text='Keep this.', start=2.,end=4.,tokens=[SimpleNamespace(text=' Keep',start=2.,end=2.),SimpleNamespace(text=' this.',start=3.,end=4.)]),
    ])
    words=transcribed_words(list(parakeet_segments(result)))
    assert [w.text for w in words]==['Good','words.','Keep this.']
    assert words[-1].start_seconds==2. and not words[-1].has_word_alignment
    assert words[0].has_word_alignment
