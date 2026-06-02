# Architecture Standards

Voice Clone Lab is a small local app, but changes should still keep clear boundaries between transport, state, and presentation. Public-repo safety is part of the architecture: provider keys stay local to `.env` or browser storage, generated/runtime assets stay out of git, and UI code talks only to the local API.

## Project Shape

- `backend/src/voice_cloning/` contains the FastAPI app, ElevenLabs client, local voice library, cache, and configuration. As backend workflows grow, route handlers should split toward service modules and serializer helpers instead of accumulating orchestration in one route file.
- `frontend/src/` contains the Vite React app, UI components, recorder/storage helpers, and shared utilities. As frontend workflows grow, data loading and mutations should split toward feature hooks and API helpers instead of accumulating in `App.tsx`.
- `assets/voices/` is local user-provided voice input. Track only documentation/placeholders.
- `storage/` is runtime output/cache data. Do not commit generated audio or provider cache files.

## Backend Boundaries

- API route modules should stay thin. They parse HTTP inputs, call services, and map domain/client failures to HTTP responses.
- Service modules own orchestration, such as selecting a local voice, using the clone cache, calling ElevenLabs, and assembling domain results.
- Client modules own third-party HTTP details and convert provider payloads into internal dataclasses.
- Serializer modules own public API response shapes and headers. Preserve route paths, request fields, response fields, and headers unless a change explicitly updates the API contract.
- Provider key material must never appear in serialized responses. Browser-provided keys may be accepted through explicit request headers, resolved in routes/services, and passed to clients for that request only.
- Domain helpers should not import FastAPI unless they are specifically route or request/file-upload adapters.

## Frontend Boundaries

- Smart containers and hooks own data loading, mutations, browser APIs, localStorage/IndexedDB access, side effects, and derived state.
- Dumb UI components receive props, render markup, and emit callbacks. They should not call `fetch`, read local storage directly, access IndexedDB directly, or contain business workflow branching.
- API helpers own `/api/*` request construction, error parsing, and response/header parsing.
- Hooks should be feature scoped: provider keys, voice library, metadata, generated audio storage, speech generation, recording/upload flow, and dialogs are separate responsibilities.
- Shared constants, types, and formatters belong outside feature components so tests and future features can reuse them without importing a giant app file.

## Split Before Monolith

- Add a new file or feature folder when a change combines state, side effects, and UI rendering.
- Do not let `App.tsx`, a route module, or a service module become the default destination for unrelated logic.
- If a file starts owning multiple workflows, split by architectural responsibility first, then by visual component only where that improves readability.
- Prefer a small explicit prop surface over importing a container hook inside a presentational component.

## Testing Expectations

- Backend changes must keep API contract coverage for routes and add focused tests for service or serializer behavior when logic moves out of routes.
- Frontend changes must keep user-behavior coverage with Testing Library and add focused tests for hooks/utilities when logic moves out of `App.tsx`.
- Run `make check` before publishing a branch. `make smoke-live` remains optional because it calls ElevenLabs and can consume credits.
- When visible UI text changes, update tests that query by accessible names and keep the project casing rules from `CONTRIBUTING.md`.
