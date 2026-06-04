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

## Reset Local Runtime Data

Remove backend cache data:

```sh
make clean-cache
```

Generated audio saved in the browser can be removed from the Generated Audio panel with Remove or Clear All. The panel also lets you choose a browser storage cap of 25 MB, 50 MB, 100 MB, or 250 MB. Lowering the cap prompts before pruning older saved audio. Saved generated audio metadata includes model, provider request metadata when returned, tuning snapshot metadata when available, and browser-measured generation elapsed time for new generations.

Remove containers and volumes:

```sh
make destroy
```
