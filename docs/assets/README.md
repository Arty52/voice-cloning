# Documentation Assets

This folder contains committed media used by the public README and docs.

## Public-Safe Rules

- Use sanitized demo data only.
- Do not show API keys, key fragments, real account identifiers, real voice names, or real source filenames.
- Do not commit generated audio, voice samples, provider cache files, or temporary browser captures.
- Keep screenshots focused on the local app UI, not third-party provider dashboards.
- Prefer actual app screenshots over generated artwork so visitors see the interface they will run locally.

## Current Assets

- `voice-studio-desktop.png`: desktop capture of the Voice Studio with mocked demo data.
- `voice-studio-mobile.png`: mobile capture of the same public-safe demo state.

## Refresh Checklist

1. Serve the frontend with sanitized local API responses.
2. Capture desktop and mobile viewport sizes.
3. Inspect the images for secrets, real audio data, and account-specific details.
4. Optimize file size while keeping UI text readable.
5. Confirm `git status --short` shows only intentional docs assets.
