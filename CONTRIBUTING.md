# Contributing

This project is a local-first, public-safe ElevenLabs voice cloning lab. Keep changes small, reviewable, and safe to publish.

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
