# Contributing

This project is a local-first, public-safe voice cloning lab with built-in ElevenLabs support. Keep changes small, reviewable, and safe to publish.

## Architecture Standards

Follow the project architecture standard in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for new implementation work. Provider additions should also follow [docs/ADDING_PROVIDER.md](docs/ADDING_PROVIDER.md).

Architecture checklist for non-trivial changes:

- Keep FastAPI routes thin; move orchestration into services and public response shaping into serializers.
- Keep React components presentational unless they are explicit containers; move data loading, mutations, browser APIs, and derived workflow state into hooks.
- Centralize frontend `/api/*` calls in shared helpers as new workflows are added; avoid adding direct `fetch` calls inside UI components.
- Keep provider keys out of git and API responses. `.env` keys stay on the backend; browser-entered developer keys may live in localStorage, browser code should send them only to the local API through explicit request helpers, and the backend may use them per request to authenticate provider calls.
- Keep provider-specific HTTP payloads, error parsing, key resolution, and tuning semantics inside provider adapters.
- Expose provider-specific tuning controls, presets, defaults, and links through provider metadata instead of hardcoding them in frontend constants.
- Split files by responsibility before they become monolithic workflow files.
- Preserve public API routes, payloads, headers, ports, and public-repo safety rules unless the change explicitly updates those contracts.

## UI Copy Style

Use Title Case for short interface text that names a control, area, or state:

- page and panel headings
- form labels
- buttons and menu actions
- badges and compact status labels
- source/documentation link labels
- accessibility labels that name controls or icons

Use sentence case for longer copy that reads as prose:

- helper text and descriptions
- tooltips
- placeholders
- empty-state messages
- errors and confirmation body text
- runtime values, API identifiers, model IDs, file names, and user-provided names

Examples:

- `Cost & Quota`, not `Cost & quota`
- `Generated Audio`, not `Generated audio`
- `Set as Default`, not `Set As Default`
- `Create Speech`, not `Create speech`
- `No generated speech yet.`, not `No Generated Speech Yet.`

When changing visible copy, update tests that query by accessible name so the casing convention stays enforced.
