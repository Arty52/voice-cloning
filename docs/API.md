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
- `POST /api/speech`

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
        "recommendedMaxSeconds": 120
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

Voice payloads include `voicePresetId` alongside the active sample metadata. Active provider samples are capped at 10 MB. Original source files retained for `sourceWindow` assets are local-only and capped at 50 MB. For the built-in ElevenLabs provider, `/api/providers` reports a 120-second maximum sample window with a 60-120 second recommended window. Existing voice manifest entries without sample-window metadata are treated as `excerpt` assets.
Existing voice manifest entries without preset metadata, or with an unsupported preset id, are migrated to `standardNarration`.

`PATCH /api/voices/{voiceId}` accepts JSON and updates a local voice without changing its stable local id or sample file:

```json
{ "name": "Voice_Clone_01", "voicePresetId": "animatedDialogue" }
```

Both fields are optional, but at least one of `name` or `voicePresetId` is required. Existing clients that send only `name` keep working.

`DELETE /api/voices/{voiceId}` removes a local voice sample and reassigns the default to the first remaining voice, or to none when the library is empty.

`PUT /api/voices/default` accepts JSON:

```json
{ "voiceId": "voice-clone-01" }
```

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
