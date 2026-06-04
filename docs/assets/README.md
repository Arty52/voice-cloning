# Documentation Assets

This folder contains committed media used by the public README and docs.

## Public-Safe Rules

Follow the canonical [Public Media Guidelines](../PUBLIC_MEDIA.md) before adding or refreshing assets in this folder.

## Current Assets

- `voice-studio-desktop.png`: desktop capture of the Voice Studio with mocked demo data, 1440 x 1000, about 420 KB.
- `voice-studio-mobile.png`: mobile capture of the same public-safe demo state, 390 x 1000, about 184 KB.

## Refresh Checklist

1. Serve the frontend with sanitized local API responses.
2. Capture desktop and mobile viewport sizes.
3. Inspect the images for secrets, real audio data, and account-specific details.
4. Optimize file size while keeping UI text readable.
5. Confirm `git status --short` shows only intentional docs assets.
