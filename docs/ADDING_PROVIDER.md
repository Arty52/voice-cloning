# How To Add A Provider

Voice Clone Lab uses ElevenLabs as the built-in provider, but backend services and frontend controls communicate through provider metadata and a provider contract. A new provider should be reviewable as an isolated adapter plus focused tests.

## Provider Options

- Full voice-clone provider: supports sample upload, cloned voice reuse, TTS generation, model metadata, quota metadata, and optional tuning controls.
- TTS-only provider: can generate from an existing provider voice id, but needs an explicit product decision before it can fit the local sample-to-clone workflow.
- Provider without quota metadata: return an unavailable subscription payload through the metadata route and keep generation usable.
- Provider without model metadata: return an unavailable models payload and use the provider default model id.
- Provider without tuning controls: expose empty `controls`, `presets`, and `defaultValues`; the UI hides Voice Tuning for that provider.
- Provider with provider-specific tuning: define controls, defaults, validation, and presets in the adapter. Do not add provider-specific tuning constants to the frontend.
- Providers are not expected to report generated-audio wall-clock timing. The browser records provider-agnostic `generationElapsedMs` for saved generated audio; provider-specific latency fields should remain out of the provider contract unless a future feature explicitly normalizes them.

## Implementation Checklist

- Add a provider descriptor with stable `id`, Title Case `label`, key/docs URLs, optional provider links, and tuning metadata.
- Implement the provider protocol: key resolution, subscription metadata, model list, voice clone creation, speech generation, and voice setting normalization.
- Keep third-party HTTP payloads and error parsing inside the provider adapter.
- Map provider models and quota data into internal dataclasses before routes serialize them.
- Validate `voiceSettings` against the provider's tuning controls and reject unsupported ids with a clear 422.
- Use provider id plus active key fingerprint for cache namespaces so one provider/account never reuses another provider/account's clone id.
- Register the provider in `ProviderRegistry` and keep the intended default explicit.
- Add backend tests for provider lookup, key fallback, model/quota unavailable paths, clone cache behavior, setting normalization, and sanitized errors.
- Add frontend tests if provider metadata changes visible controls, presets, links, or request payloads.
- Update README/API docs when adding new environment variables, permissions, or live smoke behavior.

## Tuning Metadata

Provider tuning metadata is public UI metadata, not secret configuration. Controls support these shapes:

- `slider`: numeric `defaultValue`, `min`, `max`, and `step`.
- `toggle`: boolean `defaultValue`.
- `select`: scalar `defaultValue` plus labeled options.

Control ids are provider payload keys. Labels and presets use Title Case; descriptions use sentence case. Presets are optional provider-specific value maps. If a provider's concepts do not match ElevenLabs Stability, Style, or Speaker Boost, use that provider's own names and meanings.

## Public Safety Checklist

- Do not commit API keys, `.env` secrets, real voice samples, generated audio, or provider runtime cache data.
- Do not serialize backend `.env` keys or browser-provided keys in any response.
- Keep browser-entered keys in browser-local storage and send them only to the local API through `X-Voice-Provider-Key`.
- Sanitize provider errors before returning them to the browser; never include raw request headers, API keys, account internals, or full provider payloads.
- Keep real provider calls in optional smoke tests because they can consume credits.

## Validation Checklist

- Run `make test-backend` after backend adapter or API changes.
- Run `make test-frontend` after provider metadata changes visible UI behavior.
- Run `make check` before publishing a branch.
- Use `make smoke-live` only when you intentionally want a real provider call; document any provider-specific cost or side effect first.
