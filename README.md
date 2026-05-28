# Voice Clone Lab

Voice Clone Lab is a local, Dockerized web app for experimenting with ElevenLabs instant voice cloning from your own browser.

It gives you a small voice library, text-to-speech generation, tuning controls, playback, and downloads while keeping your ElevenLabs API key on the local backend.

## What This Is

- A local development tool for testing ElevenLabs instant voice cloning.
- A React + TypeScript frontend backed by a Python FastAPI service.
- A browser UI for uploading named voice samples, choosing a default voice, tuning generation settings, and downloading generated MP3 output.
- A Docker Compose app that runs on `localhost`.

## What This Is Not

- Not a hosted service.
- Not a production authentication, billing, or user-management system.
- Not bundled with any voice sample or API key.
- Not a way to avoid ElevenLabs usage, billing, consent, or content policies.

## Features

- Save named local voice samples into `assets/voices/`.
- Select any saved voice and mark one as the local default.
- Generate speech from text using ElevenLabs text-to-speech.
- Reuse ElevenLabs cloned voices by sample hash through a local cache.
- Adjust per-request ElevenLabs voice settings:
  - stability
  - similarity boost
  - style
  - speed
  - speaker boost
- Preview source voice samples.
- Play and download generated MP3 audio.
- Run automated backend and frontend checks with one command.

## Privacy Model

Your ElevenLabs API key is read only by the FastAPI backend from `.env`. The frontend never receives the key.

Voice samples are local files under `assets/voices/` and are ignored by git. Generated output and cloned voice cache data are written under `storage/`, which is also ignored by git.

Text, voice samples, and tuning settings are sent to ElevenLabs when you generate speech. Review ElevenLabs' policies and obtain consent before cloning or generating with any voice.

## Cost Notes

ElevenLabs may charge credits for text-to-speech and voice cloning. The main usage levers are:

- text length
- selected ElevenLabs model
- whether a voice sample has already been cloned and cached

The optional live smoke test calls ElevenLabs and may consume credits.

## Prerequisites

- Docker and Docker Compose
- An ElevenLabs API key
- Optional for host development:
  - Python 3.14+
  - Node.js 24+

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

Edit `.env` and add your ElevenLabs key:

```sh
ELEVENLABS_API_KEY=your_key_here
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

1. Upload a voice sample.
2. Give it a local name, such as `Gray`.
3. Save the voice.
4. Enter text.
5. Adjust tuning sliders if needed.
6. Generate speech.
7. Play or download the MP3.

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

## API Overview

- `GET /api/health`
- `GET /api/voices`
- `GET /api/voices/{voiceId}/sample`
- `POST /api/voices`
- `PUT /api/voices/default`
- `POST /api/speech`

`POST /api/voices` accepts multipart form fields:

- `name`: local voice display name
- `sampleFile`: audio file to store in `assets/voices/`

`PUT /api/voices/default` accepts JSON:

```json
{ "voiceId": "gray" }
```

`POST /api/speech` accepts multipart form fields:

- `text`: speech text
- `voiceId`: saved local voice id; defaults to the configured local default
- `stability`: `0..1`
- `similarityBoost`: `0..1`
- `style`: `0..1`
- `speed`: `0.7..1.2`
- `useSpeakerBoost`: `true` or `false`

The response is `audio/mpeg` with these headers:

- `X-Voice-Cache`: `hit` or `miss`
- `X-Voice-Id`: ElevenLabs voice ID
- `X-App-Voice-Id`: local voice asset ID
- `X-Sample-Sha256`: sample hash

## Project Structure

```text
.
├── assets/voices/        # local voice assets; real samples ignored by git
├── backend/              # FastAPI service and tests
├── frontend/             # Vite React app and tests
├── scripts/              # local smoke helpers
├── storage/              # runtime cache/output; ignored by git
├── docker-compose.yml
└── Makefile
```

## Troubleshooting

### Missing API key

If generation fails with `ELEVENLABS_API_KEY is not configured`, create `.env` from `.env.example` and set `ELEVENLABS_API_KEY`.

### No voices appear

Fresh clones start with no voice assets. Upload and save a voice sample in the UI before generating speech.

### Port conflict

The app uses:

- frontend: `4340`
- backend: `6420`

Override with:

```sh
WEB_PORT=4440 API_PORT=6520 make up
```

### ElevenLabs quota or billing errors

Check your ElevenLabs account subscription and usage. Shorter text and lower-cost models can reduce credit usage.

### Reset local runtime data

Remove generated audio/cache data:

```sh
make clean-cache
```

Remove containers and volumes:

```sh
make destroy
```

## References

- [ElevenLabs API Documentation](https://docs.elevenlabs.io/)
- [Instant Voice Cloning Documentation](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning)
- [Text-to-Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech)

## License

MIT
