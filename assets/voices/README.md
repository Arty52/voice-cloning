# Local Voice Assets

This directory is where the app stores uploaded voice samples and the local voice manifest.

Real voice samples are intentionally ignored by git. A public clone starts with no bundled voice assets; add a voice from the web UI after setting up a key for the active provider.

Expected local files after using the app:

- `voices.json`
- one or more audio files such as `voice-clone-01.wav` or `default/default-voice.mp3`
- optional original uploads under `sources/` when a saved voice keeps the long source file locally
