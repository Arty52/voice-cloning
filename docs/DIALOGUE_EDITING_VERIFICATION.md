# Dialogue Editing Verification

Dialogue rows are the working script. Script Source retains the original import. The last successful job is the recording baseline; edits become current only after a successful revision and archive save.

## Automated Checks

Run `make check` at each PR boundary. The focused suites are:

- `backend/tests/test_speech_revisions.py`: one replacement among 16 segments, unchanged audio hashes, single assembly, multiple replacements, handoff-only assembly, request validation, cancellation, assembly failure, staged-file rollback, and persisted restoration.
- `frontend/src/lib/dialogue-revisions.test.ts`: effective inputs, inherited tuning, edit/revert, incompatible baselines, recording snapshots, and row status.
- `frontend/src/hooks/use-multi-voice-speech-generation.test.tsx`: selective requests, failed revisions, overlapping actions, restored jobs, stable archive IDs, and submitted snapshots.
- `frontend/src/hooks/use-dialogue-draft-storage.test.tsx` and `use-dialogue-workspace.test.tsx`: validation, storage failures, visibility flushing, competing tabs, hydration, and missing voices.
- `frontend/src/components/dialogue/*.test.tsx`, `speech-input-panel.test.tsx`, and the dialogue scenarios in `App.test.tsx`: source collapse, reimport cancellation, accessible controls, tuning actions, and generation states.

These checks use mocked providers and do not consume provider credits.

## Browser Acceptance

Use a disposable browser profile and mock local API responses, or deliberately use the optional live provider workflow. Keep local ports at 4340 and 6420.

1. Import a 16-row script and map its speakers. Verify that Script Source collapses, the original source remains available on reopening, and Input Mode, Source Voice, and Natural Handoffs remain accessible.
2. Generate All. Verify that the action becomes disabled Generate Changes and each row exposes playback and regeneration.
3. Edit two rows and regenerate only one. Inspect the revision request: it contains one replacement. Check that the other edit remains pending and the saved script snapshot contains only text actually synthesized. The original recording remains in Generated Audio.
4. Edit another row and Generate Changes. Inspect the affected count and replacement IDs. Confirm that the viewport stays at the edited rows.
5. Change handoff spacing without editing rows. Confirm that the revision assembles existing segments without synthesis calls.
6. Edit a row without generating; close and reopen the browser. Confirm that source, row text, tuning, mappings, and playback recover. No speech POST should occur during restoration and no duplicate archive item should appear.
7. Restore a running revision. Verify progress and Cancel, then cancel it and confirm that draft edits and previous audio remain available.
8. Open another tab. Change the draft in one tab and confirm the other pauses autosaving until Keep This Draft or Use Saved Draft is selected.
9. Reopen Script Source and cancel Reimport Dialogue; edits must remain. Confirm reimport once and verify replacement of row edits/overrides while matching speaker mappings remain.
10. At desktop and 390px mobile widths, check long text, wrapped controls, the final row, and the final result panel. Neither the generation bar nor another control should obscure focused or final-row controls. Navigate away from Generate Speech: the bar must disappear.
11. Use keyboard navigation for source collapse, row tuning, playback, and regeneration. With reduced motion enabled, source height/fade animation must be disabled. Playback must remain user initiated.

The implementation was exercised in Chrome at 1440×1050 and 390×844 with synthetic voices/audio and intercepted API requests. The full take submitted 16 segments, followed by revisions of 1 and 2 segments. The browser recovered unsynthesized edits and three archive entries after reopening; backend tests independently verify unchanged segment bytes and provider-call counts.
