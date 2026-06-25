# Troubleshooting

## Missing API Key

If the workflow status shows Needs Key, add a key in `Provider & Usage` or create `.env` from `.env.example` and set `ELEVENLABS_API_KEY`. A saved browser key takes precedence immediately; clearing it falls back to `.env`.

## No Voices Appear

Fresh clones start with no voice assets. Open `Prepare Audio`, upload or record a sample, and save it before generating speech.

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

Sample Processing is disabled unless `.env` sets `SAMPLE_PROCESSING_ENGINE=ffmpeg`, `SAMPLE_PROCESSING_ENGINE=demucs`, or `SAMPLE_PROCESSING_ENABLE_DIARIZATION=1` and the backend runtime can execute the configured commands. `ffmpeg` enables Trim Silence only. `demucs` enables Isolate Voice and Trim Silence. `SAMPLE_PROCESSING_ENABLE_DIARIZATION=1` enables Speaker Separation. If `/api/sample-processing/options` shows disabled operations, confirm the engine and diarization settings, rebuild when install flags changed, and restart the backend.

## Multi-Voice Speech Assembly Fails

Multi-voice generation writes segment audio under ignored `storage/speech-jobs/` and uses FFmpeg to assemble the final result. Docker installs FFmpeg by default. For host development, install FFmpeg in the same environment that runs FastAPI, or set an absolute command path:

```sh
SAMPLE_PROCESSING_FFMPEG_COMMAND=/path/to/ffmpeg
```

Combined multi-voice audio can insert a short handoff gap between segments. The backend default is `250` milliseconds from `SPEECH_JOB_SEGMENT_GAP_MS`; each speech job can opt out by sending `segmentGapMs: 0`. Set `SPEECH_JOB_SEGMENT_GAP_MS=0` to make gapless assembly the backend default, or increase it if dialogue handoffs still feel too tight.

If a segment-level tuning change fails, confirm the active provider supports every `voiceSettings` key in that segment regeneration request. Segment tuning uses the same provider validation as per-request Voice Tuning, and unsupported tuning ids return a 422 or move the active job to `error` with a sanitized provider message.

If FFmpeg is missing, exits nonzero, or times out, the speech job moves to `error` and the job payload reports a sanitized message. Individual segment generation may have succeeded even when final assembly fails, but the combined result is available only after FFmpeg produces the final `audio/mpeg` file.

## Demucs Or FFmpeg Command Was Not Found

Install the missing tool in the same environment that runs the FastAPI backend, or set an absolute command path:

```sh
SAMPLE_PROCESSING_DEMUCS_COMMAND=/path/to/demucs
SAMPLE_PROCESSING_FFMPEG_COMMAND=/path/to/ffmpeg
```

The backend invokes external tools with argument arrays and no shell, so shell aliases and interactive-only PATH changes may not apply.

## Speaker Diarization Dependencies Are Missing

Speaker Separation requires the optional backend `diarization` extra. For Docker, set `INSTALL_DIARIZATION=1` and rebuild with `make recycle`. For host development, install the extra in the backend environment:

```sh
.venv/bin/python -m pip install -e "backend[diarization]"
```

FFmpeg must also be available because the backend normalizes source audio and writes per-speaker WAV streams through the configured `SAMPLE_PROCESSING_FFMPEG_COMMAND`.

## Hugging Face Token Or Model Access Fails

Speaker Separation uses `pyannote/speaker-diarization-community-1`. Accept the model conditions on Hugging Face, then set either `SAMPLE_PROCESSING_HF_TOKEN` or `HF_TOKEN` in `.env`. If the backend reports that the pyannote model could not be loaded, verify the token, model access acceptance, and local network/cache state.

The Docker runtime stores pyannote and faster-whisper caches under ignored `storage/model-cache/`. The first run may need network access to download model files; later runs can use the local cache when the requested model files are already present. Set `PYANNOTE_METRICS_ENABLED=0` to keep pyannote telemetry disabled.

## Sample Processing Is Slow Or Times Out

Trim Silence is usually much faster than Isolate Voice or Speaker Separation, but long files or slow disks can still hit the command timeout. The first Demucs, pyannote, or faster-whisper run may download model weights and can take longer than later runs. Increase the timeout if the machine is slow or a model backend is warming up:

```sh
SAMPLE_PROCESSING_TIMEOUT_SECONDS=1800
```

You can also choose a supported Demucs device with `SAMPLE_PROCESSING_DEMUCS_DEVICE`, such as `cpu`, `cuda`, or `mps`, depending on the local Demucs installation. Speaker Separation defaults to `SAMPLE_PROCESSING_WHISPER_DEVICE=cpu` and `SAMPLE_PROCESSING_WHISPER_COMPUTE_TYPE=int8`, which are conservative Mac defaults. Change them only when the local faster-whisper install supports the target device and compute type.

Max Isolation uses the finetuned `htdemucs_ft` model. The first run may download additional model weights. If the model is unavailable in the local Demucs install or cache, the job reports the Demucs model error instead of falling back to a weaker preset.

Stacked workflows run each selected operation in order, so their total runtime is roughly the sum of the selected steps. Clean Up Voice + Split Speakers + Tighten Pauses can be significantly slower than any individual operation because Trim Silence runs once for each detected speaker stream.

If you abort a job, the backend marks the job `canceled` and skips remaining stack steps. FFmpeg and Demucs subprocesses are killed. Pyannote or faster-whisper work may keep using CPU briefly if it was already running in a worker thread, but its job result is discarded.

## Sample Processing Output Is Missing Or Too Large

If Demucs finishes but no `vocals.wav` stem exists, the job fails with a sanitized error and leaves the job directory under ignored `storage/sample-processing/` for inspection. If FFmpeg does not produce the normalized Isolate Voice, Trim Silence, or Speaker Separation result, the job reports an FFmpeg failure. If pyannote detects no speakers, Speaker Separation reports that no speakers were detected. If FFmpeg writes a result or speaker stream larger than the active sample cap, the backend deletes that result and reports the size limit. Shorten the source, choose a smaller retained source window, or raise the local upload cap only for trusted local work.

## Reset Local Runtime Data

Remove backend cache data:

```sh
make clean-cache
```

Sample-processing jobs, diarization transcripts, generated speaker streams, and intermediate stems live under ignored `storage/sample-processing/`. Docker-routed Demucs, pyannote, and faster-whisper model caches live under ignored `storage/model-cache/`. Remove either directory when you want to clear local processing artifacts or force model downloads again.

Generated audio saved in the browser can be removed from `Generated Audio` with Remove or Clear All. The section also lets you choose a browser storage cap of 25 MB, 50 MB, 100 MB, or 250 MB. Lowering the cap prompts before pruning older saved audio. Saved generated audio metadata includes model, provider request metadata when returned, tuning snapshot metadata when available, and browser-measured generation elapsed time for new generations.

Remove containers and volumes:

```sh
make destroy
```
