# Long Transcript UI Review

Observed on 2026-11-04 in Meetily v0.4.1 and the Voice Clone Lab transcription upgrade preview. Both imported the same local, synthetic 30-minute repetition of the public whisper.cpp JFK sample. This was a UI stress test, not an accuracy comparison. No personal recording was used. Screenshots and generated audio remain outside Git.

## Findings

| Area | Meetily v0.4.1 | Voice Clone Lab | Recommended Change |
| --- | --- | --- | --- |
| Reading layout | A bounded transcript pane with a fixed toolbar and a resizable transcript/summary split | Setup controls remain above results; synchronized reader and editable transcript are separate surfaces | Make completed results the main workspace; collapse setup; keep one reader/editor and a persistent audio player |
| Rendering | Virtualizes above 10 segments; pagination hook loads 100 segments at a time | Synchronized viewer is virtualized, but the editor mounts every passage | Virtualize the editor and load transcript windows without losing drafts, selection, or keyboard focus |
| Navigation | Timestamped paragraphs; historical reading does not force auto-scroll | Word/segment playback and seeking already work; editor passages are less easy to locate in time | Keep existing seeking, show timestamps in the editor, and add search, jump-to-time, and return-to-playhead controls |
| Context | Meeting list and separate summary pane | Latest/active transcript restoration, speaker correction and voice extraction | Add explicit saved-transcript navigation and reading-position restoration; make speaker tools contextual |
| Wording | Display helper removes some filler words | Faithful wording and explicit user corrections are required | Preserve words and legitimate repetitions; do not copy automatic display filtering |

At a 1280 × 720 browser viewport, our 30-minute result had 165 editable passages mounted, about 9,128 pixels of page height, and a roughly 6,930-pixel editor. Only eight rows were mounted in the separate synchronized viewer. This identifies the editor and layout as the immediate UI bottleneck; it is not a browser performance benchmark. Meetily's native window had different dimensions, so screenshot density is not a controlled comparison.

Meetily's inspected reader exposes timestamp tooltips, not an integrated word-level seek handler. Search and jump-to-time were not found in the tested transcript controls. Those recommendations extend beyond both current interfaces. Voice Clone Lab should retain its synchronized playback, corrections, speaker reassignment, exports, and optional speaker-derived voice saving.

During inspection, unassigned transcript passages incorrectly inherited the first speaker color and were all styled as hovered because both speaker IDs were null. The transcription UI PR fixes both states and includes a regression test.

## Proposed Follow-Up PRs

This is a proposed UI follow-up, not part of the inference rollout or an implemented redesign. Each PR runs `make check` before publication and retains atomic follow-up commits.

### PR A — Transcript Data Access

Atomic commits:
1. Add revision-aware transcript window retrieval and lightweight result metadata while preserving the existing full-result contract for legacy consumers.
2. Add whole-transcript search and time-to-passage lookup in the service layer with thin routes.
3. Make correction responses invalidate affected windows using stable passage IDs and transcript revisions.

Validation: 30-minute/two-hour fixtures; no gaps or duplicates across pages; search finds unloaded passages; time lookup handles gaps and boundaries; stale revisions and edits invalidate correctly; legacy job restoration and exports remain unchanged. Measure payload size. Paging an existing JSON field reduces transfer but does not by itself bound database decoding memory; measure that separately before choosing a storage migration.

### PR B — Unified Transcript Reader And Editor

Atomic commits:
1. Introduce a viewport-bounded results layout with persistent playback/toolbar, collapsible setup, and contextual speaker tools.
2. Combine synchronized reading and inline correction in one virtualized passage list, including timestamps and neutral unassigned speakers.
3. Keep drafts, range selections, focus, and playback state stable when rows unmount or data windows change.

Validation: edit/save/cancel across offscreen rows; keyboard traversal and screen-reader labels; word seeking and follow-playback behavior; speaker reassignment and extraction guards; narrow/wide layouts; bounded mounted-row count on two-hour fixtures. Capture browser screenshots and check scrolling manually.

### PR C — Long Transcript Navigation And Restoration

Atomic commits:
1. Add whole-transcript search with match counts, next/previous, speaker filters, and explicit jump-to-time.
2. Add saved-transcript navigation and restore reading position by stable passage ID with a time fallback after edits.
3. Add end-to-end long-recording acceptance coverage and document measured load, scroll, edit, and restoration behavior.

Validation: navigate to unloaded matches; seek beyond one hour; filter without losing edits; reload after scrolling/editing; switch between saved transcripts without losing position; exports still contain the complete corrected text. Measure initial load, search response, mounted rows, and memory on the M2 Max with 30-minute and two-hour inputs.

## Source Evidence

- Meetily [transcript panel](https://github.com/Zackriya-Solutions/meetily/blob/v0.4.1/frontend/src/components/MeetingDetails/TranscriptPanel.tsx), [virtualized reader](https://github.com/Zackriya-Solutions/meetily/blob/v0.4.1/frontend/src/components/VirtualizedTranscriptView.tsx), [pagination hook](https://github.com/Zackriya-Solutions/meetily/blob/v0.4.1/frontend/src/hooks/usePaginatedTranscripts.ts), and [meeting layout](https://github.com/Zackriya-Solutions/meetily/blob/v0.4.1/frontend/src/app/meeting-details/page-content.tsx).
- Voice Clone Lab: `frontend/src/components/speaker-transcript-workspace.tsx`, `frontend/src/components/synchronized-transcript-viewer.tsx`, `frontend/src/hooks/use-transcript-workflow.ts`, and `backend/src/voice_cloning/api/serializers.py`.
