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
        "maxSourceUploadBytes": 1073741824
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

## Sample Processing

Sample Processing prepares local samples without changing the normal generation flow. Enabled operations depend on local processor configuration: `SAMPLE_PROCESSING_ENGINE=demucs` enables `isolateVoice` and `trimSilence`, `SAMPLE_PROCESSING_ENGINE=ffmpeg` enables only `trimSilence`, and diarization-capable processors enable `separateSpeakers`.

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
    }
  ]
}
```

`POST /api/sample-processing/jobs` accepts multipart form fields:

- `operationId`: required for legacy one-step jobs; operation id is currently `isolateVoice`, `trimSilence`, or `separateSpeakers` when the matching local processor is enabled
- `processingPresetId`: optional operation preset id; Isolate Voice defaults to `balanced`, and Trim Silence defaults to `trimBalanced`
- `workflowSteps`: optional JSON array for stacked workflows. When provided, it replaces `operationId`/`processingPresetId` and is canonicalized into the recommended backend order.
- `sourceVoiceId`: optional saved local voice id
- `sourcePreference`: optional, either `original` or `active`; `original` uses the retained full upload/source file when one exists and falls back to the active provider-facing sample when none exists; `active` always uses the provider-facing sample currently stored for the selected voice
- `sourceFile`: optional uploaded audio source

Exactly one of `sourceVoiceId` or `sourceFile` is required. The endpoint returns `202` with the created job:

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
    "sourcePreference": "original",
    "engine": "demucs",
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

`POST /api/sample-processing/jobs/{jobId}/cancel` cancels a pending or running job and returns `{ "job": { ... } }`. Cancel is idempotent for `success`, `error`, and `canceled` jobs. FFmpeg and Demucs subprocesses are killed on cancellation. Pyannote and faster-whisper model calls are marked canceled immediately and later pipeline steps are skipped; already-running thread-backed model inference may finish in the background.

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

`POST /api/speech/jobs/{jobId}/cancel` cancels a pending or running job and returns the updated job. Cancel is idempotent for terminal jobs.

`GET /api/speech/jobs/{jobId}/result` streams the combined `audio/mpeg` result after success. The Generate Speech UI saves this combined audio in browser IndexedDB and records Multi-Voice metadata such as the job id, segment count, voice summary, and result hashes.

`GET /api/speech/jobs/{jobId}/segments/{segmentId}/result` streams an individual generated segment after that segment succeeds. Segment result URLs are intended for the latest active job's per-segment playback controls; they are runtime job artifacts, not durable archive URLs. Combined and segment result endpoints return `409` until their audio is ready.

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
