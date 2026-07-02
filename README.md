# Voice Clone Lab

Voice Clone Lab is a local-first voice studio for experimenting with provider-backed voice cloning from your own browser. It gives you a sidebar workflow for preparing samples, managing voices, generating speech, reviewing generated audio, and keeping provider keys plus usage controls in one local workspace.

![Screenshot of the Voice Clone Lab desktop Voice Studio showing the workflow sidebar, the Overview landing section, intro copy, workflow map cards, and local workspace notes.](docs/assets/voice-studio-desktop.png)

Public-safe demo screenshot: this capture uses mocked data and does not include real API keys, voice samples, generated audio files, or account details. A mobile workflow navigation capture is available in [docs/assets/voice-studio-mobile.png](docs/assets/voice-studio-mobile.png).

## What This Is

- A local development tool for testing provider-backed voice cloning with built-in ElevenLabs support.
- A Docker Compose app with a React + TypeScript frontend and Python FastAPI backend.
- A browser workspace for saving named voice samples, choosing a voice, selecting a model, tuning generation settings, checking quota, navigating workflow sections, and downloading generated speech.

## What This Is Not

- Not a hosted service.
- Not a production authentication, billing, or user-management system.
- Not bundled with any voice sample or API key.
- Not a way to avoid provider usage, billing, consent, or content policies.

## Try It Locally

Clone the repository:

```sh
git clone https://github.com/Arty52/voice-cloning.git
cd voice-cloning
```

Create a local environment file:

```sh
cp .env.example .env
```

Optionally add an ElevenLabs key to `.env` as a backend fallback. You can also add a browser-local key from `Provider & Usage` instead.

```sh
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Start the app:

```sh
make up
```

Docker Compose starts the frontend, backend, and a required local PostgreSQL 18.4 service. The database uses a named volume mounted at `/var/lib/postgresql` with `PGDATA=/var/lib/postgresql/18/docker`, matching the PostgreSQL 18 image layout. The API container applies Alembic migrations before Uvicorn starts. Host-only development can leave `DATABASE_URL` blank during the transition; compose injects the backend database URL automatically.

Open the Voice Studio:

```text
http://localhost:4340
```

The local API runs on:

```text
http://localhost:6420
```

## Public-Safe Defaults

- API keys stay local to `.env` or browser-local storage and are never returned by the API.
- Real voice samples under `assets/voices/` are ignored by git.
- Local voice sample files stay under `VOICE_ASSETS_DIR`, which defaults to ignored `assets/voices/`.
- When `DATABASE_URL` is configured, voice library metadata is stored in Postgres and existing `assets/voices/voices.json` entries are imported idempotently. When it is blank, the ignored voice manifest remains the local source of truth.
- Generated audio and provider cache data under `storage/` are ignored by git.
- Server-side generated-audio archive files are stored under `GENERATED_AUDIO_STORAGE_DIR`, which defaults to ignored `storage/generated-audio/`.
- When backend persistence is configured, generated-audio archive metadata is stored in Postgres and files stream from `GENERATED_AUDIO_STORAGE_DIR`. Browser IndexedDB remains the transition cache/draft store.
- Optional server-side generated-audio export is enabled only by setting `GENERATED_AUDIO_EXPORT_DIR`; export actions mirror canonical archive files into that backend-owned root and never accept browser-submitted filesystem paths.
- Non-secret app preferences such as selected model, Natural Handoffs, and generated-audio storage limit can persist through the backend settings API when `DATABASE_URL` is configured. Provider API keys are not persisted in Postgres.
- Speech job output, optional sample-processing output, separated stems, and downloaded model data are runtime-only and must stay out of git.
- The optional live smoke test calls ElevenLabs, may consume credits, and may create or reuse a cloned voice.

## Common Workflow

The Voice Studio opens on `Overview`. Use the sidebar to move between stable workflow sections:

1. `Prepare Audio` (`#prepare`, optional step 0): choose Add Voice for ready samples or Process Source Media for cleanup, trimming, and speaker extraction before saving.
2. `Voices` (`#voices`, step 1): select, preview, rename, and manage local voice samples, then save default voice tuning for future generations.
3. `Generate Speech` (`#generate`, step 2): enter text, optionally assign selected text spans to saved voices, generate speech with saved voice defaults, play combined and segment results, and regenerate individual multi-voice segments with contextual overrides.
4. `Generated Audio` (`#archive`, optional): review, download, remove, or clear saved generated audio, including Multi-Voice metadata for combined speech jobs. With backend persistence configured, the archive streams from the server; otherwise it falls back to browser IndexedDB.
5. `Provider & Usage` (`#provider`): add browser-local provider keys, confirm `.env` fallback, choose models, and review quota/cost metadata.

## Optional Sample Processing

The Docker backend includes FFmpeg because multi-voice speech jobs use it to assemble segment audio. Sample Processing is still disabled by default. To enable Trim Silence only, set:

```sh
INSTALL_SAMPLE_PROCESSING=1
SAMPLE_PROCESSING_ENGINE=ffmpeg
SAMPLE_PROCESSING_FFMPEG_COMMAND=ffmpeg
SPEECH_JOB_SEGMENT_GAP_MS=250
```

To enable Isolate Voice and Trim Silence together, install Demucs and FFmpeg in the backend runtime and set:

```sh
INSTALL_SAMPLE_PROCESSING=1
SAMPLE_PROCESSING_ENGINE=demucs
SAMPLE_PROCESSING_DEMUCS_MODEL=htdemucs
SAMPLE_PROCESSING_FFMPEG_COMMAND=ffmpeg
SAMPLE_PROCESSING_FFPROBE_COMMAND=ffprobe
```

To enable Speaker Separation, install the diarization extra and FFmpeg, accept the Hugging Face model conditions for `pyannote/speaker-diarization-community-1`, and provide a Hugging Face token:

```sh
INSTALL_DIARIZATION=1
SAMPLE_PROCESSING_ENABLE_DIARIZATION=1
SAMPLE_PROCESSING_HF_TOKEN=hf_...
SAMPLE_PROCESSING_WHISPER_MODEL=medium
SAMPLE_PROCESSING_WHISPER_DEVICE=cpu
SAMPLE_PROCESSING_WHISPER_COMPUTE_TYPE=int8
PYANNOTE_METRICS_ENABLED=0
```

The Docker build uses CPU-only PyTorch, Torchaudio, and TorchCodec wheels when `INSTALL_SAMPLE_PROCESSING=1` or `INSTALL_DIARIZATION=1`, then installs the requested optional backend extras. Rebuild with `make recycle` after changing either flag. The backend calls FFmpeg and FFprobe as external commands, stores multi-voice speech job output under ignored `storage/speech-jobs/`, normalizes provider-facing voice samples and successful sample-processing results to mono 16 kHz WAV, and stores sample-processing job output under ignored `storage/sample-processing/`. Active provider samples are capped by `MAX_UPLOAD_BYTES`, full staged source media uploads are capped by `MAX_SOURCE_UPLOAD_BYTES`, and selected extracted source audio is capped by `MAX_SELECTED_SOURCE_AUDIO_BYTES`; both source caps default to 1 GB. Process Source Media accepts Audio File uploads for MP3, WAV, M4A, M4B, AAC, OGG, and FLAC, plus Video File uploads for local `.mp4`, `.m4v`, and `.mov` clips. Video source jobs require a selected chapter or manual range, extract the first audio stream to mono 16 kHz WAV, and do not process the full file by default. Demucs, pyannote, and faster-whisper model files and caches are runtime data under ignored `storage/model-cache/`. Isolate Voice includes Fast, Balanced, Clean, and Max Isolation strength presets; Balanced preserves the default behavior. Trim Silence includes Light, Balanced, and Aggressive trim presets; Balanced is the default. Speaker Separation is V1 diarized speaker-turn extraction, not neural unmixing of simultaneous speakers. Prepare Voice ranks provider-sized candidates from long sources, optionally runs isolation and speaker detection first, trims candidate nonspeech, then outputs mono 16 kHz WAV candidates.

## Documentation

- [Usage Guide](docs/USAGE.md): setup, key permissions, privacy model, cost notes, recording, and long-upload workflows.
- [API Reference](docs/API.md): local API routes, request fields, response headers, and provider metadata shapes.
- [Troubleshooting](docs/TROUBLESHOOTING.md): missing keys, scoped permissions, ports, quota errors, and cleanup.
- [Public Media Guidelines](docs/PUBLIC_MEDIA.md): public-safe screenshot and documentation media rules.
- [Architecture Standards](docs/ARCHITECTURE.md): backend/frontend boundaries for implementation work.
- [How To Add A Provider](docs/ADDING_PROVIDER.md): provider adapter responsibilities and validation.
- [Persistence Rollout](docs/PERSISTENCE_ROLLOUT.md): PostgreSQL, storage roots, consistency rules, and PR validation gates.
- [Video Source Media Rollout Notes](docs/VIDEO_SOURCE_MEDIA_ROLLOUT.md): draft PR stack, validation evidence, and Ready gates for local video source media.

## Local Development

Install host dependencies:

```sh
make setup
```

Run all checks:

```sh
make check
```

Run Postgres-backed migration checks after starting Docker:

```sh
make test-postgres
```

Run only the disposable Alembic migration roundtrip check:

```sh
make test-postgres-migrations
```

Useful Docker commands:

```sh
make logs
make down
make recycle
make destroy
```

Run an optional live smoke test after the Docker stack is running:

```sh
make smoke-live
```

## Project Structure

```text
.
├── assets/voices/        # local voice assets; real samples ignored by git
├── backend/alembic/      # database migrations
├── backend/              # FastAPI service and tests
├── docs/                 # architecture, usage, API, troubleshooting, and media docs
├── frontend/             # Vite React app and tests
├── scripts/              # local smoke helpers
├── storage/              # runtime cache/output; ignored by git
├── docker-compose.yml
└── Makefile
```

## License

MIT
