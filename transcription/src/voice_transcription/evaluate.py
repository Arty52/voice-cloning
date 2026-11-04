"""Local corpus evaluation. Reports exclude audio paths and transcript content."""
from __future__ import annotations
import argparse
from dataclasses import asdict
from difflib import SequenceMatcher
import itertools
import json
import math
from pathlib import Path
import platform
import re
import time


def process_peak_rss_bytes():
    try:
        import resource
    except ImportError:
        return None
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if platform.system() == 'Darwin' else 1024)


def tokens(text: str) -> list[str]:
    return re.findall(r"\w+(?:'\w+)?", text.casefold())


def edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    row = list(range(len(hypothesis) + 1))
    for i, expected in enumerate(reference, 1):
        following = [i]
        for j, actual in enumerate(hypothesis, 1):
            following.append(min(row[j] + 1, following[-1] + 1, row[j - 1] + (expected != actual)))
        row = following
    return row[-1]


def diarization_error(reference: list[dict], hypothesis: list[dict]) -> dict | None:
    if not reference:
        return None
    ref_ids = sorted({x['speaker_label'] for x in reference})
    hyp_ids = sorted({x['speaker_label'] for x in hypothesis})
    if max(len(ref_ids), len(hyp_ids)) > 8:
        raise ValueError('Evaluation supports up to eight speakers per annotated excerpt.')
    boundaries = sorted({x[k] for x in reference + hypothesis for k in ('start_seconds', 'end_seconds')})
    intervals = []
    for a, b in zip(boundaries, boundaries[1:]):
        mid = (a + b) / 2
        r = {x['speaker_label'] for x in reference if x['start_seconds'] <= mid < x['end_seconds']}
        h = {x['speaker_label'] for x in hypothesis if x['start_seconds'] <= mid < x['end_seconds']}
        intervals.append((b-a, r, h))
    targets = ref_ids + [None] * max(0, len(hyp_ids)-len(ref_ids))
    best = None
    best_map = {}
    for assignment in itertools.permutations(targets, len(hyp_ids)):
        mapping = dict(zip(hyp_ids, assignment))
        errors = sum(duration * (max(len(r), len(h)) - len(r & {mapping[x] for x in h})) for duration, r, h in intervals)
        if best is None or errors < best:
            best, best_map = errors, mapping
    total = sum(duration * len(r) for duration, r, _ in intervals)
    return {'error_seconds': best or 0., 'reference_seconds': total, 'rate': (best or 0.) / total if total else None, 'mapping': best_map}


def evaluate(reference: dict, hypothesis: dict) -> dict:
    expected, actual = tokens(reference['text']), tokens(hypothesis.get('text', ''))
    errors = edit_distance(expected, actual)
    result = {'reference_words': len(expected), 'word_errors': errors,
              'wer': errors / len(expected) if expected else None,
              'silence_insertions': len(actual) if not expected else 0}
    for name in ('names', 'numbers'):
        terms = reference.get(name, [])
        result[f'{name}_errors'] = sum(not all(actual.count(word) >= count for word, count in
            ((word, tokens(term).count(word)) for word in set(tokens(term)))) for term in terms)
        result[f'{name}_count'] = len(terms)
    ref_words, hyp_words = reference.get('words', []), hypothesis.get('words', [])
    timing_errors = []
    attributed_errors = 0
    attributed_count = 0
    diarization = diarization_error(reference.get('turns', []), hypothesis.get('turns', []))
    if ref_words and hyp_words:
        matcher = SequenceMatcher(None, [tuple(tokens(w['text'])) for w in ref_words], [tuple(tokens(w['text'])) for w in hyp_words], autojunk=False)
        for block in matcher.get_matching_blocks():
            for n in range(block.size):
                r, h = ref_words[block.a+n], hyp_words[block.b+n]
                if h.get('has_word_alignment', True):
                    timing_errors.extend(abs(r[k]-h[k]) for k in ('start_seconds', 'end_seconds'))
                if r.get('speaker_label') is not None and diarization:
                    attributed_count += 1
                    attributed_errors += diarization['mapping'].get(h.get('speaker_label')) != r['speaker_label']
    timing_errors.sort()
    result.update(timestamp_p95_seconds=timing_errors[max(0, math.ceil(.95*len(timing_errors))-1)] if timing_errors else None,
                  timestamp_matched_words=len(timing_errors)//2, annotated_words=len(ref_words),
                  speaker_word_errors=attributed_errors, speaker_matched_words=attributed_count,
                  diarization={k:v for k,v in diarization.items() if k != 'mapping'} if diarization else None)
    return result


def run_manifest(manifest_path: Path, mode: str, output: Path) -> dict:
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('schema_version') != 1:
        raise ValueError('Expected corpus schema_version 1.')
    base = manifest_path.parent
    transcriber = None
    if mode == 'baseline':
        from faster_whisper import WhisperModel
        from .legacy import FasterWhisperTranscriber
        transcriber = FasterWhisperTranscriber(WhisperModel, 'medium', 'cpu', 'int8')
    records = []
    for entry in manifest['recordings']:
        reference = json.loads((base / entry['reference']).read_text())
        started = time.perf_counter()
        if transcriber:
            words = transcriber.transcribe(base / entry['audio'], None if entry.get('language') in (None, 'auto') else entry['language'])
            hypothesis = {'text': ' '.join(w.text for w in words), 'words': [asdict(w) for w in words]}
            elapsed = time.perf_counter()-started
        else:
            hypothesis = json.loads((base / entry['hypothesis']).read_text())
            elapsed = hypothesis.get('asr_seconds')
        records.append({'id': entry['id'], 'category': entry['category'], 'duration_seconds': entry['duration_seconds'],
                        'condition': entry.get('condition', 'cold'), 'asr_seconds': elapsed,
                        'total_seconds': hypothesis.get('total_seconds', elapsed), **evaluate(reference, hypothesis)})
    report = {'schema_version':1, 'configuration': {k:v for k,v in manifest.get('configuration', {}).items() if k in ('engine','model','revision','device','compute_type','application_version','language','power_mode','preprocessing')} if mode != 'baseline' else
              {'engine':'faster-whisper', 'model':'medium', 'device':'cpu', 'compute_type':'int8'},
              'hardware': {'system': platform.system(), 'machine': platform.machine(), 'processor': platform.processor()},
              'process_peak_rss_bytes': process_peak_rss_bytes(),
              'recordings': records}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2)+'\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--mode', choices=['baseline', 'evaluate'], default='evaluate')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    run_manifest(args.manifest, args.mode, args.output)

if __name__ == '__main__':
    main()
