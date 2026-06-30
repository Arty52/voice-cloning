# Video Source Media Rollout Notes

These notes capture the draft PR stack for local video source media in Prepare Audio. Keep each PR in Draft until its validation section has current evidence posted in the PR thread.

## Draft PR Stack

1. Backend Source Media Contract And Extraction
   - Branch: `codex/video-source-backend`
   - Base: `main`
   - Ready gate: backend focused tests and `make check` pass.
2. Frontend Process Source Media UX
   - Branch: `codex/video-source-ui`
   - Base: `codex/video-source-backend`
   - Ready gate: PR 1 is merged or rebased cleanly, focused frontend tests pass, browser/video workflow validation is posted.
3. Docs And Rollout Notes
   - Branch: `codex/video-source-docs`
   - Base: `codex/video-source-ui`
   - Ready gate: PR 2 is merged or rebased cleanly, docs are current, final validation evidence is posted.

## Validation Evidence

- Backend focused tests passed:
  `./.venv/bin/pytest backend/tests/test_api.py -k "sample_processing_media_source or selected_media_source"`
- Backend stack `make check` passed after PR 1 commits.
- Frontend focused tests passed:
  `npm --prefix frontend test -- --run src/lib/api.test.ts src/hooks/use-sample-processing.test.tsx src/components/panels/sample-processing-panel.test.tsx src/components/media-file-drop-zone.test.tsx`
- Frontend app workflow tests passed for uploaded audio/video source media, range selection, job payloads, and cleanup.
- Frontend stack `make check` passed after PR 2 commits.
- Live local API smoke passed for MP4 with audio: staged upload classified as `mediaKind: "video"`, stored audio stream metadata, served `GET /api/sample-processing/sources/{sourceId}/media` as `video/mp4`, created a range job with `sourceMediaId` and `sourceRanges`, completed as mono 16 kHz WAV, then deleted the staged source.
- Live local API smoke passed for MOV with audio: staged upload classified as `mediaKind: "video"`, found one audio stream, served staged media as `video/quicktime`, then deleted the staged source.
- Unsupported local video extension smoke passed: `.webm` upload returned 422 with the source media validation message.
- Video-without-audio smoke passed: `.mp4` upload returned 422 with `Video source must include at least one audio stream.`

Before marking the UI PR Ready, run or post an interactive browser check against `http://localhost:4340`: upload a small MP4 with audio, scrub the native video preview, choose a range, start processing, and confirm the job uses `sourceMediaId` plus `sourceRanges`.
