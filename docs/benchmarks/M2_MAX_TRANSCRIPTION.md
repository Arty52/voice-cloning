# M2 Max Transcription Qualification

Status on 2026-11-04: **Implementation smoke-tested; accuracy qualification incomplete. Whisper CPU remains the default.** The user has no reviewed corpus. The new engines are explicit opt-in choices, with no automatic fallback or transcript rewriting.

## Environment And Method

Apple M2 Max, 96 GiB unified memory, macOS 26.6.2, arm64. Native Python 3.12.13, MLX 0.32.4, Parakeet MLX 0.7.0, MLX Whisper 0.4.3; baseline Docker Python 3.14.2, faster-whisper `medium/cpu/int8`. The Mac reported automatic power mode; power source and other workloads were not controlled. Models were downloaded before measurement. See [sanitized measurements](m2-max-transcription-smoke.json) for exact pinned revisions, hardware, timings, and limitations.

The common smoke input was the public 11-second, 22-word [whisper.cpp JFK sample](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav). Its content hash is retained in the measurements. Audio, reference text, and raw hypotheses remain in ignored local storage. The reference was checked for this short smoke test; it does not constitute the requested reviewed mixed-recording corpus. Case and punctuation are normalized by the evaluation runner.

| Engine | Cold Direct ASR | Warm Direct ASR | Word Errors |
| --- | ---: | ---: | ---: |
| Existing Whisper Medium CPU / Int8 | 4.95 s | 3.11 s | 0 / 22 |
| Parakeet TDT 0.6B V2 / MLX | 16.50 s | 0.23 s | 0 / 22 |
| Whisper Large V3 / MLX | 18.82 s | 1.00 s | 0 / 22 |

These are single observations, not statistically robust benchmarks. Native cold timings include dependency imports and model loading; the CPU cold measurement excludes dependency imports, so cold figures are not equivalent. Warm Parakeet ASR was about 13.6× faster on this one short clip. This does not establish performance or accuracy across the target corpus.

## Meetily File Import

The official [Meetily v0.4.1 Apple Silicon release](https://github.com/Zackriya-Solutions/meetily/releases/tag/v0.4.1) was launched locally. The downloaded application archive SHA-256 was `89c695ac5471d0f983de8fbd0e450193698fa2bba534d0c32b33c309a0a17ebf`. Microphone/system-audio permissions were skipped; only file import was tested. Its installed default was **Parakeet `parakeet-tdt-0.6b-v3-int8` (670 MB), automatic language**, which differs from the older repository snapshot in the assessment.

The same file imported successfully with 0/22 word errors. Completion was visible at the next UI snapshot, within 3.646 seconds of the import action. This is an observation upper bound, not precise ASR or end-to-end timing; no speed ranking against Meetily is supported. No summary was generated. All four configurations transcribed this short sample correctly, so the test does not establish an accuracy winner.

## Native Worker And Full API

After restarting the final worker, Parakeet and CPU Community-1 ran concurrently on the same short clip:

| Measurement | Cold Worker | Warm Worker |
| --- | ---: | ---: |
| ASR Stage | 1.80 s | 0.35 s |
| Worker Inference Total | 19.99 s | 0.67 s |
| HTTP Transfer And Polling Total | 20.19 s | 0.80 s |
| Sampled Worker + Child RSS | 3.17 GiB | 3.17 GiB |

The worker measurement includes process startup/loading outside individual stage timers. RSS was sampled every 250 ms and excludes the API and FFmpeg. It is not a whole-pipeline peak-memory qualification.

A subsequent warm API job completed normalization, ASR, speaker detection, and speaker audio extraction in **1.24 seconds**. It returned one assigned speaker, playable extracted audio, exact model revisions, `apple-gpu` ASR, `cpu` diarization, and no warnings. ASR was 0.33 s, CPU diarization 0.63 s, normalization 0.03 s, and speaker audio processing 0.19 s. Overlapping stages should not be summed as elapsed time.

The app preview verified text-only transcription, original-audio playback, reload restoration, engine selection persistence, and switching to the compatibility engine while preserving the saved native transcript. A busy-worker failure exposed and led to a fix for retaining the selected file for retry. Automated tests cover corrections, exports, speaker saving, partial speaker failure, cancellation, worker crashes, old jobs, JSON persistence, and unchanged Prepare Audio behavior.

## Bounded Long-File Stress

Synthetic files repeated the public sample to exact lengths; the silence file contained zero-valued PCM. These tests exercise chunking and timestamps, not natural-recording accuracy.

| Engine | Input | ASR Time | Output Word Count | Expected Approximate Count |
| --- | --- | ---: | ---: | ---: |
| Parakeet MLX | 3-minute silence | 1.74 s | 0 | 0 |
| Whisper MLX | 3-minute silence | 0.80 s | 0 | 0 |
| Parakeet MLX | 30-minute repetition | 27.36 s | 3,600 | 3,600 |
| Whisper MLX | 30-minute repetition | 182.65 s | 3,629 | 3,600 |
| Parakeet MLX | 2-hour repetition | 94.70 s | 14,402 | 14,400 |
| Whisper MLX | 2-hour repetition | 725.46 s | 14,506 | 14,400 |

All returned timestamps were within the recording and starts were nondecreasing. Count differences do not identify which words were inserted or omitted; equal totals do not prove correct seams. Both engines need real-corpus seam audits. No reviewed timestamp/speaker annotations or long-run pipeline memory measurements were available.

Native stress testing found and fixed sentence-level fallback propagation and overlap reconciliation, preserving legitimate repetitions at different times. Additional lifecycle checks cover cancellation during upload, actual inference-process termination, replacement of queues after crashes/cancellation, and authenticated readiness. Prepared inference ran offline; speaker failures preserve ASR text.

## Default Decision And Reproduction

The [gate report](m2-max-default-gate.json) is **ineligible**. Missing evidence includes the reviewed mixed corpus, annotated speaker/timestamp accuracy, per-category nonregression, complete matched end-to-end timing, seam audits, and pipeline memory. The compatibility default stays unchanged even though short-clip warm ASR is promising.

Follow [setup and rollback](../NATIVE_TRANSCRIPTION.md) and the [evaluation runner instructions](../TRANSCRIPTION_EVALUATION.md). Run the same normalized files and reviewed references through CPU, both MLX engines, and Meetily file import. Record the application/model versions, power conditions, and preprocessing; stop/start for cold runs and repeat the same engine for warm runs. Synthetic repetitions are diagnostics only. Re-run the gate after all acceptance categories and annotations exist. The gate reports eligibility but never changes settings itself.
