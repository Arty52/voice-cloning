# Native Apple Silicon Transcription

The web app, API, and PostgreSQL continue running in Docker on the existing ports (4340 and 6420). A separate Python 3.12 worker listens on `127.0.0.1:6421`. Parakeet MLX supports English; Whisper Large V3 MLX supports the languages exposed in the selector. Both run ASR on the Apple GPU. Speech detection and optional pyannote Community-1 speaker detection run on CPU. Only one job is active; ASR and diarization may overlap within that job.

## Setup

Use a native arm64 Python 3.12 installation and FFmpeg on macOS. From the repository root:

```sh
make worker-setup
make worker-prepare MODEL=parakeet-mlx
make worker-prepare MODEL=whisper-mlx
make worker-start
make worker-doctor
```

Setup creates `.venv-transcription/` and a private random token in `storage/transcription-worker/token` with mode 0600. Models, download caches, temporary audio, and logs remain under that ignored runtime directory. Model preparation is explicit and pinned to the revisions in `transcription/src/voice_transcription/catalog.py`. Start does not download models. Doctor reports preparation and live authenticated worker availability separately. Model switching releases the previous ASR model from the supervised process.

For optional speaker detection, accept the Hugging Face conditions for `pyannote/speaker-diarization-community-1`, supply an authorized token through `HF_TOKEN` in the shell environment, and run:

```sh
make worker-prepare MODEL=diarization
```

Do not commit or paste the token into commands, documentation, screenshots, or frontend settings. Model preparation also caches pyannote dependencies. Prepared jobs run with Hugging Face offline mode; missing speaker preparation produces a text-only result and an explicit warning. Text-only ASR needs no speaker credentials.

Add these values to your ignored `.env` for Docker:

```dotenv
TRANSCRIPTION_WORKER_URL=http://host.docker.internal:6421
TRANSCRIPTION_WORKER_TOKEN_PATH=/app/storage/transcription-worker/token
```

Rebuild/recreate the API to install the shared inference package and load configuration:

```sh
docker compose up -d --build api web
```

For an API running directly on the host, use `http://127.0.0.1:6421` and the absolute token-file path. Docker Desktop host connectivity must be working; an unavailable worker is shown in the selector. Keep the worker bound to localhost. The API sends normalized mono 16 kHz PCM16 WAV bytes over authenticated HTTP; callers cannot submit arbitrary local paths. No provider key is sent to the worker.

Open **Transcript**, choose an engine and language, and leave **Detect Speakers** enabled or switch it off. Choices persist in browser storage. **Refresh Availability** checks availability again after preparation or restart. Native engines show elapsed time and measured stages instead of the CPU file-size estimate. Results retain the actual model revision, ASR device, optional CPU speaker device, timings, and warnings. Missing speaker assignments disable speaker-derived voice extraction; transcript editing, playback, and exports remain available.

## Recovery And Rollback

Cancel terminates the native inference children and releases the active job slot. Failed or canceled attempts retain the selected upload for **Retry Transcript**. An engine failure never silently switches engines. If a process crashes, retry after refreshing availability; if necessary run `make worker-stop` then `make worker-start`. Inspect the ignored `storage/transcription-worker/worker.log` for local diagnostics.

Choose **Whisper CPU** to switch back. Saved transcripts keep their original engine metadata and remain editable; engine selection affects the next job. CPU transcription requires the existing `backend[diarization]` dependencies (`INSTALL_DIARIZATION=1` for Docker) and local transcription enabled via worker configuration or `SAMPLE_PROCESSING_ENABLE_DIARIZATION=1`. Keep `SAMPLE_PROCESSING_WHISPER_MODEL=medium`, `SAMPLE_PROCESSING_WHISPER_DEVICE=cpu`, and `SAMPLE_PROCESSING_WHISPER_COMPUTE_TYPE=int8` for the baseline.

To disable native integration, clear both `TRANSCRIPTION_WORKER_*` entries, keep `SAMPLE_PROCESSING_ENABLE_DIARIZATION=1` for CPU transcription, recreate the API, and run `make worker-stop`. Do not delete PostgreSQL volumes, source audio, or saved job JSON. No database schema migration is introduced. Legacy `separateSpeakers` jobs and Prepare Audio remain supported.

## Qualification Status

The English default remains **Whisper CPU**. The M2 Max smoke and synthetic stress results are documented separately; they do not establish corpus accuracy, speaker attribution, or timestamp accuracy. Promotion requires reviewed references, all recording categories, matched cold/warm runs, full pipeline timings, and the conservative gate in `voice_transcription.qualify`. A positive gate report still requires a reviewed default change; the command never changes app settings.
