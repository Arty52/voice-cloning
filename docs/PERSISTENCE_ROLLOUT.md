# Persistence Rollout

This rollout moves durable app state from browser-only or manifest-only storage toward server-backed persistence while preserving current API contracts during the transition.

## Critical Design Decisions

- PostgreSQL is pinned to `postgres:18.4` for reproducible local development. The compose volume mounts at `/var/lib/postgresql`, and `PGDATA` is `/var/lib/postgresql/18/docker` to match the PostgreSQL 18 Docker image layout.
- Backend database access starts with synchronous SQLAlchemy sessions and the `psycopg` driver. The first integrations are metadata reads/writes around existing local workflows; if later routes perform heavy database work inside async request paths, move that work behind explicit async repositories or offload it from the event loop.
- Server-side file roots are configured only by environment: `VOICE_ASSETS_DIR` for voice samples and `GENERATED_AUDIO_STORAGE_DIR` for generated-audio archive files. The backend creates these roots on startup, resolves stored relative paths under them, and never accepts arbitrary storage roots or file paths from frontend requests.
- Database rows and local files must use explicit consistency rules: stage the file first, hash it, insert metadata in a transaction, remove staged files on database failure, roll back database work on file failure, and add reconciliation tests before exposing mutating routes that touch both.
- Imports are idempotent and reportable: same id plus same hash is already imported, same id plus different hash is a conflict or deterministic rename, missing files are skipped with a report, the default voice is preserved, and browser data is never deleted automatically.
- Generated-audio saves need a stable client id or idempotency key before the frontend migrates IndexedDB records to the backend, so retries do not duplicate archive items.
- The app remains a local single-user tool in this stack. Hosted use requires user/account scoping and auth before PostgreSQL becomes canonical for shared data.

## PR Stack

All PRs start as Draft and move to Open only after their validation gates pass.

1. Persistence Foundation And Compose
   - Add SQLAlchemy, Alembic, repository Protocols, unit-of-work helpers, file-store Protocols, configurable storage roots, and compose Postgres.
   - Atomic commits: settings/file-store foundation; Alembic schema; compose and validation targets; docs.
   - Validation: `make check`; `make test-postgres`; `make test-postgres-migrations` for disposable `upgrade head` → `downgrade base` → `upgrade head` validation.
2. Server-Backed Voice Library
   - Add a PostgreSQL implementation behind the existing voice library contract and idempotent `voices.json` import.
   - Runtime selection: `DATABASE_URL` uses the PostgreSQL-backed library; blank `DATABASE_URL` keeps the manifest-backed library.
   - Import behavior: same id plus same hash is already imported; same id plus different hash is copied to `{id}-import-{sha8}`; missing files are skipped with a report; the default voice is preserved when importable; `voices.json` is never deleted automatically.
   - Validation: focused repository/import tests; API voice route regression tests; DB/file consistency tests; `make check`; `make test-postgres`.
3. Server-Backed Generated Audio Archive
   - Add archive metadata repositories, local generated-audio file storage, download/delete routes, and idempotent save semantics.
   - API routes: `GET /api/generated-audio`, `POST /api/generated-audio`, `GET /api/generated-audio/usage`, `PUT /api/generated-audio/storage-limit`, `GET /api/generated-audio/{audioId}/audio`, `DELETE /api/generated-audio/{audioId}`, and `DELETE /api/generated-audio`.
   - Save behavior: stable `id` plus same hash is idempotent; stable `id` plus different hash returns `409`; files are staged under `GENERATED_AUDIO_STORAGE_DIR` before metadata is committed.
   - Validation: file/database consistency tests, archive API route tests, idempotency/conflict tests, `make check`, `make test-postgres`.
4. Frontend Archive And Migration UI
   - Migrate generated-audio archive calls from IndexedDB source-of-truth to server APIs while retaining IndexedDB as cache/draft buffer.
   - Runtime behavior: the frontend probes `GET /api/generated-audio`; a valid archive response activates server mode, while `503`, `404`, fetch failure, or an incomplete transition response keeps browser IndexedDB mode.
   - Migration behavior: existing IndexedDB records upload by stable id; same id plus same hash is marked imported, same id plus different hash is reported as a conflict and not retried, and intentionally removed/cleared ids are remembered so browser records do not resurrect server-cleared items.
   - Browser data is never deleted automatically during server import. Remove/Clear All mutate the active source of truth, while IndexedDB remains local fallback/migration state.
   - Validation: hook/component tests, migration conflict tests, browser smoke, `make check`.
5. Preference And Settings Persistence
   - Move durable app/provider preferences behind backend settings APIs and add any needed settings placement in `#provider` or a dedicated `#settings` section.
   - Implemented settings are allowlisted, non-secret values only: generated-audio storage limit, Natural Handoffs default, and selected model id by provider. Provider API keys remain in browser-local storage or `.env`.
   - Validation: settings API tests, frontend settings tests, `make check`, `make test-postgres`.
6. Durable Job Metadata
   - Add concrete repositories for sample-processing and speech-generation job tables.
   - Persist sanitized job snapshots and status/error columns while keeping active worker tasks in-process.
   - On service startup, mark stale persisted `pending`/`running` rows as `interrupted` rather than pretending work resumed.
   - Validation: repository snapshot tests, interrupted-state tests, `make check`, `make test-postgres`.
7. User Tuning Preset Backend
   - Add editable user preset repositories, service validation, serializers, and CRUD routes backed by the existing `voice_tuning_presets` table.
   - Runtime behavior: provider presets stay read-only `/api/providers` metadata; user presets require `DATABASE_URL` and return `503` when persistence is unavailable.
   - Validation: CRUD route tests, repository tests, provider validation tests, secret rejection tests, no-DB `503` tests, `make check`, `make test-postgres`.
8. Frontend User Tuning Presets And Provenance
   - Add the frontend preset client/hook, browser-local fallback for no-DB mode, compact Voice Tuning controls, and generated-audio user preset snapshots.
   - Runtime behavior: applying a user preset selects its settings separately from provider presets; manual tuning edits clear the selected user preset until Save As Preset or Update Preset is used.
   - Validation: client/hook/component tests, generated-audio provenance tests, browser smoke creating/applying a preset and confirming archive metadata, `make check`.
