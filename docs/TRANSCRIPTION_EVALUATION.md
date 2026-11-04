# Local Transcription Evaluation

Keep the corpus and generated reports under ignored `storage/transcription-evaluation/`. Never commit recordings, reference transcripts, or raw model output. Run with `PYTHONPATH=transcription/src .venv/bin/python -m voice_transcription.evaluate MANIFEST --mode baseline --output REPORT` to measure the existing `medium/cpu/int8` ASR baseline. The baseline command requires faster-whisper in that environment. Use `--mode evaluate` for captured native-worker or Meetily output. Model downloads must be prepared before timed runs.

A manifest is a JSON object with `schema_version: 1`, `configuration` (engine, model, revision, device, application version), and `recordings`. Each recording has an opaque `id`, `category`, `audio`, `reference`, `duration_seconds`, `language`, `condition` (`cold` or `warm`), and, for evaluation, `hypothesis`. Paths are relative to the manifest. Use opaque identifiers rather than filenames or personal names.

Reference and hypothesis JSON contain `text`, optional `words` (text, start_seconds, end_seconds, optional speaker_label), and optional `turns` (start_seconds, end_seconds, speaker_label). Hypotheses also contain independently measured `asr_seconds` and `total_seconds`. References can list `names` and `numbers` for term recall. Invalid word alignment must set `has_word_alignment: false` and is excluded from timing comparisons. Annotate short excerpts carefully; do not treat model-generated text as reviewed ground truth.

Word error rate uses case-folded word tokens, retaining apostrophes and ignoring punctuation. Empty-reference recordings report insertion counts rather than a misleading WER. Speaker error uses optimal anonymous-speaker matching over complete annotated timelines (up to eight speakers), with no forgiveness collar and overlaps included. Timestamp p95 uses exact matching word blocks; report matching coverage alongside it. Names/numbers report missing terms separately. Also manually audit chunk seams, legitimate repetitions, and speaker changes.

Reports contain aggregate per-clip metrics, configuration, host platform, and process peak RSS. Peak RSS is a process lifetime maximum, not combined worker memory. Measure combined parent/child RSS separately during native benchmarks. Missing annotation metrics remain null and cannot establish qualification.

Compare the same corpus for every engine and the Meetily import workflow. Record application version, model revision/quantization, language, preprocessing, hardware, power mode, and cold/warm state. Include narration, accents, interviews, meetings, terminology, noise, silence, overlap, and complete 30-minute/two-hour files. ASR-only timings must not be presented as end-to-end timings.

## Capture And Gate

Capture a prepared native worker job into ignored storage (substitute the running worker PID to sample combined parent/child RSS):

```sh
.venv-transcription/bin/python -m voice_transcription.benchmark storage/transcription-evaluation/clip.wav --engine parakeet-mlx --worker-pid 12345 --output storage/transcription-evaluation/clip-parakeet.json
```

Add `--detect-speakers` for speaker runs. Input must be mono 16 kHz PCM16 WAV. Stop/start the worker before a cold run; repeat the same engine without a restart for a warm run. Record other running apps and power conditions. The capture contains private raw text and must never be committed. Worker RSS sampling every 250 ms is an approximation, excludes API/FFmpeg processes and may miss brief peaks; measure the full application separately for qualification. `worker_seconds` covers worker inference, `http_seconds` includes transfer/polling, and `total_seconds` remains null until independently measured through the API including normalization and speaker audio processing.

Set `reviewed_corpus: true` only after human correction. Each hypothesis may include `peak_rss_bytes`, `boundary_omissions`, and `boundary_duplicates` from measured pipeline memory and a manual seam audit. Each recording may set `synthetic: true` for diagnostic stress input; such recordings cannot establish promotion. Audio/reference content fingerprints ensure compared reports use the same corpus without exposing filenames or text. Configuration can include language, power mode, and preprocessing in addition to model/device/revision.

```sh
PYTHONPATH=transcription/src .venv/bin/python -m voice_transcription.evaluate storage/transcription-evaluation/baseline-manifest.json --output storage/transcription-evaluation/baseline-report.json
PYTHONPATH=transcription/src .venv/bin/python -m voice_transcription.evaluate storage/transcription-evaluation/parakeet-manifest.json --output storage/transcription-evaluation/parakeet-report.json
PYTHONPATH=transcription/src .venv/bin/python -m voice_transcription.qualify storage/transcription-evaluation/baseline-report.json storage/transcription-evaluation/parakeet-report.json --output storage/transcription-evaluation/default-gate.json
```

Use category IDs `clean-narration`, `accented-english`, `interview`, `multi-speaker`, `technical-names`, `background-noise`, `silence`, and `overlapping-speech`. Include short excerpts, a 30-minute recording, and a two-hour recording, with cold and warm measurements for each. The gate rejects missing references, synthetic inputs, missing memory/timing/seam measurements, worse aggregate WER, category regressions above one percentage point, worse timestamp/speaker accuracy or matching coverage, warm ASR speedup below 2×, and unimproved total processing time. Missing measurements never count as zero errors. Names/numbers are reported separately for manual review. Report sanitized aggregate results only; keep corpus fingerprints and raw manifests local if they could identify private recordings.
