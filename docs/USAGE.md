# Usage Guide

This guide covers local setup, provider key handling, and the sidebar workflow for Voice Clone Lab.

## Prerequisites

- Docker and Docker Compose
- An ElevenLabs API key for the built-in provider
- Optional for host development:
  - Python 3.14+
  - Node.js 24+
- Optional for local sample processing:
  - FFmpeg
  - Demucs, when `SAMPLE_PROCESSING_ENGINE=demucs`

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
ELEVENLABS_API_KEY=your_key_here  # optional when you use Provider & Usage
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Optionally enable local sample processing for Trim Silence only:

```sh
INSTALL_SAMPLE_PROCESSING=1
SAMPLE_PROCESSING_ENGINE=ffmpeg
SAMPLE_PROCESSING_FFMPEG_COMMAND=ffmpeg
SAMPLE_PROCESSING_TIMEOUT_SECONDS=900
```

To also enable Isolate Voice through Demucs, use the Demucs engine and add the Demucs-specific settings:

```sh
SAMPLE_PROCESSING_ENGINE=demucs
SAMPLE_PROCESSING_FFMPEG_COMMAND=ffmpeg
SAMPLE_PROCESSING_DEMUCS_COMMAND=demucs
SAMPLE_PROCESSING_DEMUCS_MODEL=htdemucs
SAMPLE_PROCESSING_DEMUCS_DEVICE=  # optional, such as cpu, cuda, or mps when supported
SAMPLE_PROCESSING_TIMEOUT_SECONDS=900
```

To enable Speaker Separation, accept the Hugging Face model conditions for `pyannote/speaker-diarization-community-1`, create a Hugging Face access token, and set:

```sh
INSTALL_DIARIZATION=1
SAMPLE_PROCESSING_ENABLE_DIARIZATION=1
SAMPLE_PROCESSING_PYANNOTE_MODEL=pyannote/speaker-diarization-community-1
SAMPLE_PROCESSING_HF_TOKEN=hf_...
SAMPLE_PROCESSING_WHISPER_MODEL=medium
SAMPLE_PROCESSING_WHISPER_DEVICE=cpu
SAMPLE_PROCESSING_WHISPER_COMPUTE_TYPE=int8
PYANNOTE_METRICS_ENABLED=0
```

Leave `SAMPLE_PROCESSING_ENGINE` blank to keep Isolate Voice and Trim Silence unavailable. Leave `SAMPLE_PROCESSING_ENABLE_DIARIZATION=0` to keep Speaker Separation unavailable. Leave `INSTALL_SAMPLE_PROCESSING=0` and `INSTALL_DIARIZATION=0` for the default lightweight Docker image. When you change either install flag, rebuild the stack with `make recycle`; the backend image installs FFmpeg, CPU-only PyTorch/Torchaudio/TorchCodec wheels, and the requested optional backend extras.

Demucs, pyannote, and faster-whisper model downloads, separated stems, normalized job output, and local caches are runtime data and should not be committed. Docker stores model caches under ignored `storage/model-cache/`.

Start the app:

```sh
make up
```

Open the UI:

```text
http://localhost:4340
```

The UI opens on `Voices`. The sidebar is the top-level workflow map:

1. `Prepare Samples` (`#prepare`, optional step 0): optionally process an uploaded file or saved sample before creating a library voice.
2. `Voices` (`#voices`, step 1): upload or record a voice sample, choose a local name such as `Voice_Clone_01`, choose Standard Narration or Animated Dialogue, save it, select it, and preview it.
3. `Generate Speech` (`#generate`, step 2): enter text, review the latest result, and adjust Voice Tuning. Selecting a saved voice initializes tuning from that voice's assigned preset when the active provider maps it, otherwise from provider defaults.
4. `Generated Audio` (`#archive`, optional): play, download, remove, or clear saved generated MP3s from browser IndexedDB.
5. `Provider & Usage` (`#provider`): add an ElevenLabs key if `.env` does not provide one, confirm `.env` fallback, check Cost & Quota, and choose a model if model metadata is available.

The API is available at:

```text
http://localhost:6420
```

## Voice Preset Assignments

Each local voice has a provider-independent voice preset assignment. Choose Standard Narration for balanced reading, or Animated Dialogue for more expressive delivery, when saving a new voice or editing the selected voice in the Voice Library.

The assignment is saved as local voice metadata and is not a provider clone id or provider secret. When you select a voice, Voice Tuning starts from the active provider preset mapped to that assignment. If the active provider has no matching mapped preset, Voice Tuning uses that provider's default values instead. Manual slider, toggle, or select changes are per-request only; they show as Custom and do not overwrite the saved assignment.

Existing voices or older manifests without an assignment default to Standard Narration. This iteration persists only the preset id, not custom tuning overrides.

## Privacy Model

Provider keys can come from either `.env` on the FastAPI backend or the `Provider & Usage` section in the browser UI. A browser-saved key is stored in `localStorage`; browser code sends it only to the local API through `X-Voice-Provider-Key`, and the backend uses that active key to authenticate provider requests for the selected `providerId`. A browser key takes precedence over `.env`; clearing it falls back to `.env` when the built-in ElevenLabs `ELEVENLABS_API_KEY` is configured.

The backend never returns key material from `.env` or browser headers. Browser `localStorage` is local developer-tool storage, not encrypted secret storage; clear the key in `Provider & Usage` or browser site data to remove a saved GUI key.

Voice samples and their local manifest metadata are stored under `assets/voices/` and are ignored by git. When a long upload is saved with its original source retained, the backend stores the original under `assets/voices/sources/` and still sends only the active excerpt sample to the provider. Cloned voice cache data is written under `storage/`, scoped by provider and key fingerprint, and ignored by git. Generated MP3 output is saved in your browser's IndexedDB by default, not on the backend; use `Generated Audio` to remove one item or clear all saved browser audio.

Text, voice samples, selected model id, and provider-specific tuning settings are sent to the active provider when you generate speech. Subscription and model metadata are fetched through the backend when the configured key has the required read permissions. Review the active provider's policies and obtain consent before cloning or generating with any voice.

## Cost Notes

Providers may charge credits for text-to-speech and voice cloning. For the built-in ElevenLabs provider, the main usage levers are:

- text length
- selected ElevenLabs model
- whether a voice sample has already been cloned and cached

The Cost & Quota panel in `Provider & Usage` shows a pre-run estimate and the remaining provider-reported character quota when available. Estimates are approximate. After a generation, the app shows the actual `X-Character-Count` response header when the provider supplies it. Generated Audio entries also show browser-measured generation time; this is the local request duration from starting generation until the browser receives the audio blob, not provider-reported compute time.

The optional live smoke test calls ElevenLabs and may consume credits.

Canceling a generation aborts the browser request and lets the local API stop waiting on the in-flight operation. ElevenLabs does not currently expose a server-side cancel endpoint for text-to-speech requests, so a canceled generation may still consume credits.

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

## Browser Voice Recording

The Add Voice panel can record through the browser microphone or fall back to file upload. Browser recordings are encoded as local WAV files before they are sent to the backend, avoiding browser-specific `MediaRecorder` container differences across Safari, Chrome, Edge on Windows, and Firefox. Recordings stop before the backend's 10 MB upload cap; most devices can record up to 90 seconds, while very high sample-rate devices may stop sooner.

Recording requires a browser that supports microphone access on `localhost` and user permission for the microphone. If permission is denied or the microphone API is unavailable, use Sample File upload instead.

## Long Uploaded Samples

The Add Voice panel can prepare a provider-sized window from a longer local upload. The browser decodes the selected file, defaults short files to their full duration, and defaults long files to the first provider-sized window. For the built-in ElevenLabs provider, the window maximum is 120 seconds and the recommended range is 60-120 seconds.

The cropper has two save modes:

- `Save Excerpt`: send only the selected excerpt as the active `sampleFile`.
- `Keep Original`: send the selected excerpt as the active `sampleFile` and retain the original upload locally as `sourceFile` for traceability or future recropping.

Cropped excerpts are encoded in the browser as mono 32 kHz WAV files so a two-minute active sample stays below the default 10 MB active upload cap. The backend stores that excerpt under `assets/voices/` and sends only that active sample to the provider for cloning. When the UI sends `sampleMode=sourceWindow`, the original `sourceFile` is retained locally under `assets/voices/sources/`; it remains ignored by git and is not sent to the provider.

If the browser cannot decode the selected file type, choose a shorter browser-decodable file such as WAV, MP3, M4A, or WebM. This rollout intentionally avoids server-side audio transcoding so local source files and generated excerpts remain easy to reason about in a public repository.

## Sample Processing

`Prepare Samples` is a separate optional workflow from `Voices`. It is intended for preparing source samples before using them for generation. Current operations are Isolate Voice, Trim Silence, and optional Speaker Separation.

Set `SAMPLE_PROCESSING_ENGINE=ffmpeg` to enable only Trim Silence. Set `SAMPLE_PROCESSING_ENGINE=demucs` to enable Isolate Voice and Trim Silence together. Set `SAMPLE_PROCESSING_ENABLE_DIARIZATION=1` to add Speaker Separation alongside either engine, or by itself when `SAMPLE_PROCESSING_ENGINE` is blank. When Demucs is enabled, Isolate Voice runs the configured Demucs command with the `htdemucs` model by default, extracts the vocals stem, then runs FFmpeg to normalize the result to mono 32 kHz WAV. Trim Silence runs FFmpeg `silenceremove`, trims leading, trailing, and long interior empty sections, then normalizes the result to mono 32 kHz WAV. Speaker Separation normalizes the source with FFmpeg, runs pyannote Community-1 locally for speaker turns, runs faster-whisper locally with word timestamps, maps transcript text to speakers by time overlap, then generates one mono 32 kHz WAV per speaker. Existing saved voices default to Original Source, which uses the retained full upload/source file when `sourceFilePath` exists and falls back to the active provider-facing sample when no retained source exists. Choose Active Sample to process the provider-facing sample currently stored for the selected voice. Uploaded files can also be processed without first saving them as voices.

You can run one operation or stack multiple operations in one backend-owned workflow. The recommended stack is Clean Up Voice, Split Speakers, then Tighten Pauses. When all three are selected, voice isolation runs first, Speaker Separation runs on the isolated audio, and Trim Silence tightens each generated speaker stream. When Split Speakers is not selected, Trim Silence tightens the single current audio result.

In `#prepare`, choose a saved voice or upload an audio file, then select one or more Workflow Stack cards before starting. Uploads support MP3, WAV, M4A, AAC, OGG, and FLAC. Selected cards show selected-state styling, each selected operation with presets exposes its own preset control, and the running job shows Workflow Progress with Queued, Running, Complete, Error, or Canceled steps.

Isolation Strength offers four presets. Fast uses fewer Demucs shifts for quick previews. Balanced is the default and preserves the original behavior. Clean keeps Balanced separation and adds conservative FFmpeg high-pass/low-pass cleanup. Max Isolation uses the finetuned `htdemucs_ft` model with higher shifts and overlap; it is slower and requires that model to be available locally.

Trim Aggressiveness offers three presets. Light trims only quieter or longer empty regions. Balanced is the default and preserves a small amount of room tone. Aggressive trims shorter or louder empty regions for tighter samples.

Speaker Separation is diarized speaker-turn extraction, not true neural unmixing of simultaneous speakers. If two people overlap, V1 assigns transcript text and retained time ranges to the best matching detected speaker rather than separating both voices from the same audio moment.

Processed results are candidates, not automatic voice-library entries. Sample Processing never refines, overwrites, or replaces the selected saved voice. Preview the result first, then choose Add To Voice Library to store it under `assets/voices/` through the same local Voice Library path as uploaded samples. This creates a new voice whose `filePath`, `contentType`, and `sha256` point at the processed active sample, and includes `processingSteps` metadata for traceability, including every completed stack step and selected preset when one was used. Speaker Separation saves any selected speaker streams as independent voices, each with its own Voice Name and Voice Preset selection, and keeps prior stack steps plus speaker-specific split or trim metadata. The Voice Preset options come from `/api/providers.voicePresets`, the same semantic preset source used by normal voice uploads.

Sample Processing shows a browser-observed elapsed timer while the current job runs and keeps the final time visible with the current preview or error. Stacked jobs also expose per-step status so the UI can show which operation is active. Use Abort to cancel a pending or running job. FFmpeg and Demucs subprocesses are stopped when canceled; pyannote and faster-whisper model work is marked canceled immediately and later stack steps are skipped, though a model call already running in a worker thread may finish in the background. Timing is local to the Sample Processing section and is not saved to voice metadata.

Runtime files are written under ignored `storage/sample-processing/`. Demucs output folders, diarization transcripts, generated speaker streams, and intermediate stems are job-local. Heavy model files are runtime data; the Docker stack routes them to ignored `storage/model-cache/`. For offline use, run once while the machine can reach Hugging Face and faster-whisper model storage so the model files are present in the local cache before disconnecting.
