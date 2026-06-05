# Voice Clone Lab

Voice Clone Lab is a local-first voice studio for experimenting with provider-backed voice cloning from your own browser. It gives you a small saved voice library, text-to-speech generation, model selection, cost/quota visibility, voice tuning controls, playback, downloads, and a browser-local provider key manager.

![Screenshot of the Voice Clone Lab desktop Voice Studio showing text input, Demo Narrator and Demo Dialogue with voice preset badges, generated audio playback, Voice Tuning, and Voice Preset assignment controls.](docs/assets/voice-studio-desktop.png)

Public-safe demo screenshot: this capture uses mocked data and does not include real API keys, voice samples, generated audio files, or account details. A mobile capture is available in [docs/assets/voice-studio-mobile.png](docs/assets/voice-studio-mobile.png).

## What This Is

- A local development tool for testing provider-backed voice cloning with built-in ElevenLabs support.
- A Docker Compose app with a React + TypeScript frontend and Python FastAPI backend.
- A browser workspace for saving named voice samples, choosing a voice, selecting a model, tuning generation settings, checking quota, and downloading generated speech.

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

Optionally add an ElevenLabs key to `.env` as a backend fallback. You can also add a browser-local key from the Provider Keys panel instead.

```sh
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Start the app:

```sh
make up
```

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
- Local voice preset assignments are saved with the ignored voice manifest under `assets/voices/`.
- Generated audio and provider cache data under `storage/` are ignored by git.
- Browser-generated audio is stored in browser IndexedDB by default, not committed to the repository.
- The optional live smoke test calls ElevenLabs, may consume credits, and may create or reuse a cloned voice.

## Common Workflow

1. Add an ElevenLabs key in the Provider Keys panel if `.env` does not provide one.
2. Upload or record a voice sample.
3. Save it with a local name and choose Standard Narration or Animated Dialogue.
4. Enter text to speak.
5. Review Cost & Quota and choose a model if metadata is available.
6. Adjust Voice Tuning if needed; selecting a saved voice starts from its assigned preset when the active provider maps that preset, otherwise from provider defaults.
7. Generate speech.
8. Play, download, or remove generated audio from the browser library.

## Documentation

- [Usage Guide](docs/USAGE.md): setup, key permissions, privacy model, cost notes, recording, and long-upload workflows.
- [API Reference](docs/API.md): local API routes, request fields, response headers, and provider metadata shapes.
- [Troubleshooting](docs/TROUBLESHOOTING.md): missing keys, scoped permissions, ports, quota errors, and cleanup.
- [Public Media Guidelines](docs/PUBLIC_MEDIA.md): public-safe screenshot and documentation media rules.
- [Architecture Standards](docs/ARCHITECTURE.md): backend/frontend boundaries for implementation work.
- [How To Add A Provider](docs/ADDING_PROVIDER.md): provider adapter responsibilities and validation.

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

## Project Structure

```text
.
├── assets/voices/        # local voice assets; real samples ignored by git
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
