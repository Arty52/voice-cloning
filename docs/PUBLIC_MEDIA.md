# Public Media Guidelines

This repository is public-safe by default. Screenshots and other documentation media should help visitors understand the app without exposing private data or committing runtime artifacts.

## Good Screenshot Subjects

- The Voice Studio first screen with sanitized demo voice names.
- Provider key controls with masked or empty values only.
- Cost and quota panels using demo quota numbers, not a real account.
- Voice tuning controls and generated-audio metadata using sample/demo data.
- Mobile or narrow-layout captures when they explain responsive behavior.

## Do Not Commit

- API keys or visible key fragments.
- Real voice samples, personal voice names, or source filenames from a local library.
- Generated MP3 audio or provider runtime cache data.
- Provider dashboard screenshots tied to a real account.
- Debug screenshots, temporary captures, or browser artifacts outside the intended docs asset folder.

## Asset Location

Committed documentation media belongs under `docs/assets/`. Runtime voice samples stay under `assets/voices/` and generated/cache data stays under `storage/`; both are ignored for local data.

Use descriptive filenames such as:

- `voice-studio-desktop.png`
- `voice-studio-mobile.png`

## Refresh Process

1. Run the frontend with sanitized mock API responses or a local demo backend.
2. Capture the real React UI at desktop and mobile viewport sizes.
3. Visually inspect the result for secrets, real voice names, real account numbers, and runtime artifacts.
4. Optimize the image without making UI text unreadable.
5. Check `git status --short` and confirm only intentional docs assets are tracked.

Prefer actual app screenshots over generated artwork. Visitors should see the product surface they will get when they run the app locally.
