# Voice Clone Lab

Voice Clone Lab is a local, Dockerized web app for experimenting with provider-backed voice cloning from your own browser. ElevenLabs is the built-in provider.

It gives you a small voice library, text-to-speech generation, model selection, cost/quota visibility, tuning controls, playback, downloads, and a browser-local provider key manager.

![Voice Clone Lab desktop voice studio showing text input, a demo voice library, generated audio playback, voice tuning controls, provider key status, and cost/quota panels.](docs/assets/voice-studio-desktop.png)

The screenshot uses sanitized demo data and does not include real API keys, voice samples, generated audio files, or account details.

## What This Is

- A local development tool for testing provider-backed voice cloning with built-in ElevenLabs support.
- A React + TypeScript frontend backed by a Python FastAPI service.
- A browser UI for uploading or recording named voice samples, choosing a default voice, selecting a TTS model, tuning generation settings, checking quota, and downloading generated MP3 output.
- A Docker Compose app that runs on `localhost`.

## What This Is Not

- Not a hosted service.
- Not a production authentication, billing, or user-management system.
- Not bundled with any voice sample or API key.
- Not a way to avoid provider usage, billing, consent, or content policies.

## Features

- Save named local voice samples into `assets/voices/` from upload, selected upload excerpts, or browser microphone recording.
- Select any saved voice and mark one as the local default.
- Generate speech from text using the active voice provider.
- Reuse provider cloned voices by sample hash through a local cache.
- Estimate credits before generation from character count and model rate metadata when available.
- Show provider-reported quota remaining from the local backend when available.
- Select a text-to-speech model for the next generation without rewriting `.env`.
- Save a browser-local provider API key that overrides `.env` for provider requests.
- Show actual `x-character-count`, request id, browser-measured generation time, and settings metadata after generation when available.
- Cancel an in-flight generation from the browser with a clear provider cost caveat.
- Persist generated MP3 audio in browser-local storage with an adjustable size cap.
- Adjust per-request provider voice settings from provider-supplied metadata.
- Preview source voice samples.
- Play, download, and remove saved generated MP3 audio.
- Run automated backend and frontend checks with one command.

## Privacy Model

Provider keys can come from either `.env` on the FastAPI backend or the browser UI. A browser-saved key is stored in `localStorage`; browser code sends it only to the local API through `X-Voice-Provider-Key`, and the backend uses that active key to authenticate provider requests for the selected `providerId`. A browser key takes precedence over `.env`; clearing it falls back to `.env` when the built-in ElevenLabs `ELEVENLABS_API_KEY` is configured.

The backend never returns key material from `.env` or browser headers. Browser `localStorage` is local developer-tool storage, not encrypted secret storage; clear the Provider Keys panel or browser site data to remove a saved GUI key.

Voice samples are local files under `assets/voices/` and are ignored by git. When a long upload is saved with its original source retained, the backend stores the original under `assets/voices/sources/` and still sends only the active excerpt sample to the provider. Cloned voice cache data is written under `storage/`, scoped by provider and key fingerprint, and ignored by git. Generated MP3 output is saved in your browser's IndexedDB by default, not on the backend; use the Generated Audio panel to remove one item or clear all saved browser audio.

Text, voice samples, selected model id, and provider-specific tuning settings are sent to the active provider when you generate speech. Subscription and model metadata are fetched through the backend when the configured key has the required read permissions. Review the active provider's policies and obtain consent before cloning or generating with any voice.

## Cost Notes

Providers may charge credits for text-to-speech and voice cloning. For the built-in ElevenLabs provider, the main usage levers are:

- text length
- selected ElevenLabs model
- whether a voice sample has already been cloned and cached

The Cost & Quota panel shows a pre-run estimate and the remaining provider-reported character quota when available. Estimates are approximate. After a generation, the app shows the actual `x-character-count` response header when the provider supplies it. Generated Audio entries also show browser-measured generation time; this is the local request duration from starting generation until the browser receives the audio blob, not provider-reported compute time.

The optional live smoke test calls ElevenLabs and may consume credits.

Canceling a generation aborts the browser request and lets the local API stop waiting on the in-flight operation. ElevenLabs does not currently expose a server-side cancel endpoint for text-to-speech requests, so a canceled generation may still consume credits.

## Prerequisites

- Docker and Docker Compose
- An ElevenLabs API key for the built-in provider
- Optional for host development:
  - Python 3.14+
  - Node.js 24+

## ElevenLabs API Key Permissions

For a restricted ElevenLabs API key, grant the least-privilege permissions below. The Developer Console may show human-readable labels instead of raw scope names; choose the matching product permission.

| Permission scope | Access type | Required for |
| --- | --- | --- |
| `text_to_speech` | Generate/execute | Generate speech through `POST /v1/text-to-speech/{voice_id}`. This can consume credits. |
| `create_instant_voice_clone` | Write/create | Clone a new uploaded sample through `POST /v1/voices/add`. This is needed the first time a sample hash is not already in the local clone cache. |
| `models_read` | Read | Load `GET /v1/models` for the model selector and model-rate estimate metadata. |
| `user_read` | Read | Load `GET /v1/user/subscription` for quota and remaining-credit display. |

`models_read` and `user_read` are not required to generate speech, but the Cost & Quota panel will show model or quota metadata as unavailable without them. Keep key restrictions enabled and add only the scopes this app needs.

## From Zero To One

Clone the repository:

```sh
git clone https://github.com/Arty52/voice-cloning.git
cd voice-cloning
```

Create your local environment file:

```sh
cp .env.example .env
```

Optionally edit `.env` and add your ElevenLabs key as the backend fallback:

```sh
ELEVENLABS_API_KEY=your_key_here  # optional when you use the Provider Keys panel
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Start the app:

```sh
make up
```

Open the UI:

```text
http://localhost:4340
```

Then:

1. Add an ElevenLabs key in the Provider Keys panel if `.env` does not provide one.
2. Upload or record a voice sample. For long uploads, choose the sample window and whether to keep the original local source.
3. Give it a local name, such as `Voice_Clone_01`.
4. Save the voice.
5. Enter text.
6. Check the Cost & Quota panel and choose a model if model metadata is available.
7. Adjust tuning sliders if needed.
8. Generate speech.
9. Play, download, or remove saved generated MP3s from the Generated Audio panel.

The API is available at:

```text
http://localhost:6420
```

## Local Development

Install host dependencies:

```sh
make setup
```

Run all checks:

```sh
make check
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

This calls ElevenLabs with the real API key, may consume credits, and writes `storage/smoke-output.mp3`.

## Architecture Standards

Implementation work should follow the project standard in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: keep FastAPI routes thin, put backend orchestration in services, keep third-party HTTP details in provider adapters, keep React workflow state in containers/hooks, and keep UI components presentational.

To add another provider, follow [docs/ADDING_PROVIDER.md](docs/ADDING_PROVIDER.md). It covers provider options, adapter responsibilities, tuning metadata, public-safety checks, and validation.

## Documentation

- [Usage Guide](docs/USAGE.md) covers local setup, key handling, cost notes, voice recording, and long-upload workflows.
- [API Reference](docs/API.md) lists local API routes, request fields, response headers, and provider metadata shapes.
- [Troubleshooting](docs/TROUBLESHOOTING.md) covers missing keys, scoped permissions, ports, quota errors, and runtime cleanup.
- [Public Media Guidelines](docs/PUBLIC_MEDIA.md) explains how to add public-safe screenshots and other docs assets.
- [Architecture Standards](docs/ARCHITECTURE.md) describes the backend/frontend boundaries for implementation work.
- [How To Add A Provider](docs/ADDING_PROVIDER.md) covers provider options, adapter responsibilities, public-safety checks, and validation.

## Project Structure

```text
.
├── assets/voices/        # local voice assets; real samples ignored by git
├── backend/              # FastAPI service and tests
├── docs/                 # architecture and provider extension guides
├── frontend/             # Vite React app and tests
├── scripts/              # local smoke helpers
├── storage/              # runtime cache/output; ignored by git
├── docker-compose.yml
└── Makefile
```

## License

MIT
