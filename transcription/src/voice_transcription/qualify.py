"""Conservative, reproducible English default-selection gate; never edits settings."""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path

CATEGORIES = frozenset({'clean-narration','accented-english','interview','multi-speaker',
                        'technical-names','background-noise','silence','overlapping-speech'})
SPEAKER_CATEGORIES = {'interview','multi-speaker','overlapping-speech'}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def qualify(baseline: dict, candidate: dict) -> dict:
    reasons = []
    def require(condition, reason):
        if not condition and reason not in reasons:
            reasons.append(reason)
    def indexed(report):
        records = report.get('recordings', [])
        index = {(row['id'], row.get('condition')): row for row in records}
        require(len(index) == len(records), 'Duplicate recording IDs and conditions.')
        return index
    old, new = indexed(baseline), indexed(candidate)
    require(bool(old) and old.keys() == new.keys(), 'Reports must cover the same non-empty corpus and run conditions.')
    require(baseline.get('reviewed_corpus') is True and candidate.get('reviewed_corpus') is True,
            'Reviewed reference transcripts are required.')
    require(candidate.get('configuration', {}).get('engine') == 'parakeet-mlx', 'This gate only promotes Parakeet English.')
    require(baseline.get('configuration', {}).get('engine') == 'faster-whisper' and
            baseline.get('configuration', {}).get('model') == 'medium' and
            baseline.get('configuration', {}).get('compute_type') == 'int8', 'Expected the medium/int8 compatibility baseline.')
    bconfig, cconfig = baseline.get('configuration', {}), candidate.get('configuration', {})
    require(bconfig.get('language') == cconfig.get('language') == 'en', 'Matched English language settings are required.')
    require(bool(baseline.get('hardware')) and baseline.get('hardware') == candidate.get('hardware'), 'Matched recorded hardware is required.')
    for setting in ('preprocessing', 'power_mode'):
        require(bool(bconfig.get(setting)) and bconfig.get(setting) == cconfig.get(setting), f'Matched {setting} settings are required.')
    require(bool(cconfig.get('revision')), 'The candidate model revision must be recorded.')
    require(CATEGORIES <= {row.get('category') for row in new.values()}, 'Required recording categories are missing.')
    durations = [row['duration_seconds'] for row in new.values() if number(row.get('duration_seconds'))]
    require(any(1800 <= d < 3600 for d in durations) and any(d >= 7200 for d in durations) and any(0 < d <= 120 for d in durations),
            'Short excerpts, a 30-minute recording, and a two-hour recording are required.')
    for key in old.keys() & new.keys():
        b, c = old[key], new[key]
        require(bool(b.get('corpus_fingerprint')) and b.get('corpus_fingerprint') == c.get('corpus_fingerprint')
                and b.get('category') == c.get('category') and b.get('duration_seconds') == c.get('duration_seconds'),
                'Audio, references, categories, and durations must match.')
        require(not b.get('synthetic') and not c.get('synthetic'), 'Synthetic stress recordings cannot establish accuracy qualification.')
        for record in (b, c):
            require(number(record.get('word_errors')) and number(record.get('reference_words')), 'Word-error measurements are missing.')
            require(number(record.get('asr_seconds')) and record['asr_seconds'] > 0, 'ASR timings are missing.')
            require(number(record.get('total_seconds')) and number(record.get('asr_seconds')) and record['total_seconds'] >= record['asr_seconds'],
                    'Measured end-to-end timings are required; ASR time is not a total-time substitute.')
            require(number(record.get('peak_rss_bytes')) and record['peak_rss_bytes'] > 0, 'Measured pipeline peak memory is missing.')
            require(number(record.get('boundary_omissions')) and number(record.get('boundary_duplicates')), 'Chunk-boundary audits are missing.')
        for metric in ('boundary_omissions','boundary_duplicates','silence_insertions'):
            require(number(b.get(metric)) and number(c.get(metric)) and c[metric] <= b[metric], f'{metric} is missing or regresses.')
        if number(b.get('reference_words')) and b['reference_words'] > 0:
            require(number(b.get('timestamp_p95_seconds')) and number(c.get('timestamp_p95_seconds')) and
                    c['timestamp_p95_seconds'] <= b['timestamp_p95_seconds'], 'Timestamp accuracy is missing or regresses.')
            require(number(b.get('annotated_words')) and b['annotated_words'] > 0 and c.get('annotated_words') == b.get('annotated_words') and
                    number(c.get('timestamp_matched_words')) and number(b.get('timestamp_matched_words')) and c['timestamp_matched_words'] >= b['timestamp_matched_words'] > 0,
                    'Timestamp annotation or matching coverage is missing or regresses.')
        if b.get('category') in SPEAKER_CATEGORIES or b.get('diarization'):
            bd, cd = b.get('diarization') or {}, c.get('diarization') or {}
            require(number(bd.get('rate')) and number(cd.get('rate')) and cd['rate'] <= bd['rate'],
                    'Speaker diarization accuracy is missing or regresses.')
            bc, cc = b.get('speaker_matched_words', 0), c.get('speaker_matched_words', 0)
            require(number(bc) and number(cc) and bc > 0 and cc >= bc and number(b.get('speaker_word_errors')) and number(c.get('speaker_word_errors')) and
                    c['speaker_word_errors']/cc <= b['speaker_word_errors']/bc,
                    'Speaker attribution accuracy or matching coverage is missing or regresses.')
    def wer(rows):
        if not all(number(row.get('reference_words')) and number(row.get('word_errors')) for row in rows):
            return None
        words = sum(row['reference_words'] for row in rows)
        return sum(row.get('word_errors', 0) for row in rows)/words if words else None
    baseline_wer, candidate_wer = wer(list(old.values())), wer(list(new.values()))
    require(baseline_wer is not None and candidate_wer is not None and candidate_wer <= baseline_wer,
            'Aggregate word error rate is unavailable or worse than baseline.')
    for category in CATEGORIES - {'silence'}:
        bw = wer([row for row in old.values() if row.get('category') == category])
        cw = wer([row for row in new.values() if row.get('category') == category])
        require(bw is not None and cw is not None and cw-bw <= .01+1e-12, f'{category} is missing or regresses by more than one percentage point.')
    warm = [key for key in old.keys() & new.keys() if key[1] == 'warm']
    require(bool(warm) and all((key[0], 'cold') in new and (key[0], 'warm') in new for key in new),
            'Every recording requires both cold and warm measurements.')
    def summed(rows, metric):
        values = [rows[key].get(metric) for key in warm]
        return sum(values) if values and all(number(value) and value > 0 for value in values) else None
    old_asr, new_asr = summed(old, 'asr_seconds'), summed(new, 'asr_seconds')
    old_total, new_total = summed(old, 'total_seconds'), summed(new, 'total_seconds')
    speedup = old_asr/new_asr if old_asr and new_asr else None
    require(speedup is not None and speedup >= 2., 'Warm ASR must be at least twice as fast.')
    require(old_total is not None and new_total is not None and new_total < old_total, 'Warm total processing time must improve.')
    return {'schema_version':1, 'eligible':not reasons, 'default_engine_id':'faster-whisper' if reasons else 'parakeet-mlx',
            'reasons':reasons, 'baseline_wer':baseline_wer, 'candidate_wer':candidate_wer, 'warm_asr_speedup':speedup}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline',type=Path)
    parser.add_argument('candidate',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report=qualify(json.loads(args.baseline.read_text()),json.loads(args.candidate.read_text()))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print('Eligible for reviewed promotion.' if report['eligible'] else 'Keep the compatibility default; see the report for unmet gates.')

if __name__=='__main__':
    main()
