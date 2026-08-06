# Voice UI Design-System Extension Policy

## Status And Authority

This is the living extension policy and component discovery inventory for Voice Studio. It applies whenever a change adds or materially reshapes a voice-specific interface, shared media control, transcript interaction, microphone workflow, waveform, or voice status pattern.

Voice Studio is the system of record. Its Geist design principles, shadcn/Radix primitives, semantic tokens, accessibility expectations, component ownership, frontend architecture, and copy conventions take precedence over every external source. External libraries and products are capability references, not alternate design systems.

The frontend maintainers own this policy. The author of a component-adoption PR owns its discovery evidence, source snapshot, licensing record, compatibility analysis, tests, and follow-up maintenance. A maintainer must approve movement between escalation levels or any exception.

Last reviewed: 2026-08-06.

## Non-Negotiable System Constraints

- Retain Geist Variable for interface typography and Geist Mono Variable for timecodes, measurements, and other appropriate technical data.
- Use Voice Studio semantic tokens from `frontend/src/index.css`. Components consume meanings such as `background`, `card`, `foreground`, `muted`, `primary`, `border`, `ring`, and `destructive`; they do not bring vendor palettes or literal brand colors into product UI.
- Compose the local primitives under `frontend/src/components/ui/` and the project's installed Radix primitives. A registry component may be adapted into these boundaries, but must not create a parallel primitive layer.
- Preserve the smart-container and feature-hook boundaries in [Architecture Standards](ARCHITECTURE.md). Presentational components render local view models and emit callbacks; they do not fetch, own provider clients, persist provider state, or read browser storage directly.
- Use Lucide icons through the existing project conventions. Do not introduce a second icon language for an adopted component.
- Follow the project's Title Case rules for short labels and actions. Upstream component copy is placeholder material, not approved Voice Studio copy.
- Never import a second visual system, wholesale theme, vendor stylesheet, font family, branded illustration, logo, sound mark, product name, distinctive marketing copy, or copied branded motion.
- Never make the UI contract depend directly on ElevenLabs or another provider. Provider identity and capability data cross the existing normalized provider boundary.

A proposal that cannot satisfy these constraints is not eligible for adaptation. It needs a different design, not a styling exception.

## Required Escalation Path

Use the first level that can meet the user need. A PR that starts at Level 2, 3, or 4 must record why every earlier level is insufficient.

### Level 1: Compose Voice Studio

Compose or extend existing local primitives, shared components, hooks, and established product patterns. Prefer a small generalization of a local component when the same capability already exists in one feature.

Level 1 is complete when the capability can be expressed without duplicating feature state, breaking component ownership, or making an existing primitive unreasonably broad.

### Level 2: Adapt Vercel AI Elements

Evaluate a structurally compatible Vercel AI Elements component or pattern. Adapt only the capability-bearing structure and behavior. Replace its primitive imports, tokens, typography, state ownership, copy, and data types with Voice Studio equivalents.

AI Elements is built on shadcn/ui and its public voice catalog includes [Audio Player](https://elements.ai-sdk.dev/components/audio-player), [Mic Selector](https://elements.ai-sdk.dev/components/mic-selector), [Speech Input](https://elements.ai-sdk.dev/components/speech-input), [Transcription](https://elements.ai-sdk.dev/components/transcription), and [Voice Selector](https://elements.ai-sdk.dev/components/voice-selector). That compatibility makes it the preferred external discovery source, but it is not blanket approval: its repository-level setup assumes Next.js and additional dependencies, while Voice Studio is a Vite client application. Compatibility must be demonstrated component by component.

### Level 3: Adapt ElevenLabs UI Or A Public Product Pattern

If Levels 1 and 2 cannot meet the need, selectively adapt an ElevenLabs UI component or a provider's publicly documented product interaction. ElevenLabs UI is an open-source, shadcn-based registry with [audio and voice components](https://ui.elevenlabs.io/docs/components), including audio player, scrub bar, voice picker, waveform, live waveform, microphone selector, speech input, and transcript viewer patterns.

Provider-specific payloads, terminology, styling, assets, and branding must be removed. A product screenshot or guide may inform a generic interaction model, but is not source code and does not grant permission to reproduce trade dress. For example, the public ElevenLabs [Transcript Viewer](https://ui.elevenlabs.io/docs/components/transcript-viewer) is a synchronized, read-only playback component. The richer [Transcript Editor](https://elevenlabs.io/docs/eleven-creative/products/transcripts) is a public product pattern with editable text, speaker tracks, timing handles, split/merge operations, and reassignment; it is not a ready registry component.

### Level 4: Build A Voice Studio Component

Build a custom component only when the prior levels fail a documented functional, architectural, accessibility, licensing, performance, or browser requirement. Start from local primitives and contracts. A custom component is owned by Voice Studio from its first commit and must include focused tests, usage guidance, and a named state owner.

Level 4 requires maintainer approval of a short decision record before implementation. "More control" or closer visual resemblance to an external product is not sufficient justification.

## Evaluation Gate

Before adapting a component, add a discovery note to the implementation plan or Draft PR. Evaluate all of the following:

| Criterion | Required Evidence |
| --- | --- |
| User capability | The concrete job, required states, and why the current local composition is insufficient. |
| Structural fit | React/Vite compatibility, primitive dependencies, CSS approach, controlled-state support, bundle impact, and whether the component can live inside current frontend boundaries. |
| Local ownership | The feature hook or container that will own data, browser APIs, side effects, playback, and mutations; plus the presentational component API. |
| Visual-system fit | A map from every upstream color, type, radius, shadow, icon, animation, and spacing decision to a local token or established pattern. |
| Provider neutrality | The local view model and normalized provider/API boundary; no provider SDK or provider-specific response shape in reusable UI. |
| Accessibility | Keyboard model, focus entry/exit, accessible names and descriptions, live announcements, non-color cues, and reduced-motion behavior. |
| Runtime fit | Supported browsers, secure-context needs, media formats, permissions, device changes, cleanup, degraded behavior, and SSR/Next assumptions to remove. |
| Performance | Expected audio duration, transcript/segment count, waveform sample density, rendering cost, memory lifetime, and any virtualization or downsampling strategy. |
| Provenance | Exact upstream URL, repository, tag or commit, file paths, license, copyright/notice obligations, local modifications, and review date. |
| Maintainability | Test strategy, dependency ownership, upgrade method, upstream-drift plan, and the maintainer responsible for exceptions. |

Security, licensing, accessibility, and the non-negotiable system constraints are hard gates. A component does not pass by averaging strengths against one of those failures.

## Tokens, Typography, And Visual Integration

An adapted component must look and behave as though it originated in Voice Studio:

- Consume semantic Tailwind classes backed by `frontend/src/index.css`; add a new semantic token only when the meaning is reusable and no current token is accurate.
- Keep component state semantic. For example, playback progress may use `primary`, a validation failure uses `destructive`, a modified-but-unsaved state uses `modified`, and supporting text uses `muted-foreground`.
- Keep focus rings tied to `ring` or `sidebar-ring`. Never suppress the visible focus indicator without an equally visible local replacement.
- Use Geist Mono and tabular numerals for time values where alignment improves scanning. Do not use a vendor font or copy an upstream typographic scale.
- Use local card, popover, dialog, field, input, select, toggle, tooltip, loading, badge, alert, and status primitives before introducing any equivalent.
- Translate hard-coded upstream dimensions into the local spacing, radius, border, and responsive conventions. Mobile and narrow layouts are part of the same component contract.
- Treat upstream previews as behavioral demonstrations. Colors, names, avatars, flags, gradients, demo audio, icons, animations, and layout styling are not design inputs unless separately approved and licensed.

## State And Component Ownership

### Shared Playback Ownership

Audio playback, waveform position, scrub position, and synchronized transcript position are one state domain when they describe the same media source. They must not be implemented as independent clocks or competing hidden `<audio>` elements.

- A feature hook or explicit playback controller owns the media element/ref, active source and item, play/pause state, current time, duration, seeking, load/error state, cleanup, and any segment-bounded playback.
- `frontend/src/components/audio-player.tsx` is the current shared presentational playback baseline. Generalize its contract before adding a second feature-local player.
- Waveforms, scrub bars, transcript highlighting, preview buttons, and timeline cursors receive controlled playback state and callbacks from the same owner.
- Voice-preview actions participate in the feature's playback policy, including whether starting one preview pauses the current preview. Multiple mounted players must not create surprising simultaneous audio.
- Components may expose a local headless primitive, but no external media controller becomes the product state store by default. Any such dependency must be wrapped behind a Voice Studio-owned contract.
- Time and playback errors must remain available as text or accessible state even if a visual waveform is not rendered.

### Normalized Provider Boundary

- Reusable voice components receive local types: stable local ids, display names, optional descriptions, preview availability, selection state, and provider-neutral metadata.
- Provider-specific labels, limits, presets, settings, and source links continue to come through `/api/providers` and existing API helpers. Components do not import provider SDKs or interpret raw provider responses.
- Provider keys remain behind the current local API request boundary. A UI adaptation must not send browser keys to an external component service, analytics endpoint, or upstream API.
- Transcript and timing data must be normalized into Voice Studio segment, word, speaker, and time contracts before reaching a shared component. The UI must not bind itself to AI SDK or ElevenLabs response types.
- Third-party dependencies may implement rendering or low-level media behavior; they do not own Voice Studio domain state, persistence, mutations, or provider selection.

## Accessibility Contract

Accessibility is part of component acceptance, not a later polish pass.

### Focus And Keyboard

- Use native controls or local Radix/shadcn primitives with correct semantics. Preserve logical tab order and visible `focus-visible` treatment.
- Dialogs, popovers, menus, and selectors must announce their name and purpose, place focus predictably, support Escape where appropriate, and return focus to the trigger when closed.
- Play, pause, record, stop, preview, retry, seek, and selection controls require stable accessible names that reflect state. Icon-only controls require an explicit name.
- Sliders and timeline controls must expose their value, bounds, and useful text. Support arrow keys and standard slider keys; document additional shortcuts instead of hiding pointer-only behavior.
- Synchronized transcript segments that seek playback must be real buttons or links when interactive. Read-only words must not be placed in the tab order.
- Editable diarized workspaces must support editing, selection, reassignment, save/cancel, and timeline adjustments without drag-and-drop. Focus must remain on, or move predictably from, the item being changed.
- Disabled actions with an important explanation must remain discoverable through an adjacent description or the project's established focusable-disabled pattern.

### Screen Readers And Non-Visual State

- Name regions and groups so users can distinguish the player, voice results, transcript, speakers, timeline, and processing status.
- Announce asynchronous completion and actionable errors with appropriately scoped live regions. Do not announce every playback tick, waveform sample, or provisional transcript update.
- Convey loading, listening, recording, playing, selected, modified, error, and completion states in text or programmatic state, not color, animation, or waveform movement alone.
- Provide formatted current time and duration. A waveform or canvas visualization must have an equivalent control and concise accessible description.
- Speaker identity must use text in addition to color. Decorative visualization elements must be hidden from assistive technology.

### Motion And Sensory Safety

- Honor `prefers-reduced-motion`. Remove pulsing, shimmering, automatic scrolling, animated waveform interpolation, and nonessential transitions when reduced motion is requested.
- Never make motion the only indication of recording, listening, playback, loading, or failure.
- Autoscroll of synchronized transcripts must not steal focus and must offer a stable reading experience for keyboard and screen-reader users.

## Browser And Runtime Compatibility

Voice Studio is a React 19, TypeScript, Vite, Tailwind CSS variables, client-rendered application. Adapted code must not require Next.js, React Server Components, server actions, Next-only imports, or an upstream runtime service.

- Support current Chrome, Edge, Firefox, and Safari behavior proportionate to the feature, and test narrow/mobile layouts. State any narrower support explicitly before implementation.
- Microphone and device selection must use feature detection, explain secure-context and permission requirements, handle denied or revoked permission, tolerate empty or anonymized device labels, respond to device changes, and clean up media tracks.
- Speech input must not assume Web Speech API availability. Any recording fallback must use the local API and provider boundary, define the recorded format, expose processing/error states, and work with Voice Studio's existing recording constraints.
- Audio playback must handle metadata loading, zero or unknown duration, autoplay rejection, decode/load failure, source replacement, and object URL revocation.
- Waveform generation must not block the main thread for large media. Downsample or virtualize as needed and preserve a functional player when visualization APIs or decoding are unavailable.
- Transcript rendering must remain usable for long diarized results. Measure list size, avoid a focus-destroying virtualization strategy, and separate current-time updates from full editor rerenders.
- Browser APIs, event listeners, animation frames, audio contexts, object URLs, observers, and streams must be released on source change and unmount.
- New dependencies require an explicit bundle, maintenance, security, and license review. A registry install command is discovery tooling, not permission to import every dependency it proposes.

## Source Snapshots, Licensing, And Attribution

External source is reviewed as a snapshot, never as an unbounded `latest` dependency.

For every adaptation, record in the PR:

1. upstream project and public documentation URL;
2. exact tag or full commit SHA and the accessed date;
3. exact source and demo files consulted or copied;
4. upstream license at that snapshot and all transitive licenses introduced;
5. which portions were copied, translated, or rewritten;
6. local token, accessibility, state, and API changes;
7. the intended method for reviewing future upstream changes.

Pin installed dependencies in the existing lockfile. For source-copied registry components, preserve required copyright and license notices and add or update a repository third-party notice when the license or amount copied requires it. Do not rely on a registry page's general license label; verify the exact repository and snapshot. If provenance or reuse permission is unclear, do not copy the source.

The research baseline for this inventory is:

- Vercel AI Elements commit [`0c1f5e8c75273f0e95c8faa031544a8aa2bb1a5b`](https://github.com/vercel/ai-elements/commit/0c1f5e8c75273f0e95c8faa031544a8aa2bb1a5b), reviewed 2026-08-06. The repository describes AI Elements as shadcn-based and publishes the five voice components above. Its snapshot [license](https://github.com/vercel/ai-elements/blob/0c1f5e8c75273f0e95c8faa031544a8aa2bb1a5b/LICENSE) is Apache-2.0.
- ElevenLabs UI commit [`6e5b681c01ee28073c89a047ebe5ecebf6a7def2`](https://github.com/elevenlabs/ui/commit/6e5b681c01ee28073c89a047ebe5ecebf6a7def2), reviewed 2026-08-06. The official [launch description](https://elevenlabs.io/blog/elevenlabs-ui) and registry document shadcn-based audio and agent components. Its snapshot [license](https://github.com/elevenlabs/ui/blob/6e5b681c01ee28073c89a047ebe5ecebf6a7def2/LICENSE.md) is MIT.
- ElevenLabs' public [Transcripts product guide](https://elevenlabs.io/docs/eleven-creative/products/transcripts), reviewed 2026-08-06, is the product-pattern reference for editable text, timing, segment, speaker, playback, and timeline interactions. It is not a source-code component inventory.

These snapshots establish discovery facts only. An implementation PR must re-check upstream state, license, and compatibility at the snapshot it actually uses.

## Living Component Discovery Inventory

Status meanings:

- **Local Baseline**: Voice Studio already owns the core capability; extend it through Level 1.
- **Evaluate**: a capability gap exists, but no adoption decision has been made.
- **Pattern Only**: useful public behavior to study, not a ready component.
- **Deferred**: intentionally outside current product scope.

| Priority | Capability | Voice Studio Baseline And Owner | External Discovery | Required Direction | Status |
| --- | --- | --- | --- | --- | --- |
| P0 | Shared audio playback, preview, and scrub | `AudioPlayer` provides local playback, seek, time, and error UI. Feature code also owns source and segment-preview media in places. | AI Elements Audio Player; ElevenLabs UI Audio Player and Scrub Bar. | First define one Voice Studio controlled playback contract and pause/preview policy. Adapt control structure only if it reduces duplication without surrendering state ownership. | Local Baseline |
| P0 | Loading, error, empty, and status states | Local `Loading`, `PendingWorkStatus`, `Alert`, badges, cards, and feature status derivation. | External demos show useful media-specific states but no system gap. | Compose and extend local primitives. Keep textual, announced states and reduced-motion behavior. Do not import vendor status styling. | Local Baseline |
| P1 | Voice picker | Voice selection is distributed through the voice library and generation workflows, backed by local voice and provider metadata. | AI Elements Voice Selector has searchable grouping, metadata, preview, and keyboard navigation; ElevenLabs UI has Voice Picker. | Specify the local voice option view model and shared preview owner. Evaluate Level 1 composition first, then AI Elements structure. Provider branding and fixed metadata taxonomies are out. | Evaluate |
| P1 | Read-only synchronized transcript viewer | `SpeakerTranscriptWorkspace` owns editable transcript display and segment preview, but there is no shared read-only current-time viewer. | AI Elements Transcription provides segment highlighting and click-to-seek. ElevenLabs UI Transcript Viewer provides word highlighting, playback, and scrub. | Build on the shared playback contract. Prefer the simpler Level 2 controlled segment pattern; use the Level 3 word-alignment pattern only if word-level synchronization is a product requirement. | Evaluate |
| P1 | Editable diarized transcript workspace and timeline | `useTranscriptWorkflow`, `useSpeakerTranscript`, and `SpeakerTranscriptWorkspace` already own job restoration, speaker naming, reassignment, corrections, exports, selected-speaker saves, and segment playback. | ElevenLabs Transcript Editor is a public product pattern for WYSIWYG editing, timing handles, split/merge, speaker tracks, and reordering. The registry Transcript Viewer is read-only. | Evolve the existing local workspace incrementally. Treat timeline behavior as Pattern Only, define keyboard equivalents before drag interactions, and use Level 4 only for gaps that local composition cannot meet. | Local Baseline / Pattern Only |
| P2 | Waveform and live waveform | No shared Voice Studio visualization primitive. Existing audio controls remain the functional fallback. | ElevenLabs UI Waveform and Live Waveform; audio-product patterns in both source catalogs. | Evaluate a headless/downsampled visualization behind the shared playback or recording controller. It must use local tokens, remain decorative to assistive tech, respect reduced motion, and degrade to accessible controls. | Evaluate |
| P2 | Microphone selector and speech input | `voice-recorder.ts` and Add Voice own local recording, permission, WAV encoding, size/duration limits, and upload flow; no shared input-device selector exists. | AI Elements Mic Selector and Speech Input; ElevenLabs UI Mic Selector and Speech Input. | Evaluate Level 2 device-list structure and permission states. Preserve local recording/encoding and API ownership; do not adopt an external transcription service or Web Speech assumption implicitly. | Evaluate |
| Deferred | Persona, Orb, and branded motion | No product requirement or local semantic role. | AI Elements Persona; ElevenLabs UI Orb and brand-forward agent demos. | Do not adopt or imitate. Reopen only with a user need, a semantic role, reduced-motion design, and explicit maintainer approval under this policy. | Deferred |

### Inventory Update Rules

- Update the review date and source snapshot when research is refreshed.
- Change a status only in a PR that includes evaluation evidence and names the owning local contract.
- Add newly discovered components only when they map to a concrete Voice Studio capability. This is not a catalog of everything upstream offers.
- When an adaptation ships, replace the discovery candidate with the local component path, decision rationale, test coverage, source snapshot, and maintenance owner.
- Remove or mark stale candidates when upstream source, license, browser behavior, or product direction changes.

## Planned Shared Contract Boundaries

These are planning and ownership constraints, not APIs introduced by this documentation PR. A later implementation may choose different type or hook names, but it must preserve the responsibility split.

| Contract | Owned Data And Actions | Consumers | Boundary Rules |
| --- | --- | --- | --- |
| Shared playback | Stable source/item id, playable local URL, media ref or adapter, load state, play/pause state, current time, duration, seek, bounded segment play, active preview, error, and cleanup. | Audio controls, voice previews, synchronized transcripts, waveforms, and future timeline cursors. | One owner per playback context; all time-based consumers are controlled from it. The contract contains no provider client, archive persistence, component-library type, or vendor media service. |
| Normalized transcript | Document id, speakers, ordered segments, start/end times, text, optional word alignment, selected/current segment, and provider-neutral editing commands where the surface is editable. | Read-only synchronized viewer, editable diarized workspace, export flow, and timeline presentation. | Read-only views receive playback time and emit seek intent. `useTranscriptWorkflow` and `useSpeakerTranscript` remain the workflow/mutation owners for the current editor. Upstream AI SDK or ElevenLabs transcript types are normalized at an adapter boundary and do not become reusable UI props. |
| Voice selection | Stable local voice id, display name, optional description and neutral metadata, selected state, preview availability/state, search/group data, and select/preview intent. | Voice picker, generation workflows, library actions, and contextual voice assignment. | The feature hook or container owns loading, provider metadata normalization, selection, and preview coordination. The picker is presentational and does not fetch voices, interpret provider ids, persist defaults, or create its own player. Preview uses the shared playback contract. |

The contracts meet at explicit events rather than shared vendor state: a voice option requests preview through shared playback; a transcript segment requests a seek through shared playback; playback publishes controlled time to transcript and waveform views; transcript edits flow through the local transcript controller and API helpers. This prevents an adapted component from becoming an accidental state store.

## Phased Adoption And Test Plan

This inventory does not authorize implementation. Each phase begins only when a concrete product need is approved, and each non-trivial phase uses its own reviewable Draft PR or PR stack under the repository planning standards.

### Phase 0: Contract Discovery

- Inventory every current audio element, preview path, transcript shape, voice-selection surface, status component, and browser API owner.
- Write the local playback, transcript, and voice-selection view models and event semantics in the implementation plan.
- Decide the pause/competition policy for multiple previews and the synchronization precision required for segments, words, waveforms, and timelines.
- Prototype external candidates only in disposable local research; do not commit registry bulk output.
- Exit when maintainers approve the contract boundaries, escalation evidence, source snapshots, licensing, and PR split.

Validation: type/API design review, dependency and license review, token mapping, accessibility interaction design, and a browser-risk matrix.

### Phase 1: Shared Playback Foundation

- Generalize the existing local `AudioPlayer` path behind a controlled Voice Studio-owned playback contract.
- Consolidate same-source transcript preview and shared scrub behavior before adding a new visualization.
- Keep feature persistence and provider state outside the playback layer.
- Exit when current playback behavior is preserved and synchronized consumers can use one clock without competing media owners.

Validation: focused controller and component tests; play/pause/seek, bounded segment playback, source replacement, simultaneous-preview policy, autoplay rejection, metadata/load failure, cleanup, keyboard slider behavior, and accessible time/error output; manual Chrome, Edge, Firefox, and Safari playback checks.

### Phase 2A: Voice Picker

- Compose a local picker from current primitives first; evaluate AI Elements Voice Selector structure only for unmet search, grouping, and keyboard behavior.
- Connect preview through the Phase 1 playback contract and selection through the normalized voice-selection contract.
- Keep provider metadata normalization and persisted selection in the owning feature hook.
- Exit when the picker can replace a named existing selection surface without changing its provider or persistence contract.

Validation: search/group/empty/loading/error states, controlled selection, one-preview-at-a-time behavior, focus trap and return, arrow-key navigation, accessible option metadata, mobile dialog layout, long names, and missing preview handling.

### Phase 2B: Read-Only Synchronized Transcript

- Start with segment synchronization through the local transcript contract; add word alignment only for a demonstrated requirement.
- Connect highlight and click-to-seek behavior to the Phase 1 playback contract.
- Keep editing and persistence out of the read-only viewer.
- Exit when a long transcript remains readable, seekable, and synchronized without rerendering or announcing every time update.

Validation: segment boundary timing, click and keyboard seek, current/past/future semantics, no-JavaScript-animation or reduced-motion behavior, screen-reader reading order, long transcript performance, focus stability, empty/missing alignment, and playback error behavior.

Phases 2A and 2B are separate feature PRs. They may be scheduled independently after Phase 1, and neither is a prerequisite for the other.

### Phase 3: Editable Diarized Workspace And Timeline

- Extend the existing `useSpeakerTranscript` and `SpeakerTranscriptWorkspace` ownership model rather than replacing it with the read-only viewer.
- Add timeline or timing operations one capability at a time: navigation, time adjustment, split/merge, speaker reassignment, then track organization.
- Define keyboard and non-drag equivalents before adding pointer drag interactions. Preserve save status, error recovery, and export behavior.
- Treat the ElevenLabs Transcript Editor only as a product-pattern reference; custom Level 4 work requires a decision record for each unmet capability.
- Exit when every mutation has a local domain/API owner, undo or recovery behavior where needed, and isolated automated coverage.

Validation: edit/save conflicts, unsaved state, split/merge invariants, time bounds and overlaps, speaker reassignment, keyboard-only operation, focus after mutations, undo/retry behavior, large diarized transcripts, screen-reader labels, and cross-browser pointer/keyboard checks.

### Phase 4: Optional Visual And Capture Extensions

- Evaluate waveform/live-waveform rendering only after shared playback or recording ownership is stable.
- Evaluate microphone selection and speech input without replacing the existing local WAV encoding, permission, duration/size, and upload boundaries.
- Ship waveform, live waveform, microphone selection, and speech input as separate reviewable capabilities unless a smaller coupling is explicitly justified.
- Keep Persona, Orb, and branded motion deferred.

Validation: downsampling and long-audio performance, canvas/SVG fallback, reduced motion, device add/remove, denied/revoked permission, anonymized labels, stream cleanup, unsupported APIs, recording format, local transcription fallback, and current browser/mobile behavior.

At every phase, the Draft PR reports its automated and manual evidence before the user or maintainer is asked to move it to Ready. No phase moves Ready with an unresolved exception or by assuming that a later phase will supply missing accessibility, fallback, or ownership work.

## Implementation And Review Gates

Every adoption starts as a Draft PR. For a non-trivial capability, plan separate reviewable PRs by architectural layer or responsibility; a discovery/control contract, shared UI primitive, and feature integration should not become one unreviewable change.

Before a component PR moves from Draft to Ready, reviewers must be able to verify:

- the escalation record and maintainer-approved level;
- a controlled local API with explicit state ownership and normalized provider data;
- semantic-token, Geist typography, icon, copy-casing, responsive, and no-branding review;
- keyboard-only and screen-reader behavior, focus restoration, non-color cues, and reduced-motion behavior;
- automated tests for state transitions, errors, cleanup, accessible names, keyboard interactions, and local contract normalization;
- integration tests for shared playback synchronization and competition between previews where applicable;
- manual playback, seek, permission, device-change, long transcript, long audio, narrow-layout, and failure-path checks as applicable;
- browser coverage in current Chrome, Edge, Firefox, and Safari, with documented fallbacks for unsupported APIs or formats;
- source snapshot, dependency and license review, preserved notices, and attribution changes;
- `make check`, relevant focused tests, documentation/link/format checks, and `git diff --check` results in the PR description.

Visual similarity to an upstream demo is not an acceptance criterion. Voice Studio consistency, user capability, accessibility, and maintainable ownership are.

## Exceptions And Escalation Ownership

The PR author requests an exception in the Draft PR with:

- the unmet requirement and failed earlier levels;
- the smallest proposed deviation;
- accessibility, browser, dependency, licensing, and maintenance impact;
- the approving frontend maintainer;
- an expiry condition or review date; and
- a removal or migration plan.

A frontend maintainer owns the decision. Security- or license-sensitive exceptions also require the appropriate repository maintainer to approve the relevant evidence. Exceptions cannot authorize provider secrets in frontend code, an unlicensed copy, a second visual system, or copied branding. Those proposals must be redesigned or must explicitly replace this policy in a separately reviewed architectural decision.

Do not move an implementation PR from Draft to Ready while an exception, source-license question, accessibility gap, or browser fallback remains unresolved.
