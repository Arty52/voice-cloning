from pathlib import Path
from types import SimpleNamespace
import pytest
from voice_transcription.contracts import InferenceError
from voice_transcription.legacy import FasterWhisperTranscriber, PyannoteDiarizer


def test_lazy_decoder_failure_is_sanitized():
    def broken():
        yield SimpleNamespace(text="", words=[])
        raise RuntimeError("sensitive model path")
    model = SimpleNamespace(transcribe=lambda *a, **kw: (broken(), None))
    adapter = FasterWhisperTranscriber(lambda *a, **kw: model, "medium", "cpu", "int8")
    with pytest.raises(InferenceError, match="^Whisper transcription failed.$"):
        adapter.transcribe(Path("audio.wav"))


def test_exclusive_turns_do_not_replace_regular_extraction_turns():
    regular = [(SimpleNamespace(start=0., end=2.), "a"), (SimpleNamespace(start=1., end=3.), "b")]
    exclusive = [(SimpleNamespace(start=0., end=1.), "a"), (SimpleNamespace(start=1., end=3.), "b")]
    factory = SimpleNamespace(from_pretrained=lambda *a, **kw: lambda path: SimpleNamespace(
        speaker_diarization=regular, exclusive_speaker_diarization=exclusive))
    result = PyannoteDiarizer(factory, "model", "test-token").diarize(Path("audio.wav"))
    assert result.turns[0].end_seconds == 2.
    assert result.exclusive_turns[0].end_seconds == 1.


@pytest.mark.parametrize('start,end',[(-1.,1.),(float('nan'),1.),(0.,float('inf'))])
def test_invalid_diarization_ranges_are_not_attributed(start,end):
    from voice_transcription.normalize import diarization_turns
    assert diarization_turns([(SimpleNamespace(start=start,end=end),'a')])==()
