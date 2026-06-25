# Architecture Standards

Voice Clone Lab is a small local app, but changes should still keep clear boundaries between transport, state, and presentation. Public-repo safety is part of the architecture: provider keys stay local to `.env` or browser storage, generated/runtime assets stay out of git, and UI code talks only to the local API.

## Project Shape

- `backend/src/voice_cloning/` contains the FastAPI app, provider adapters, provider registry, local voice library, cache, and configuration. As backend workflows grow, route handlers should split toward service modules and serializer helpers instead of accumulating orchestration in one route file.
- `frontend/src/` contains the Vite React app, UI components, recorder/storage helpers, and shared utilities. As frontend workflows grow, data loading and mutations should split toward feature hooks and API helpers instead of accumulating in `App.tsx`.
- `assets/voices/` is local user-provided voice input. Track only documentation/placeholders. Active sample files are the provider-facing clone inputs; optional originals under `assets/voices/sources/` are local-only traceability files.
- `storage/` is runtime output/cache data. Do not commit generated audio or provider cache files.

## Backend Boundaries

- API route modules should stay thin. They parse HTTP inputs, call services, and map domain/client failures to HTTP responses.
- Service modules own orchestration, such as selecting a local voice, using the clone cache, calling the active provider contract, and assembling domain results.
- Provider adapter modules own third-party HTTP details, provider key resolution, provider-specific tuning metadata, setting normalization, error sanitization, and conversion from provider payloads into internal dataclasses.
- `ProviderRegistry` owns provider lookup and default-provider selection. Routes should resolve providers through the registry instead of importing concrete provider adapters.
- Serializer modules own public API response shapes and headers. Preserve route paths, request fields, response fields, and headers unless a change explicitly updates the API contract.
- Provider key material must never appear in serialized responses. Browser-provided keys may be accepted through explicit request headers, resolved in routes/services, and passed to clients for that request only.
- Domain helpers should not import FastAPI unless they are specifically route or request/file-upload adapters.
- Voice asset APIs must keep `filePath`, `contentType`, and `sha256` pointed at the active provider sample. Any retained original source file is metadata only and must not be used for provider cloning unless a later explicit workflow promotes a new excerpt.
- `VoiceLibrary` owns local voice asset persistence, including `voicePresetId`. The current implementation is manifest-backed under ignored `assets/voices/` data, and it normalizes missing or invalid preset ids to `standardNarration` before writing.
- Keep voice persistence behind the `VoiceLibrary` API and route/service contract. A future PostgreSQL-backed library should be able to replace the manifest implementation without changing frontend request shapes or provider adapter contracts.
- Sample-processing routes should stay behind `SampleProcessingService`. The service owns job state, source selection, result path safety, assignment updates, and saving processed results through `VoiceLibrary`; processor adapters own external tool execution such as Demucs, FFmpeg, and diarization engines. Runtime job data belongs under ignored `storage/sample-processing/`.
- Multi-voice speech generation should stay behind `SpeechJobService`. The service owns speech job state, segment validation, provider/cache orchestration through the existing single-segment speech service, cancellation, segment regeneration, and final audio assembly. Runtime speech job data belongs under ignored `storage/speech-jobs/`.

## Frontend Boundaries

- Smart containers and hooks own data loading, mutations, browser APIs, localStorage/IndexedDB access, side effects, and derived state.
- Dumb UI components receive props, render markup, and emit callbacks. They should not call `fetch`, read local storage directly, access IndexedDB directly, or contain business workflow branching.
- API helpers own `/api/*` request construction, error parsing, and response/header parsing.
- Hooks should be feature scoped: provider keys, voice library, metadata, generated audio storage, speech generation, recording/upload flow, and dialogs are separate responsibilities.
- `useVoiceStudioController` is the app orchestration boundary. It composes feature hooks, exposes derived workflow state, and keeps `App.tsx` focused on wiring section pages.
- `workflow-sections.ts` owns top-level section ids, labels, icons, stable hash fragments, and status derivation. Add future parent workflow areas there only when the existing parents no longer fit.
- `useWorkflowNavigation` owns hash-backed active-section state. The app intentionally uses stable hash sections instead of React Router for this local single-page workflow.
- `VoiceStudioShell` owns the desktop sidebar, mobile sheet navigation, active section header, and status badges. Section page components stay mounted and are hidden when inactive so local form, upload, preview, provider-key, archive, and in-flight generation state survives navigation.
- Speech-generation hooks own browser-observed operational metadata such as `generationElapsedMs`. Treat this as user-perceived request duration, measured from the browser before the local API request until the generated audio blob is received; do not require providers to return equivalent timing metadata.
- Provider-specific tuning controls, presets, defaults, and source links come from `/api/providers`. Frontend UI should render those descriptors generically instead of hardcoding provider-specific tuning constants.
- Provider-independent voice presets come from `/api/providers` as top-level `voicePresets`. A selected voice's `voicePresetId` initializes saved Voice Tuning through the active provider preset whose `voicePresetId` matches. If no active provider preset is mapped to that semantic id, the frontend falls back to provider `defaultValues`. Saved tuning belongs with voice selection, uses local draft state until Save Voice Tuning, and persists through the existing voice PATCH path. Generate Speech keeps only contextual row or segment overrides.
- Provider-specific sample limits come from `/api/providers`. Frontend upload/crop flows should use those limits to prepare active samples before calling `/api/voices`.
- Add Voice and Sample Processing UI both belong under the `Prepare Audio` parent area behind a lightweight workflow chooser. Keep sample-processing controls outside the Add Voice form: feature hooks should call `/api/sample-processing/*`, poll jobs, manage section-local elapsed time, manage result preview URLs, and save the selected result explicitly before adding it to the Voice Library. Future diarization or speaker-separation work should extend this parent area rather than rename it around one operation.
- Multi-voice or section-based text generation should extend the `Generate Speech` parent area. Keep the parent label generic enough that future generation modes can fit without renaming the top-level workflow.
- Browser audio-window utilities own decode, clamping, and active excerpt generation. They should produce provider-facing excerpts without server-side ffmpeg, while upload hooks decide whether to include the local-only original source file.
- Shared constants, types, and formatters belong outside feature components so tests and future features can reuse them without importing a giant app file.

## Split Before Monolith

- Add a new file or feature folder when a change combines state, side effects, and UI rendering.
- Do not let `App.tsx`, a route module, or a service module become the default destination for unrelated logic.
- If a file starts owning multiple workflows, split by architectural responsibility first, then by visual component only where that improves readability.
- Prefer a small explicit prop surface over importing a container hook inside a presentational component.

## Testing Expectations

- Backend changes must keep API contract coverage for routes and add focused tests for service or serializer behavior when logic moves out of routes.
- Provider changes must include tests for lookup, key fallback, clone cache namespace, unavailable metadata, setting validation, and sanitized provider errors.
- Frontend changes must keep user-behavior coverage with Testing Library and add focused tests for hooks/utilities when logic moves out of `App.tsx`.
- Run `make check` before publishing a branch. `make smoke-live` remains optional because it calls ElevenLabs and can consume credits.
- When visible UI text changes, update tests that query by accessible names and keep the project casing rules from `CONTRIBUTING.md`.

## Provider Extensions

Use [ADDING_PROVIDER.md](ADDING_PROVIDER.md) for the contributor checklist. A provider addition should generally be an adapter, registry wiring, tests, and docs. Do not spread provider-specific request payloads, tuning semantics, or secret handling into route handlers or frontend components.

Providers may expose their own tuning preset ids and values, but semantic voice preset assignments stay provider-independent. When a provider has an equivalent preset, map it with `voicePresetId` instead of teaching frontend code to understand that provider's preset naming.
