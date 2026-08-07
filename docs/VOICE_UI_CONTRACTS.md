# Voice UI Contract Ownership

This document records the interaction rules for the provider-neutral voice UI
contracts in `frontend/src/lib/voice-ui-contracts.ts` and their current-response
adapters in `frontend/src/lib/voice-ui-adapters.ts`. It is an ownership guide,
not a new playback implementation.

## Interaction Ownership

Each feature hook or smart container owns its own API requests, selected source,
object-URL lifecycle effects, and persistence. The app-level
`PlaybackControllerProvider` owns the single active browser media element and
exposes a controlled `PlaybackSnapshot` plus `PlaybackIntent` dispatch to local
presentational controls. Presentational controls may request `play`, `pause`,
`seek`, skipping, source replacement, clearing, or a bounded segment range;
they must not create a hidden audio element, fetch a provider payload, or
persist playback state.

The shared controller is the one clock for a feature's player, preview
controls, waveform, scrub bar, and transcript highlighting. A feature registers
an owner before replacing a source. Starting a different owner replaces the
single active source; an owner unmounting clears playback only when it still
owns that source. This prevents an unmounted workflow from stopping another
workflow's newer source.

## Transcript Corrections And Synchronization

The normalized transcript document is the canonical ordered presentation for
the current editor, future read-only viewer, export, and timeline surfaces.
Selections and current-time highlighting are presentation state and do not
create copied transcript data.

Saving a text correction is still owned by the existing transcript workflow and
API helper. After that workflow confirms the correction, it advances the local
document revision and clears the corrected segment's word alignment. Existing
word timings cannot be assumed to describe replacement text. A viewer falls
back to segment timing until a trusted local or provider-neutral alignment
adapter supplies replacement words.

## Browser Resource Cleanup

The playback controller pauses and detaches its media element when its source is
replaced, cleared, or unmounted. The feature source owner releases its own
browser resources when its source is replaced or it unmounts:

- pause the owned media element and remove event listeners;
- cancel animation frames, observers, and pending source-specific work;
- revoke only URLs created by `URL.createObjectURL`, identified by the `blob:`
  scheme; and
- never revoke a server, archive, or local API URL that the browser did not
  allocate.

The shared contracts deliberately classify a playback source by media use, not
by provider. URL cleanup remains an owner responsibility because the contract
cannot know whether a URL was browser-created without the feature that created
it.

## External Reference Provenance

The contracts and adapters are Voice Studio-authored. They do not copy code,
CSS, types, stores, media controllers, or assets from Vercel AI Elements or
ElevenLabs UI. Their generic product requirements were evaluated under the
[Voice UI Design-System Extension Policy](VOICE_UI_DESIGN_SYSTEM_POLICY.md):

- Vercel AI Elements commit
  [`0c1f5e8c75273f0e95c8faa031544a8aa2bb1a5b`](https://github.com/vercel/ai-elements/commit/0c1f5e8c75273f0e95c8faa031544a8aa2bb1a5b),
  reviewed 2026-08-06, Apache-2.0; and
- ElevenLabs UI commit
  [`6e5b681c01ee28073c89a047ebe5ecebf6a7def2`](https://github.com/elevenlabs/ui/commit/6e5b681c01ee28073c89a047ebe5ecebf6a7def2),
  reviewed 2026-08-06, MIT.

Those sources informed the need for controlled playback, semantic transcript
synchronization, and preview ownership. They are not runtime dependencies or
alternate visual systems. A later component adaptation must record its exact
source snapshot, license, copied or rewritten portions, and local deviations in
its own Draft PR before reuse.
