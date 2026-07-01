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
   - Validation: file/database consistency tests, orphan cleanup tests, archive API route tests, `make check`, `make test-postgres`.
4. Frontend Archive And Migration UI
   - Migrate generated-audio archive calls from IndexedDB source-of-truth to server APIs while retaining IndexedDB as cache/draft buffer.
   - Validation: hook/component tests, migration conflict tests, browser smoke, `make check`.
5. Preference And Settings Persistence
   - Move durable app/provider preferences behind backend settings APIs and add any needed settings placement in `#provider` or a dedicated `#settings` section.
   - Validation: settings API tests, frontend settings tests, `make check`, `make test-postgres`.
