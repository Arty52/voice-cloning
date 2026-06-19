# Troubleshooting

## Missing API Key

If the UI shows Missing Key, add a key in the Provider Keys panel or create `.env` from `.env.example` and set `ELEVENLABS_API_KEY`. A saved browser key takes precedence immediately; clearing it falls back to `.env`.

## No Voices Appear

Fresh clones start with no voice assets. Upload and save a voice sample in the UI before generating speech.

## Port Conflict

The app uses:

- frontend: `4340`
- backend: `6420`

Override with:

```sh
WEB_PORT=4440 API_PORT=6520 make up
```

## ElevenLabs Quota Or Billing Errors

Check your ElevenLabs account subscription and usage. Shorter text and lower-cost models can reduce credit usage. The app links to ElevenLabs API request analytics from the Cost & Quota panel for quick inspection.

## Quota Or Model Metadata Unavailable

Some ElevenLabs keys are scoped. Use the permission error to update the key in the ElevenLabs Developer Console:

- Missing `user_read` means subscription/quota reads return unavailable.
- Missing `models_read` means model metadata returns unavailable and generation falls back to `ELEVENLABS_MODEL_ID`.
- Missing `create_instant_voice_clone` or the matching voice-clone create/write permission can break first-time cloning of a new voice sample.
- Missing `text_to_speech` can break speech generation.

## Sample Processing Unavailable

Sample Processing is disabled unless `.env` sets `SAMPLE_PROCESSING_ENGINE=demucs` and the backend runtime can execute the configured Demucs and FFmpeg commands. If `/api/sample-processing/options` shows disabled operations, confirm the engine setting and restart the backend.

## Demucs Or FFmpeg Command Was Not Found

Install the missing tool in the same environment that runs the FastAPI backend, or set an absolute command path:

```sh
SAMPLE_PROCESSING_DEMUCS_COMMAND=/path/to/demucs
SAMPLE_PROCESSING_FFMPEG_COMMAND=/path/to/ffmpeg
```

The backend invokes external tools with argument arrays and no shell, so shell aliases and interactive-only PATH changes may not apply.

## Sample Processing Is Slow Or Times Out

The first Demucs run may download model weights and can take longer than later runs. Increase the timeout if the machine is slow or a GPU backend is warming up:

```sh
SAMPLE_PROCESSING_TIMEOUT_SECONDS=1800
```

You can also choose a supported device with `SAMPLE_PROCESSING_DEMUCS_DEVICE`, such as `cpu`, `cuda`, or `mps`, depending on the local Demucs installation.

Max Isolation uses the finetuned `htdemucs_ft` model. The first run may download additional model weights. If the model is unavailable in the local Demucs install or cache, the job reports the Demucs model error instead of falling back to a weaker preset.

## Sample Processing Output Is Missing Or Too Large

If Demucs finishes but no `vocals.wav` stem exists, the job fails with a sanitized error and leaves the job directory under ignored `storage/sample-processing/` for inspection. If FFmpeg writes a result larger than the active sample cap, the backend deletes that result and reports the size limit. Shorten the source, choose a smaller retained source window, or raise the local upload cap only for trusted local work.

## Reset Local Runtime Data

Remove backend cache data:

```sh
make clean-cache
```

Sample-processing jobs and intermediate stems live under ignored `storage/sample-processing/`. Docker-routed Demucs model caches live under ignored `storage/model-cache/`. Remove either directory when you want to clear local processing artifacts or force model downloads again.

Generated audio saved in the browser can be removed from the Generated Audio panel with Remove or Clear All. The panel also lets you choose a browser storage cap of 25 MB, 50 MB, 100 MB, or 250 MB. Lowering the cap prompts before pruning older saved audio. Saved generated audio metadata includes model, provider request metadata when returned, tuning snapshot metadata when available, and browser-measured generation elapsed time for new generations.

Remove containers and volumes:

```sh
make destroy
```
