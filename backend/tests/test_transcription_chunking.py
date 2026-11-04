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
