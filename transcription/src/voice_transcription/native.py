"""Native Apple inference. Imports are lazy; jobs never download models."""
from dataclasses import asdict
import gc
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
from .catalog import DIARIZATION_REPO, DIARIZATION_REVISION, model_for, model_path, ready
from .chunking import windows, owned_words, parakeet_segments, merge_overlap
from .contracts import InferenceError
from .normalize import transcribed_words, diarization_turns


def prepare(root: Path, engine_id: str):
    configure_runtime(root)
    from huggingface_hub import snapshot_download
    if engine_id == 'diarization':
        repo, revision = DIARIZATION_REPO, DIARIZATION_REVISION
        destination = root/'models'/'diarization'/revision
    else:
        model = model_for(engine_id)
        repo, revision = model.repository, model.revision
        destination = model_path(root, model)
    destination.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo, revision=revision, local_dir=destination, token=os.environ.get('HF_TOKEN') or None)
    if engine_id == 'diarization':
        from pyannote.audio import Pipeline
        os.environ['PYANNOTE_METRICS_ENABLED'] = '0'
        Pipeline.from_pretrained(str(destination))
    (destination/'.prepared').write_text(revision+'\n')


class NativeInference:
    def __init__(self):
        self.model = None
        self.engine_id = None
        self.vad = None
        self.pipeline = None

    def run(self, stage: str, source: Path, root: Path, options: dict):
        configure_runtime(root)
        if stage == 'diarization':
            return self.diarize(source, root)
        return self.transcribe(source, root, options)

    def diarize(self, source: Path, root: Path):
        path = root/'models'/'diarization'/DIARIZATION_REVISION
        if not ready(path):
            raise InferenceError('Prepare speaker detection first.', 503)
        if self.pipeline is None:
            from pyannote.audio import Pipeline
            self.pipeline = Pipeline.from_pretrained(str(path))
            import torch
            self.pipeline.to(torch.device('cpu'))
        output = self.pipeline(str(source))
        regular = diarization_turns(output)
        exclusive = diarization_turns(getattr(output, 'exclusive_speaker_diarization', output))
        if not regular:
            raise InferenceError('No speakers detected.', 422)
        return {'turns':[asdict(x) for x in regular], 'exclusive_turns':[asdict(x) for x in exclusive],
                'model':DIARIZATION_REPO, 'revision':DIARIZATION_REVISION, 'device':'cpu'}

    def transcribe(self, source: Path, root: Path, options: dict):
        import mlx.core as mx
        import soundfile as sf
        import torch
        from silero_vad import load_silero_vad, get_speech_timestamps
        model = model_for(options['engineId'])
        path = model_path(root, model)
        if not ready(path) or not mx.metal.is_available():
            raise InferenceError('Prepared model and Apple GPU are required.', 503)
        mx.set_default_device(mx.gpu)
        if self.engine_id != model.id:
            self.model = None
            gc.collect()
            mx.clear_cache()
            if model.id == 'parakeet-mlx':
                from parakeet_mlx import from_pretrained
                self.model = from_pretrained(str(path))
            self.engine_id = model.id
        if self.vad is None:
            self.vad = load_silero_vad()
        all_words = []
        previous_end = 0.
        chunk_length, overlap = (120., 15.) if model.id == "parakeet-mlx" else (30., 5.)
        with sf.SoundFile(source) as audio:
            duration = len(audio)/audio.samplerate
            for start, end, _, _ in windows(duration, chunk_length, overlap):
                audio.seek(round(start*16000))
                chunk = audio.read(round((end-start)*16000), dtype='float32')
                # Only skip chunks confidently containing no speech; never concatenate
                # separated speech regions, which would destroy source timestamps.
                speech = get_speech_timestamps(torch.from_numpy(chunk), self.vad, sampling_rate=16000,
                    threshold=.3, min_speech_duration_ms=100, speech_pad_ms=400)
                if not speech:
                    continue
                if model.id == 'parakeet-mlx':
                    with tempfile.NamedTemporaryFile(suffix='.wav', dir=source.parent) as part:
                        sf.write(part.name, chunk, 16000, subtype='PCM_16')
                        result = self.model.transcribe(part.name)
                    segments = list(parakeet_segments(result))
                else:
                    import mlx_whisper
                    result = mlx_whisper.transcribe(chunk, path_or_hf_repo=str(path),
                        language=None if options['language']=='auto' else options['language'],
                        word_timestamps=True, verbose=False, condition_on_previous_text=False, compression_ratio_threshold=None)
                    segments = [SimpleNamespace(**{**s, 'words':[SimpleNamespace(**w) for w in s.get('words', [])]}) for s in result['segments']]
                words = transcribed_words(segments)
                shifted = list(owned_words(words, start, start, end, duration))
                all_words = merge_overlap(all_words, shifted, start, previous_end) if start < previous_end else all_words + shifted
                previous_end = end
        return {'words':[asdict(w) for w in all_words], 'text':' '.join(w.text for w in all_words),
                'engine':model.id, 'model':model.repository, 'revision':model.revision,
                'device':'apple-gpu', 'language':options['language'], 'duration_seconds':duration,
                'warnings':['Some passages use segment timing because word alignment was unavailable.'] if any(not w.has_word_alignment for w in all_words) else []}


def configure_runtime(root: Path):
    # All downloadable/runtime caches stay inside the ignored worker root.
    os.environ['HF_HOME'] = str(root/'hf-cache')
    os.environ['HF_HUB_CACHE'] = str(root/'hf-cache'/'hub')
    os.environ['TORCH_HOME'] = str(root/'torch-cache')
    os.environ['MPLCONFIGDIR'] = str(root/'matplotlib-cache')
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['PYANNOTE_METRICS_ENABLED'] = '0'
