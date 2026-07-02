# API Reference

The FastAPI service is available at `http://localhost:6420` when the Docker stack is running.

## Routes

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
- `GET /api/sample-processing/options`
- `POST /api/sample-processing/sources`
- `GET /api/sample-processing/sources/{sourceId}`
- `GET /api/sample-processing/sources/{sourceId}/media`
- `GET /api/sample-processing/sources/{sourceId}/preview`
- `DELETE /api/sample-processing/sources/{sourceId}`
- `POST /api/sample-processing/jobs`
- `GET /api/sample-processing/jobs/{jobId}`
- `GET /api/sample-processing/jobs/{jobId}/result`
- `GET /api/sample-processing/jobs/{jobId}/source`
- `GET /api/sample-processing/jobs/{jobId}/speakers/{speakerId}/result`
- `PATCH /api/sample-processing/jobs/{jobId}/speaker-assignments`
- `POST /api/sample-processing/jobs/{jobId}/voice`
- `POST /api/sample-processing/jobs/{jobId}/speaker-voices`
- `POST /api/speech`
- `POST /api/speech/jobs`
- `GET /api/speech/jobs/{jobId}`
- `POST /api/speech/jobs/{jobId}/cancel`
- `GET /api/speech/jobs/{jobId}/result`
- `GET /api/speech/jobs/{jobId}/segments/{segmentId}/result`
- `POST /api/speech/jobs/{jobId}/segments/{segmentId}/regenerate`
- `GET /api/generated-audio`
- `POST /api/generated-audio`
- `GET /api/generated-audio/usage`
- `PUT /api/generated-audio/storage-limit`
- `GET /api/generated-audio/{audioId}/audio`
- `DELETE /api/generated-audio/{audioId}`
- `DELETE /api/generated-audio`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/voice-tuning-presets`
- `POST /api/voice-tuning-presets`
- `PUT /api/voice-tuning-presets/{presetId}`
- `DELETE /api/voice-tuning-presets/{presetId}`

Provider-backed routes accept an optional `providerId` request value and an optional `X-Voice-Provider-Key` header. When `providerId` is omitted, the backend uses `defaultProviderId`. When the header is present and non-empty, the browser-provided key overrides the selected provider's backend fallback key; otherwise the backend falls back to `.env`. The API never returns either key.

## Providers

`GET /api/providers` returns public provider metadata for the key manager:

```json
{
  "defaultProviderId": "elevenlabs",
  "voicePresets": [
    {
      "id": "standardNarration",
      "label": "Standard Narration",
      "description": "Balanced clone similarity for steady narration."
    },
    {
      "id": "animatedDialogue",
      "label": "Animated Dialogue",
      "description": "More expressive delivery for character reads."
    }
  ],
  "providers": [
    {
      "id": "elevenlabs",
      "label": "ElevenLabs",
      "serverKeyConfigured": true,
      "manageKeyUrl": "https://elevenlabs.io/app/subscription/api",
      "docsUrl": "https://elevenlabs.io/docs/api-reference/authentication",
      "links": [
        {
          "label": "API Requests",
          "href": "https://elevenlabs.io/app/developers/analytics/api-requests"
        }
      ],
      "tuning": {
        "controls": [
          {
            "id": "stability",
            "label": "Stability",
            "description": "Lower values allow more expressive, variable delivery.",
            "type": "slider",
            "defaultValue": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.01
          }
        ],
        "presets": [
          {
            "id": "standard",
            "voicePresetId": "standardNarration",
            "label": "Standard Narration",
            "description": "Balanced clone similarity for steady narration.",
            "values": {
              "stability": 0.5
            }
          }
        ],
        "defaultValues": {
          "stability": 0.5
        }
      },
      "sample": {
        "maxWindowSeconds": 120,
        "recommendedMinSeconds": 60,
        "recommendedMaxSeconds": 120,
        "targetSampleRateHz": 16000,
        "maxUploadBytes": 10485760,
        "maxSourceUploadBytes": 1073741824,
        "maxSelectedSourceAudioBytes": 1073741824
      }
    }
  ]
}
```

`voicePresets` are provider-independent local voice assignments. Provider tuning presets may include
`voicePresetId` when they implement one of those semantic presets. If a future provider uses different
provider-specific preset ids or setting names, it should still map equivalent tuning values to the shared
voice preset id.

## Subscription And Models

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

If model metadata is unavailable, generation still works by omitting `modelId` and letting the provider use its default model id. For the built-in ElevenLabs provider, that default is `ELEVENLABS_MODEL_ID`.

## Voices

`POST /api/voices` accepts multipart form fields:

- `name`: local voice display name
- `sampleFile`: active provider sample to store in `assets/voices/`; this is the only voice sample sent to the provider for cloning
- `sampleMode`: optional, either `excerpt` or `sourceWindow`; defaults to `excerpt`
- `sourceFile`: optional original audio file to keep locally when `sampleMode` is `sourceWindow`
- `windowStartSeconds`: optional selected window start time in seconds
- `windowDurationSeconds`: optional selected window duration in seconds
- `voicePresetId`: optional local preset assignment, either `standardNarration` or `animatedDialogue`; defaults to `standardNarration`

Voice payloads include `voicePresetId` and `voiceSettingsByProvider` alongside the active sample metadata. `voiceSettingsByProvider` is keyed by provider id and stores normalized provider-specific tuning that should replace preset-derived tuning for that voice when the same provider is active. New active provider samples are normalized to mono 16 kHz WAV before persistence and capped by `MAX_UPLOAD_BYTES`, which defaults to 10 MB. Original source files retained for `sourceWindow` assets are local-only, are not sent to providers, and are capped by `MAX_SOURCE_UPLOAD_BYTES`, which defaults to 1 GB. For the built-in ElevenLabs provider, `/api/providers` reports a 120-second maximum sample window with a 60-120 second recommended window. Existing voice manifest entries without sample-window metadata are treated as `excerpt` assets.
Existing voice manifest entries without preset metadata, or with an unsupported preset id, are migrated to `standardNarration`.
Existing voice manifest entries without saved provider tuning are migrated to `voiceSettingsByProvider: {}`.
Existing voice manifest entries without processing metadata are migrated to `processingSteps: []`.

`PATCH /api/voices/{voiceId}` accepts JSON and updates a local voice without changing its stable local id or sample file:

```json
{
  "name": "Voice_Clone_01",
  "voicePresetId": "animatedDialogue",
  "providerId": "elevenlabs",
  "voiceSettings": { "speed": 1.15 }
}
```

All fields are optional, but at least one of `name`, `voicePresetId`, or `voiceSettings` is required. When `voiceSettings` is present, `providerId` is required and the settings are validated and normalized by that provider before being saved under `voiceSettingsByProvider[providerId]`. Existing clients that send only `name` keep working.

`DELETE /api/voices/{voiceId}` removes a local voice sample and reassigns the default to the first remaining voice, or to none when the library is empty.

`PUT /api/voices/default` accepts JSON:

```json
{ "voiceId": "voice-clone-01" }
```

## Generated Audio Archive

Generated-audio archive routes require backend persistence. When `DATABASE_URL` is blank, these routes return `503` and the frontend continues using IndexedDB as a local draft/cache store. Archive files are stored under `GENERATED_AUDIO_STORAGE_DIR`; clients never send file paths. The frontend treats a valid `GET /api/generated-audio` payload as server archive availability, then imports existing IndexedDB records idempotently by stable id without deleting browser data.

`GET /api/generated-audio` returns saved metadata and current usage:

```json
{
  "items": [
    {
      "id": "audio-123",
      "audioUrl": "/api/generated-audio/audio-123/audio",
      "contentType": "audio/mpeg",
      "sizeBytes": 898656,
      "sha256": "abc123...",
      "createdAt": "2026-07-01T12:00:00+00:00",
      "cacheState": "miss",
      "providerId": "elevenlabs",
      "voiceId": "provider-voice-id",
      "appVoiceId": "local-voice-id",
      "voiceName": "Narrator",
      "modelId": "eleven_multilingual_v2",
      "characterCount": 120,
      "requestId": "req_123",
      "generationElapsedMs": 1234,
      "multiVoiceMetadata": null,
      "tuningMetadata": null
    }
  ],
  "usage": {
    "itemCount": 1,
    "limitBytes": 104857600,
    "remainingBytes": 103958944,
    "usedBytes": 898656
  }
}
```

`POST /api/generated-audio` accepts multipart form data:

- `id`: stable client/generated id or idempotency key
- `audioFile`: generated audio file
- `createdAt`, `cacheState`, `providerId`, `voiceId`, `appVoiceId`, `voiceName`, `modelId`, `characterCount`, `requestId`, `generationElapsedMs`: optional metadata
- `multiVoiceMetadata`, `tuningMetadata`: optional JSON objects

The save response includes `item`, `usage`, `prunedIds`, and `alreadyExisted`. Retrying with the same `id` and same audio hash returns the existing item. Retrying with the same `id` and different audio hash returns `409`.

`GET /api/generated-audio/{audioId}/audio` streams the archived audio file. `DELETE /api/generated-audio/{audioId}` removes one archive item and file. `DELETE /api/generated-audio` clears the archive. `GET /api/generated-audio/usage` returns only usage.

`PUT /api/generated-audio/storage-limit` accepts JSON and prunes oldest items by default:

```json
{ "limitBytes": 104857600, "prune": true }
```

Generated-audio server export routes require backend persistence. They never accept filesystem paths from the client. When `GENERATED_AUDIO_EXPORT_DIR` is blank, `GET /api/generated-audio/export-status` returns export availability as `false`, while export mutation routes return `503`.

- `POST /api/generated-audio/{audioId}/export`
- `POST /api/generated-audio/export-all`
- `GET /api/generated-audio/export-status`

When configured, the backend exports from the canonical archive into `GENERATED_AUDIO_EXPORT_DIR/Voice Clone Lab Archive/`, with audio and sidecar files under `generated-audio/YYYY/MM/` plus `index/generated-audio.jsonl`. The export ledger is keyed by target id, audio id, and sha256 so re-exporting the same archive item is idempotent and a later changed hash records a separate status entry.

Export status returns:

```json
{
  "available": true,
  "targetId": "local-filesystem",
  "items": [
    {
      "targetId": "local-filesystem",
      "audioId": "audio-123",
      "sha256": "abc123...",
      "filename": "generated-audio/2026/07/20260701T184522Z--default-voice--eleven-multilingual-v2--abc12345.mp3",
      "status": "exported",
      "exportedAt": "2026-07-01T18:45:23+00:00",
      "lastError": null,
      "updatedAt": "2026-07-01T18:45:23+00:00"
    }
  ]
}
```

## App Settings

App settings routes require backend persistence. When `DATABASE_URL` is blank, these routes return `503` and the frontend keeps using browser-local fallbacks. These routes are allowlisted for non-secret preferences only; provider API keys are never accepted.

`GET /api/settings` returns:

```json
{
  "available": true,
  "settings": {
    "generatedAudioStorageLimit": { "limitBytes": 104857600 },
    "naturalHandoffs": { "enabled": true },
    "selectedModelByProvider": { "elevenlabs": "eleven_multilingual_v2" }
  }
}
```

`PUT /api/settings` accepts the same allowlisted setting keys under `settings`. Unknown keys, malformed values, and secret-like settings are rejected:

```json
{
  "settings": {
    "naturalHandoffs": { "enabled": false },
    "selectedModelByProvider": { "elevenlabs": "eleven_flash_v2_5" }
  }
}
```

## User Tuning Presets

User tuning preset routes require backend persistence. When `DATABASE_URL` is blank, these routes return `503`; browser-local fallback is handled by the frontend. Provider API keys and secret-like setting names are never accepted.

`GET /api/voice-tuning-presets` returns:

```json
{
  "available": true,
  "presets": [
    {
      "id": "warm-narration",
      "name": "Warm Narration",
      "providerId": "elevenlabs",
      "voicePresetId": "standardNarration",
      "settings": {
        "stability": 0.42,
        "similarityBoost": 0.75,
        "style": 0,
        "speed": 0.95,
        "useSpeakerBoost": true
      },
      "createdAt": "2026-07-01T12:00:00+00:00",
      "updatedAt": "2026-07-01T12:00:00+00:00"
    }
  ]
}
```

`POST /api/voice-tuning-presets` creates a user-managed preset. `id` is optional; when supplied it must be a safe stable id and conflicts return `409`. `PUT /api/voice-tuning-presets/{presetId}` replaces the editable preset fields; if the request body includes `id`, it must match `{presetId}`. `providerId` must be registered, `voicePresetId` must be `standardNarration`, `animatedDialogue`, or `null`, and `settings` must contain only controls supported by that provider. The backend persists normalized settings, so omitted supported controls are filled with provider defaults and unknown controls are rejected:

```json
{
  "id": "warm-narration",
  "name": "Warm Narration",
  "providerId": "elevenlabs",
  "voicePresetId": "standardNarration",
  "settings": {
    "stability": 0.42,
    "speed": 0.95
  }
}
```

`DELETE /api/voice-tuning-presets/{presetId}` removes the preset and returns `{ "deleted": true }` when a row was deleted.

## Sample Processing

Sample Processing prepares local samples without changing the normal generation flow. Enabled operations depend on local processor configuration: `SAMPLE_PROCESSING_ENGINE=demucs` enables `isolateVoice` and `trimSilence`, `SAMPLE_PROCESSING_ENGINE=ffmpeg` enables only `trimSilence`, diarization-capable processors enable `separateSpeakers`, and `prepareVoice` is enabled whenever FFmpeg is available.

Operations can run alone or as a backend-owned stack. The recommended stacked order is `isolateVoice`, then `separateSpeakers`, then `trimSilence`. If Speaker Separation is selected, Trim Silence runs after the split on each generated speaker stream; otherwise it runs on the single current audio result.

`GET /api/sample-processing/options` returns the operation registry for the configured processor:

```json
{
  "engine": "demucs+pyannote-community-1+faster-whisper",
  "recommendedWorkflowOrder": ["isolateVoice", "separateSpeakers", "trimSilence"],
  "operations": [
    {
      "id": "isolateVoice",
      "label": "Isolate Voice",
      "description": "Separate the vocal stem from music or background audio with Demucs.",
      "enabled": true,
      "defaultProcessingPresetId": "balanced",
      "processingPresets": [
        {
          "id": "fast",
          "label": "Fast",
          "description": "Quickest preview with lighter separation quality."
        },
        {
          "id": "balanced",
          "label": "Balanced",
          "description": "Default vocal isolation quality and runtime."
        },
        {
          "id": "clean",
          "label": "Clean",
          "description": "Balanced isolation with conservative cleanup for background residue."
        },
        {
          "id": "maxIsolation",
          "label": "Max Isolation",
          "description": "Slower, strongest separation attempt for difficult tracks."
        }
      ]
    },
    {
      "id": "trimSilence",
      "label": "Trim Silence",
      "description": "Remove leading, trailing, and long interior empty sections with FFmpeg.",
      "enabled": true,
      "defaultProcessingPresetId": "trimBalanced",
      "processingPresets": [
        {
          "id": "trimLight",
          "label": "Light",
          "description": "Conservative trimming for only quieter or longer empty regions."
        },
        {
          "id": "trimBalanced",
          "label": "Balanced",
          "description": "Default silence trimming with a small amount of preserved room tone."
        },
        {
          "id": "trimAggressive",
          "label": "Aggressive",
          "description": "Tighter trimming for shorter or louder empty regions."
        }
      ]
    },
    {
      "id": "prepareVoice",
      "label": "Prepare Voice",
      "description": "Clean, rank, trim, and normalize provider-sized voice samples.",
      "enabled": true,
      "defaultProcessingPresetId": null,
      "processingPresets": []
    }
  ]
}
```

`POST /api/sample-processing/sources` accepts multipart `sourceFile` and stages an inspectable source media file under ignored `storage/sample-processing/sources/`. It accepts the same audio upload validation as sample processing, including `.m4b` files and MPEG-4 audio MIME aliases such as `audio/mp4`, `audio/mp4a-latm`, `audio/m4b`, and `audio/x-m4b`. It also accepts local video source media in `.mp4`, `.m4v`, and `.mov` containers with `video/mp4`, `video/x-m4v`, or `video/quicktime`. WebM, MKV, AVI, WMV, FLV, TS, MTS, and M2TS are intentionally deferred. Direct job `sourceFile` uploads remain audio-only; upload video through this staged source endpoint, then create a job with `sourceMediaId` and `sourceRanges`.

The response includes FFprobe duration, media kind, parsed audio stream metadata, the first audio stream selected for extraction by default, first audio stream sample rate, parsed chapters when present, and warnings. A probed video without any audio stream is rejected:

```json
{
  "source": {
    "id": "source-id",
    "filename": "clip.mp4",
    "contentType": "video/mp4",
    "sizeBytes": 123,
    "sha256": "...",
    "durationSeconds": 3600.0,
    "sampleRateHz": 44100,
    "mediaKind": "video",
    "audioStreams": [
      {
        "index": 1,
        "codecName": "aac",
        "sampleRateHz": 44100,
        "channels": 2,
        "channelLayout": "stereo",
        "language": "eng",
        "title": "Main Audio"
      }
    ],
    "selectedAudioStream": {
      "index": 1,
      "codecName": "aac",
      "sampleRateHz": 44100,
      "channels": 2,
      "channelLayout": "stereo",
      "language": "eng",
      "title": "Main Audio"
    },
    "selectedAudioStreamIndex": 1,
    "chapters": [
      {
        "id": "chapter-1",
        "title": "Chapter 1",
        "startSeconds": 0.0,
        "endSeconds": 420.5,
        "durationSeconds": 420.5
      }
    ],
    "warnings": []
  }
}
```

`GET /api/sample-processing/sources/{sourceId}` returns the staged metadata. `GET /api/sample-processing/sources/{sourceId}/media` streams the staged media file with its stored content type for browser-native playback, including video preview when the browser supports the staged container and codecs. `GET /api/sample-processing/sources/{sourceId}/preview?startSeconds=0&durationSeconds=90` returns a cached bounded `audio/mpeg` preview clip for UI playback. `DELETE /api/sample-processing/sources/{sourceId}` removes the staged upload, metadata, and preview cache; the frontend calls it when a source is replaced or after job creation succeeds.

`POST /api/sample-processing/jobs` accepts multipart form fields:

- `operationId`: required for one-step jobs; operation id is currently `prepareVoice`, `isolateVoice`, `trimSilence`, or `separateSpeakers` when the matching local processor is enabled
- `processingPresetId`: optional operation preset id; Isolate Voice defaults to `balanced`, and Trim Silence defaults to `trimBalanced`
- `workflowSteps`: optional JSON array for stacked workflows. When provided, it replaces `operationId`/`processingPresetId` and is canonicalized into the recommended backend order.
- `cleanVoice`: optional boolean for `prepareVoice`; when true and Isolate Voice is available, Demucs runs before candidate scoring
- `detectSpeakers`: optional boolean for `prepareVoice`; when true and Speaker Separation is available, candidates are ranked per detected speaker, otherwise the result includes an unavailable-speaker-detection warning
- `trimCandidates`: optional boolean for `prepareVoice`; defaults to true and applies final Trim Silence-style cleanup before 16 kHz WAV output
- `sourceVoiceId`: optional saved local voice id
- `sourcePreference`: optional, either `original` or `active`; `original` uses the retained full upload/source file when one exists and falls back to the active provider-facing sample when none exists; `active` always uses the provider-facing sample currently stored for the selected voice
- `sourceFile`: optional uploaded audio source; video is not accepted on the direct job upload path
- `sourceMediaId`: optional staged media source id from `POST /api/sample-processing/sources`
- `sourceRanges`: optional JSON array used with `sourceMediaId`; each entry is `{ "startSeconds": number, "endSeconds": number, "label"?: string }`

Exactly one of `sourceVoiceId`, `sourceFile`, or `sourceMediaId` is required. When `sourceMediaId` is used, at least one finite nonnegative `sourceRanges` entry is required, each range must have `endSeconds > startSeconds`, and ranges must fit within known media duration. Selected ranges are extracted in request order from the default first audio stream to mono 16 kHz WAV; multiple ranges are concatenated before processing. The selected extracted audio is capped by `MAX_SELECTED_SOURCE_AUDIO_BYTES`, exposed as `providers[].sample.maxSelectedSourceAudioBytes`, and defaults to `MAX_SOURCE_UPLOAD_BYTES` for backward compatibility.

The endpoint returns `202` with the created job:

For a stacked workflow, send `workflowSteps` as JSON:

```json
[
  { "operationId": "isolateVoice", "processingPresetId": "balanced" },
  { "operationId": "separateSpeakers" },
  { "operationId": "trimSilence", "processingPresetId": "trimBalanced" }
]
```

```json
{
  "job": {
    "id": "sample-job-id",
    "operationId": "isolateVoice",
    "operationLabel": "Isolate Voice",
    "status": "running",
    "workflowMode": "single",
    "activeStepId": "sample-job-id",
    "steps": [
      {
        "id": "sample-job-id",
        "operationId": "isolateVoice",
        "operationLabel": "Isolate Voice",
        "status": "running",
        "engine": "demucs",
        "processingPresetId": "balanced",
        "processingPresetLabel": "Balanced",
        "startedAt": "2026-06-19T12:00:01Z",
        "completedAt": null,
        "error": null,
        "sourceSha256": "abc123",
        "resultSha256": null
      }
    ],
    "processingPresetId": "balanced",
    "processingPresetLabel": "Balanced",
    "sourceName": "Voice_Clone_01",
    "sourceSha256": "abc123",
    "sourceSizeBytes": 7340032,
    "sourcePreference": "original",
    "sourceSelection": {
      "sourceMediaId": "source-id",
      "ranges": [
        {
          "startSeconds": 0.0,
          "endSeconds": 420.5,
          "durationSeconds": 420.5,
          "label": "Chapter 1"
        }
      ]
    },
    "engine": "demucs",
    "estimatedDurationRangeSeconds": null,
    "progressPhases": [],
    "activeProgressPhaseId": null,
    "createdAt": "2026-06-19T12:00:00Z",
    "updatedAt": "2026-06-19T12:00:01Z",
    "error": null,
    "result": null
  }
}
```

`GET /api/sample-processing/jobs/{jobId}` returns the same job shape while polling. A successful single-audio job includes a normalized mono 16 kHz WAV result:

```json
{
  "job": {
    "id": "sample-job-id",
    "status": "success",
    "result": {
      "filename": "result.wav",
      "contentType": "audio/wav",
      "sha256": "def456"
    }
  }
}
```

`GET /api/sample-processing/jobs/{jobId}/result` streams the processed WAV result. The result is available only after the job reaches `success`.

`prepareVoice` streams large uploads to disk, optionally runs Isolate Voice, optionally runs Speaker Separation, detects nonsilent speech on the cleaned/intermediate source, ranks provider-sized windows up to 120 seconds, runs final Trim Silence-style cleanup, and normalizes each candidate to mono 16 kHz PCM WAV. A successful job returns ranked candidates instead of one result file:

```json
{
  "job": {
    "id": "sample-job-id",
    "operationId": "prepareVoice",
    "status": "success",
    "sourceSizeBytes": 34603008,
    "estimatedDurationRangeSeconds": {
      "minSeconds": 84,
      "maxSeconds": 234
    },
    "progressPhases": [
      {
        "id": "sample-job-id-phase-clean-voice",
        "label": "Clean Voice",
        "status": "success",
        "startedAt": "2026-06-19T12:00:01Z",
        "completedAt": "2026-06-19T12:00:42Z",
        "error": null,
        "detail": null
      },
      {
        "id": "sample-job-id-phase-trim-normalize-candidates",
        "label": "Trim And Normalize Candidates",
        "status": "success",
        "startedAt": "2026-06-19T12:01:20Z",
        "completedAt": "2026-06-19T12:01:55Z",
        "error": null,
        "detail": "1 Candidate"
      }
    ],
    "activeProgressPhaseId": null,
    "result": {
      "kind": "preparedSamples",
      "warnings": [],
      "candidates": [
        {
          "candidateId": "speaker-1-candidate-1",
          "rank": 1,
          "score": 92.4,
          "speakerId": "speaker-1",
          "speakerLabel": "Speaker 1",
          "sourceWindow": {
            "startSeconds": 12.4,
            "endSeconds": 118.2,
            "durationSeconds": 105.8
          },
          "durationSeconds": 105.8,
          "sampleRateHz": 16000,
          "contentType": "audio/wav",
          "sha256": "candidatehash",
          "warnings": [],
          "result": {
            "path": "sample-job-id/speaker-1-candidate-1.wav",
            "filename": "speaker-1-candidate-1.wav",
            "contentType": "audio/wav",
            "sha256": "candidatehash"
          }
        }
      ]
    }
  }
}
```

While a `prepareVoice` job is running, `activeProgressPhaseId` points at the currently running entry in `progressPhases`. The phase list is additive to the legacy `steps` array; older clients can continue polling `activeStepId`, while newer clients can render the finer Easy Prepare queue.

`GET /api/sample-processing/jobs/{jobId}/candidates/{candidateId}/result` streams one prepared candidate WAV. `POST /api/sample-processing/jobs/{jobId}/candidate-voices` saves selected candidates through `VoiceLibrary`:

```json
{
  "voices": [
    {
      "candidateId": "speaker-1-candidate-1",
      "name": "Morgan Prepared",
      "voicePresetId": "standardNarration"
    }
  ]
}
```

The response is `201` with `{ "voices": [{ ... }] }`. Saved candidate voices include `processingSteps` metadata with `operationId: "prepareVoice"`, source/result hashes, engine, and speaker id/label.

`POST /api/sample-processing/jobs/{jobId}/cancel` cancels a pending or running job and returns `{ "job": { ... } }`. Cancel is idempotent for `success`, `error`, `canceled`, and `interrupted` jobs. FFmpeg and Demucs subprocesses are killed on cancellation. Pyannote and faster-whisper model calls are marked canceled immediately and later pipeline steps are skipped; already-running thread-backed model inference may finish in the background.

For `trimSilence`, the job `engine` is `ffmpeg`, and the saved `processingSteps` metadata records the selected trim preset. For `isolateVoice`, the job `engine` remains `demucs`.

`POST /api/sample-processing/jobs/{jobId}/voice` saves a successful result as a local voice:

```json
{ "name": "Voice_Clone_01 Isolated", "voicePresetId": "animatedDialogue" }
```

The response is `201` with `{ "voice": { ... } }`. The saved voice is persisted through `VoiceLibrary` as a new local voice. This endpoint does not mutate, refine, overwrite, or replace the source voice. The new voice uses the processed sample as its active `filePath` and includes `processingSteps` metadata with the operation id, engine, source hash, result hash, and selected processing preset when present. Stacked single-audio jobs save one processing step entry per completed stack step.

Speaker Separation jobs return a structured result instead of a single audio file:

```json
{
  "job": {
    "id": "sample-job-id",
    "operationId": "separateSpeakers",
    "status": "success",
    "engine": "pyannote-community-1+faster-whisper",
    "result": {
      "kind": "speakerSeparation",
      "speakers": [
        {
          "id": "speaker-1",
          "label": "Speaker 1",
          "assignedName": "Morgan",
          "transcriptItemIds": ["item-1", "item-3"],
          "result": {
            "path": "sample-job-id/speaker-1.wav",
            "filename": "speaker-1.wav",
            "contentType": "audio/wav",
            "sha256": "speakerhash"
          }
        }
      ],
      "transcript": {
        "items": [
          {
            "id": "item-1",
            "text": "Hello there.",
            "startSeconds": 0.0,
            "endSeconds": 1.2,
            "speakerId": "speaker-1"
          }
        ]
      }
    }
  }
}
```

`GET /api/sample-processing/jobs/{jobId}/source` streams the local source audio for successful Speaker Separation jobs so the frontend can seek and play transcript-selected ranges. For stacked jobs, this is the audio that was fed into diarization after any earlier single-audio steps. It is not used by single-audio jobs.

`GET /api/sample-processing/jobs/{jobId}/speakers/{speakerId}/result` streams one generated speaker WAV for a successful Speaker Separation job. `GET /api/sample-processing/jobs/{jobId}/result` remains reserved for single-audio jobs and returns `409` for Speaker Separation jobs.

`PATCH /api/sample-processing/jobs/{jobId}/speaker-assignments` updates optional speaker names and transcript-item speaker assignments, then asks the configured processor to regenerate affected speaker streams:

```json
{
  "speakerNames": [
    { "speakerId": "speaker-1", "name": "Morgan" }
  ],
  "transcriptAssignments": [
    { "itemId": "item-2", "speakerId": "speaker-1" }
  ]
}
```

The response is `200` with `{ "job": { ... } }` and the updated Speaker Separation result. Unknown speaker ids, unknown transcript item ids, duplicate item assignments, and blank assigned names are rejected.

`POST /api/sample-processing/jobs/{jobId}/speaker-voices` saves any subset of generated speakers to the local Voice Library:

```json
{
  "voices": [
    { "speakerId": "speaker-1", "name": "Morgan", "voicePresetId": "standardNarration" },
    { "speakerId": "speaker-2", "name": "Riley", "voicePresetId": "animatedDialogue" }
  ]
}
```

The response is `201` with `{ "voices": [ ... ] }`. Each saved voice receives a normal `voicePresetId` and `processingSteps` entries for prior stack steps plus speaker-specific split/trim metadata with optional `speakerId` and `speakerLabel` fields. The available `voicePresetId` values are the top-level `/api/providers.voicePresets` values used by normal uploads. Provider authors should map provider-specific tuning controls and presets to those shared semantic presets in [How To Add A Provider](ADDING_PROVIDER.md).

## Speech

`POST /api/speech` accepts multipart form fields:

- `text`: speech text
- `voiceId`: saved local voice id; defaults to the configured local default
- `providerId`: optional provider id; defaults to `defaultProviderId`
- `modelId`: optional provider TTS model id; defaults to the selected provider's default model
- `voiceSettings`: optional JSON object keyed by provider tuning control id

The legacy ElevenLabs form fields `stability`, `similarityBoost`, `style`, `speed`, and `useSpeakerBoost` are still accepted for compatibility. New integrations should use `voiceSettings`.

The response is `audio/mpeg` with these headers:

- `X-Voice-Cache`: `hit` or `miss`
- `X-Voice-Id`: provider voice ID
- `X-App-Voice-Id`: local voice asset ID
- `X-Sample-Sha256`: sample hash
- `X-Character-Count`: actual provider character usage when returned
- `X-Model-Id`: selected or default provider model id used for generation
- `X-Request-Id`: request id when returned by the provider
- `Content-Disposition`: attachment filename for browser downloads

Generation elapsed time is not part of the backend/provider response contract. The frontend measures `generationElapsedMs` around the `/api/speech` request and stores it with browser-local generated audio metadata.

Voice clone cache entries are separated by provider and active key fingerprint, so switching browser keys does not reuse another account's cached voice ID.

### Multi-Voice Speech Jobs

`POST /api/speech/jobs` creates a backend-owned generation job for one script split into ordered voice segments. It accepts JSON and the optional `X-Voice-Provider-Key` header:

```json
{
  "text": "Hello there.",
  "defaultVoiceId": "default",
  "providerId": "elevenlabs",
  "modelId": "eleven_multilingual_v2",
  "voiceSettings": { "stability": 0.5 },
  "segmentGapMs": 250,
  "segments": [
    {
      "clientSegmentId": "segment-one",
      "text": "Hello ",
      "voiceId": "default",
      "assignmentKind": "assigned",
      "voiceSettings": { "speed": 1.1 }
    },
    {
      "clientSegmentId": "segment-two",
      "text": "there.",
      "voiceId": "default",
      "assignmentKind": "default"
    }
  ]
}
```

The optional `segmentGapMs` request field controls the combined-result handoff gap for that job. Omit it or send `null` to use the backend `SPEECH_JOB_SEGMENT_GAP_MS` default. Send `0` for gapless assembly. Each segment may include optional `voiceSettings`; omitted or `null` segment settings copy the job-level `voiceSettings`, while an object becomes that segment's effective tuning snapshot. The backend rejects blank text, text longer than the configured limit, unknown voice ids, negative `segmentGapMs`, non-object `voiceSettings`, empty segment lists, whitespace-only segments, and any payload where `segments.map(text).join("")` does not exactly equal `text`. Provider keys are used only for the active request and are never returned in job payloads.

The response is `202` with `{ "job": { ... } }`:

```json
{
  "job": {
    "id": "job-id",
    "status": "running",
    "text": "Hello there.",
    "defaultVoiceId": "default",
    "segmentGapMs": 250,
    "activeSegmentId": "segment-one",
    "resultSha256": null,
    "error": null,
    "segments": [
      {
        "id": "segment-one",
        "index": 0,
        "text": "Hello ",
        "voiceId": "default",
        "voiceName": "Default Voice",
        "assignmentKind": "assigned",
        "voiceSettings": { "speed": 1.1 },
        "status": "running",
        "generationCount": 0,
        "characterCount": null,
        "requestId": null,
        "cacheState": null,
        "resultSha256": null,
        "error": null
      }
    ]
  }
}
```

`GET /api/speech/jobs/{jobId}` returns the current job state. A successful job has `status: "success"`, every segment has `status: "success"`, and `resultSha256` is populated for both the final audio and each generated segment.

`POST /api/speech/jobs/{jobId}/cancel` cancels a pending or running job and returns the updated job. Cancel is idempotent for terminal jobs, including jobs marked `interrupted` after an API restart.

`GET /api/speech/jobs/{jobId}/result` streams the combined `audio/mpeg` result after success. The Generate Speech UI saves this combined audio in the generated-audio archive, falling back to browser IndexedDB when the server archive is unavailable, and records Multi-Voice metadata such as the job id, segment count, voice summary, and result hashes.

`GET /api/speech/jobs/{jobId}/segments/{segmentId}/result` streams an individual generated segment after that segment succeeds. Segment result URLs are intended for the latest active job's per-segment playback controls; they are runtime job artifacts, not durable archive URLs. Combined and segment result endpoints return `409` until their audio is ready.

When `DATABASE_URL` is configured, sample-processing and speech-generation services also persist sanitized job metadata snapshots in Postgres. `GET` job routes can read those persisted snapshots after app recreation. Active worker tasks still live only in the current API process; stale persisted `pending` or `running` rows are marked `interrupted` on service startup.

`POST /api/speech/jobs/{jobId}/segments/{segmentId}/regenerate` starts regeneration for a successful job segment and rebuilds the combined result. The optional JSON body can change that segment's voice and replace that segment's stored tuning before regenerating. Omit `voiceSettings` or send `null` to preserve the segment's current tuning snapshot.

```json
{
  "voiceId": "another-local-voice",
  "voiceSettings": { "speed": 1.2, "stability": 0.36 }
}
```

Regeneration increments the segment `generationCount`, refreshes the segment and combined `resultSha256` values, and returns `202` with the updated job state while the segment is pending/running.

`POST /api/speech/jobs/{jobId}/voices/{voiceId}/regenerate` starts regeneration for every successful segment in the job that currently uses `voiceId`, then rebuilds the combined result once. The JSON body must include replacement tuning for the affected segments:

```json
{
  "voiceSettings": { "speed": 1.2, "stability": 0.36 }
}
```

Bulk voice regeneration requires an idle successful job and at least one successful segment using that voice. It returns `409` while a job is running or before the job succeeds, and `404` when the job has no successful segments for the requested voice.

Speech jobs keep runtime files under ignored `storage/speech-jobs/`. Segment generation reuses the normal provider clone cache. Final assembly requires FFmpeg through `SAMPLE_PROCESSING_FFMPEG_COMMAND`; Docker includes FFmpeg by default, and host development must have the command available on `PATH` or configured with an absolute path. Combined multi-voice results use the job's effective `segmentGapMs`; when the request omits it, the backend default comes from `SPEECH_JOB_SEGMENT_GAP_MS` and defaults to `250`.
