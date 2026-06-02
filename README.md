# Voice Clone Lab

Voice Clone Lab is a local, Dockerized web app for experimenting with ElevenLabs instant voice cloning from your own browser.

It gives you a small voice library, text-to-speech generation, model selection, cost/quota visibility, tuning controls, playback, downloads, and a browser-local provider key manager.

## What This Is

- A local development tool for testing ElevenLabs instant voice cloning.
- A React + TypeScript frontend backed by a Python FastAPI service.
- A browser UI for uploading or recording named voice samples, choosing a default voice, selecting a TTS model, tuning generation settings, checking quota, and downloading generated MP3 output.
- A Docker Compose app that runs on `localhost`.

## What This Is Not

- Not a hosted service.
- Not a production authentication, billing, or user-management system.
- Not bundled with any voice sample or API key.
- Not a way to avoid ElevenLabs usage, billing, consent, or content policies.

## Features

- Save named local voice samples into `assets/voices/` from upload or browser microphone recording.
- Select any saved voice and mark one as the local default.
- Generate speech from text using ElevenLabs text-to-speech.
- Reuse ElevenLabs cloned voices by sample hash through a local cache.
- Estimate credits before generation from character count and model rate metadata when available.
- Show ElevenLabs-reported quota remaining from the local backend.
- Select a text-to-speech model for the next generation without rewriting `.env`.
- Save a browser-local provider API key that overrides `.env` for provider requests.
- Show actual `x-character-count` and request id metadata after generation when ElevenLabs returns it.
- Cancel an in-flight generation from the browser with a clear ElevenLabs cost caveat.
- Persist generated MP3 audio in browser-local storage with an adjustable size cap.
- Adjust per-request ElevenLabs voice settings:
  - stability
  - similarity boost
  - style
  - speed
  - speaker boost
- Preview source voice samples.
- Play, download, and remove saved generated MP3 audio.
- Run automated backend and frontend checks with one command.

## Privacy Model

Provider keys can come from either `.env` on the FastAPI backend or the browser UI. A browser-saved key is stored in `localStorage`, sent only to the local API through `X-Voice-Provider-Key`, and takes precedence over `.env` for provider-backed requests. Clearing the browser key falls back to `.env` when `ELEVENLABS_API_KEY` is configured.

The backend never returns key material from `.env` or browser headers. Browser `localStorage` is local developer-tool storage, not encrypted secret storage; clear the Provider Keys panel or browser site data to remove a saved GUI key.

Voice samples are local files under `assets/voices/` and are ignored by git. Cloned voice cache data is written under `storage/`, scoped by provider and key fingerprint, and ignored by git. Generated MP3 output is saved in your browser's IndexedDB by default, not on the backend; use the Generated Audio panel to remove one item or clear all saved browser audio.

Text, voice samples, selected model id, and tuning settings are sent to ElevenLabs when you generate speech. Subscription and model metadata are fetched through the backend when the configured key has the required read permissions. Review ElevenLabs' policies and obtain consent before cloning or generating with any voice.

## Cost Notes

ElevenLabs may charge credits for text-to-speech and voice cloning. The main usage levers are:

- text length
- selected ElevenLabs model
- whether a voice sample has already been cloned and cached

The Cost & Quota panel shows a pre-run estimate and the remaining ElevenLabs-reported character quota. Estimates are approximate. After a generation, the app shows the actual `x-character-count` response header when ElevenLabs provides it.

The optional live smoke test calls ElevenLabs and may consume credits.

Canceling a generation aborts the browser request and lets the local API stop waiting on the in-flight operation. ElevenLabs does not currently expose a server-side cancel endpoint for text-to-speech requests, so a canceled generation may still consume credits.

## Prerequisites

- Docker and Docker Compose
- An ElevenLabs API key
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
2. Upload or record a voice sample.
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

Implementation work should follow the project standard in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: keep FastAPI routes thin, put backend orchestration in services, keep third-party HTTP details in clients, keep React workflow state in containers/hooks, and keep UI components presentational.

## API Overview

- `GET /api/health`
- `GET /api/providers`
- `GET /api/voices`
- `GET /api/voices/{voiceId}/sample`
- `GET /api/subscription`
- `GET /api/models`
- `POST /api/voices`
- `PATCH /api/voices/{voiceId}`
- `DELETE /api/voices/{voiceId}`
- `PUT /api/voices/default`
- `POST /api/speech`

`GET /api/providers` returns public provider metadata for the key manager:

```json
{
  "defaultProviderId": "elevenlabs",
  "providers": [
    {
      "id": "elevenlabs",
      "label": "ElevenLabs",
      "serverKeyConfigured": true,
      "manageKeyUrl": "https://elevenlabs.io/app/subscription/api",
      "docsUrl": "https://elevenlabs.io/docs/api-reference/authentication"
    }
  ]
}
```

Provider-backed routes accept an optional `X-Voice-Provider-Key` header. When present and non-empty, that browser-provided key overrides `ELEVENLABS_API_KEY`; otherwise the backend falls back to `.env`. The API never returns either key.

`GET /api/subscription` returns a sanitized quota summary for the Cost & Quota panel:

```json
{
  "available": true,
  "tier": "starter",
  "status": "active",
  "characterCount": 1000,
  "characterLimit": 10000,
  "remainingCharacters": 9000
}
```

If the active key cannot read subscription metadata, the endpoint returns `available: false` with a sanitized `error` string instead of exposing raw ElevenLabs account data.

`GET /api/models` returns text-to-speech-capable model metadata:

```json
{
  "available": true,
  "defaultModelId": "eleven_multilingual_v2",
  "models": [
    {
      "modelId": "eleven_multilingual_v2",
      "name": "Eleven Multilingual v2",
      "characterCostMultiplier": 1
    }
  ]
}
```

If model metadata is unavailable, generation still works by omitting `modelId` and letting the backend use `ELEVENLABS_MODEL_ID`.

`POST /api/voices` accepts multipart form fields:

- `name`: local voice display name
- `sampleFile`: audio file to store in `assets/voices/`

`PATCH /api/voices/{voiceId}` accepts JSON and renames a local voice without changing its stable local id or sample file:

```json
{ "name": "Voice_Clone_01" }
```

`DELETE /api/voices/{voiceId}` removes a local voice sample and reassigns the default to the first remaining voice, or to none when the library is empty.

`PUT /api/voices/default` accepts JSON:

```json
{ "voiceId": "voice-clone-01" }
```

`POST /api/speech` accepts multipart form fields:

- `text`: speech text
- `voiceId`: saved local voice id; defaults to the configured local default
- `modelId`: optional ElevenLabs TTS model id; defaults to `ELEVENLABS_MODEL_ID`
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
- `X-Character-Count`: actual ElevenLabs character usage when returned
- `X-Request-Id`: request id when returned by ElevenLabs

Voice clone cache entries are separated by provider and active key fingerprint, so switching browser keys does not reuse another account's cached voice ID.

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

If the UI shows Missing Key, add a key in the Provider Keys panel or create `.env` from `.env.example` and set `ELEVENLABS_API_KEY`. A saved browser key takes precedence immediately; clearing it falls back to `.env`.

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

Check your ElevenLabs account subscription and usage. Shorter text and lower-cost models can reduce credit usage. The app links to ElevenLabs API request analytics from the Cost & Quota panel for quick inspection.

### Quota or model metadata unavailable

Some ElevenLabs keys are scoped. Use the permission error to update the key in the ElevenLabs Developer Console:

- Missing `user_read` means subscription/quota reads return unavailable.
- Missing `models_read` means model metadata returns unavailable and generation falls back to `ELEVENLABS_MODEL_ID`.
- Missing `create_instant_voice_clone` or the matching voice-clone create/write permission can break first-time cloning of a new voice sample.
- Missing `text_to_speech` can break speech generation.

### Reset local runtime data

Remove backend cache data:

```sh
make clean-cache
```

Generated audio saved in the browser can be removed from the Generated Audio panel with Remove or Clear All. The panel also lets you choose a browser storage cap of 25 MB, 50 MB, 100 MB, or 250 MB. Lowering the cap prompts before pruning older saved audio.

### Browser voice recording

The Add Voice panel can record through the browser microphone or fall back to file upload. Browser recordings are encoded as local WAV files before they are sent to the backend, avoiding browser-specific `MediaRecorder` container differences across Safari, Chrome, Edge on Windows, and Firefox. Recordings stop before the backend's 10 MB upload cap; most devices can record up to 90 seconds, while very high sample-rate devices may stop sooner.

Recording requires a browser that supports microphone access on `localhost` and user permission for the microphone. If permission is denied or the microphone API is unavailable, use Sample File upload instead.

Remove containers and volumes:

```sh
make destroy
```

## References

- [ElevenLabs API Documentation](https://docs.elevenlabs.io/)
- [Manage ElevenLabs API Key](https://elevenlabs.io/app/subscription/api)
- [ElevenLabs API Authentication and Scoped Keys](https://elevenlabs.io/docs/api-reference/authentication)
- [ElevenLabs API Request Analytics](https://elevenlabs.io/app/developers/analytics/api-requests)
- [Tracking generation costs](https://elevenlabs.io/docs/api-reference/introduction)
- [Get User Subscription API](https://elevenlabs.io/docs/api-reference/user/subscription/get)
- [List Models API](https://elevenlabs.io/docs/api-reference/models/list)
- [Create IVC Voice API](https://elevenlabs.io/docs/api-reference/voices/ivc/create)
- [Create Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [Instant Voice Cloning Documentation](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning)

## License

MIT
