# Voice Clone Lab

## Project Rules
- This project is public-repo safe by default. Do not commit API keys, real voice samples, generated audio, or ElevenLabs runtime cache data.
- Keep `ELEVENLABS_API_KEY` server-side. Frontend code must call the local API and must not read or expose the key.
- Keep the local ports at `4340` for the Vite frontend and `6420` for the FastAPI backend unless the user asks to change them.
- Treat `storage/` as runtime data. Do not commit generated audio or `voice-cache.json` if this later becomes a repository.
- Treat `assets/voices/` as local user-provided voice assets. Only documentation/placeholders in that directory should be tracked.
- For non-trivial future changes after initial publication, use branch + draft PR workflow with atomic commits.
- Follow `docs/ARCHITECTURE.md` for implementation structure: thin FastAPI routes, service/client/serializer boundaries, smart frontend containers/hooks, and dumb UI components.
- Use Title Case for UI headings, labels, actions, badges, and source-link labels. Keep explanatory prose, placeholders, errors, runtime data, and API/model identifiers in sentence case.

## Validation
- Run `make check` for local verification after code changes.
- `make smoke-live` is optional and calls ElevenLabs with the real API key; it may consume credits and create or reuse a cloned voice.
