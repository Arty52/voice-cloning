# Transcript Timing Diagnostics

Voice Clone Lab records a small set of transcript-processing timing diagnostics in browser-local storage. These records exist to compare the planning range shown before processing with observed terminal elapsed time, investigate variability, and determine whether the current heuristic should be recalibrated.

## Estimate Semantics

The Transcript estimate is an uncalibrated, file-size-based planning range. It is not derived from audio duration and is not a promise of completion time. Actual processing can materially diverge because of local hardware, audio duration and content, speaker separation, and the active pipeline stage.

Diagnostics retain the original low and high estimate alongside actual elapsed time so future calibration work can measure heuristic error instead of inferring it from isolated observations. Changing the heuristic requires separate product and engineering review; diagnostic collection does not silently retune the range.

## Local Record Contract

Each version 1 record contains only:

- a locally generated diagnostic record id and schema version;
- creation and optional completion timestamps;
- the estimate's low and high seconds;
- terminal elapsed milliseconds when a terminal duration is available;
- source byte size plus a safe audio media type and allowlisted extension;
- workflow status: `starting`, `processing`, `success`, `canceled`, `error`, or `incomplete`; and
- the fixed estimate settings for Transcript speaker detection.

The record id correlates lifecycle updates within the browser. It is not a user identifier and is not sent to the local API or any external service.

The allowlist intentionally excludes filenames, paths, raw transcript text, speaker or dialogue content, audio bytes, hashes, job ids, user identifiers, errors, and provider credentials. The source file remains in memory only for the existing upload request; diagnostics never retain the file itself.

## Lifecycle And Recovery

- A record begins at transcript submission with the exact pre-start estimate and safe source metadata.
- A server job moves it to `processing`; success, cancellation, and terminal errors retain the final job-timestamp elapsed duration.
- A start failure is recorded as `error` with browser-observed attempt time.
- Reload restoration continues the same active local record when both the latest-job pointer and diagnostic pointer remain available.
- A missing or inaccessible job, a mismatched restored operation, or an orphaned active record with no restorable job becomes `incomplete`. Its elapsed duration remains `null` because no reliable terminal duration is available.
- Transient restore or polling failures remain `processing` while the existing retry and cancellation behavior continues.

Browser storage is optional. Blocked, unavailable, corrupt, or cleared storage never prevents transcript processing.

## Retention And Clearing

The store keeps at most 50 records and drops records older than 30 days on the next diagnostics access. This bounded, short-lived default is used because the app has no existing diagnostics-view convention and no in-product diagnostics viewer.

Users can clear the records with their browser's site-data controls. Code that later adds a diagnostics viewer or settings surface must use `clearTranscriptTimingDiagnostics()` so the record store and active diagnostic pointer are removed together.

## External Data Boundary

Timing diagnostics are written only to `localStorage` under the `voice-cloning.transcriptTimingDiagnostics.v1` namespace. The frontend does not include them in API requests, analytics, telemetry, exports, or generated transcript data. Any future external transmission requires a separate, explicit privacy and product decision.
