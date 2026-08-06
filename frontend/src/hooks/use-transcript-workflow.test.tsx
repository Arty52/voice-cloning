import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import {
  readTranscriptTimingDiagnostics,
  startTranscriptTimingDiagnostic,
} from "@/lib/transcript-timing-diagnostics"
import type { SampleProcessingJob, SpeakerSeparationResult } from "@/types"

import {
  ACTIVE_TRANSCRIPT_SESSIONS_STORAGE_KEY,
  LATEST_TRANSCRIPT_JOB_STORAGE_KEY,
  LATEST_TRANSCRIPT_SESSION_STORAGE_KEY,
  useTranscriptWorkflow,
} from "./use-transcript-workflow"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    cancelSampleProcessingJob: vi.fn(),
    createSampleProcessingJob: vi.fn(),
    fetchSampleProcessingJob: vi.fn(),
  }
})

const speakerResult: SpeakerSeparationResult = {
  kind: "speakerSeparation",
  speakers: [
    {
      id: "speaker-1",
      label: "Speaker 1",
      assignedName: null,
      transcriptItemIds: ["item-1"],
      result: {
        filename: "speaker-1.wav",
        contentType: "audio/wav",
        sha256: "speaker-hash",
      },
    },
  ],
  transcript: {
    items: [
      {
        id: "item-1",
        text: "Complete dialogue.",
        startSeconds: 0,
        endSeconds: 2,
        speakerId: "speaker-1",
      },
    ],
  },
}

function buildJob(
  status: SampleProcessingJob["status"],
  overrides: Partial<SampleProcessingJob> = {}
): SampleProcessingJob {
  const terminal = !["pending", "running"].includes(status)
  return {
    id: "transcript-job-1",
    operationId: "separateSpeakers",
    operationLabel: "Separate Speakers",
    status,
    processingPresetId: null,
    processingPresetLabel: null,
    sourceName: "meeting.m4a",
    sourceFilename: "meeting.m4a",
    sourceContentType: "audio/mp4",
    sourceSha256: "source-hash",
    sourcePreference: "original",
    engine: "pyannote-community-1+faster-whisper",
    workflowMode: "single",
    steps: [
      {
        id: "step-1",
        operationId: "separateSpeakers",
        operationLabel: "Separate Speakers",
        status: terminal ? (status === "success" ? "success" : status === "canceled" ? "canceled" : "error") : "running",
        engine: "pyannote-community-1+faster-whisper",
        processingPresetId: null,
        processingPresetLabel: null,
        startedAt: "2026-08-04T20:00:00.000Z",
        completedAt: terminal ? "2026-08-04T20:00:05.000Z" : null,
        error: status === "error" ? "Diarization failed." : null,
        sourceSha256: "source-hash",
        resultSha256: status === "success" ? "result-hash" : null,
      },
    ],
    activeStepId: terminal ? null : "step-1",
    createdAt: "2026-08-04T20:00:00.000Z",
    updatedAt: terminal ? "2026-08-04T20:00:05.000Z" : "2026-08-04T20:00:01.000Z",
    error: status === "error" ? "Diarization failed." : null,
    result: status === "success" ? speakerResult : null,
    ...overrides,
  }
}

function renderTranscriptWorkflow(overrides: Partial<Parameters<typeof useTranscriptWorkflow>[0]> = {}) {
  return renderHook(() =>
    useTranscriptWorkflow({
      availabilityError: null,
      availabilityStatus: "success",
      diarizationAvailable: true,
      onVoiceSaved: vi.fn(),
      ...overrides,
    })
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(api.cancelSampleProcessingJob).mockReset()
  vi.mocked(api.createSampleProcessingJob).mockReset()
  vi.mocked(api.fetchSampleProcessingJob).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useTranscriptWorkflow", () => {
  it("submits the complete selected audio file directly to speaker separation", async () => {
    const sourceFile = new File(["complete audio"], "roundtable.m4a", { type: "audio/mp4" })
    const completedJob = buildJob("success")
    vi.mocked(api.createSampleProcessingJob).mockResolvedValue({ job: completedJob })
    const { result } = renderTranscriptWorkflow()

    expect(result.current.preStartEstimateRangeSeconds).toBeNull()
    act(() => result.current.handleSourceFileSelect(sourceFile))
    expect(result.current.canStart).toBe(true)
    expect(result.current.preStartEstimateRangeSeconds).toEqual({ minSeconds: 40, maxSeconds: 115 })

    await act(async () => result.current.handleStartTranscription())

    expect(api.createSampleProcessingJob).toHaveBeenCalledWith({
      operationId: "separateSpeakers",
      sourceFile,
    })
    expect(result.current.status).toBe("success")
    expect(result.current.job).toEqual(completedJob)
    expect(result.current.preStartEstimateRangeSeconds).toBeNull()
    expect(result.current.processingElapsedMs).toBe(5_000)
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)).toBe(completedJob.id)
    expect(result.current.timingDiagnostic).toMatchObject({
      actualElapsedMs: 5_000,
      estimateMinSeconds: 40,
      estimateMaxSeconds: 115,
      sourceExtension: "m4a",
      sourceMediaType: "audio/mp4",
      sourceSizeBytes: sourceFile.size,
      workflowStatus: "success",
    })
    expect(JSON.stringify(readTranscriptTimingDiagnostics())).not.toContain(sourceFile.name)
  })

  it("restores and resumes a running latest transcript job", async () => {
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, "transcript-job-1")
    const diagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-1",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["audio"], "private-name.mp3", { type: "audio/mpeg" }),
    })
    window.localStorage.setItem(
      LATEST_TRANSCRIPT_SESSION_STORAGE_KEY,
      JSON.stringify({ jobId: "transcript-job-1", timingDiagnosticId: diagnostic.id })
    )
    vi.mocked(api.fetchSampleProcessingJob).mockResolvedValue({ job: buildJob("running") })
    const { result, unmount } = renderTranscriptWorkflow()

    expect(result.current.status).toBe("restoring")
    await waitFor(() => expect(result.current.status).toBe("processing"))
    expect(result.current.job?.id).toBe("transcript-job-1")
    expect(result.current.processingElapsedMs).not.toBeNull()
    expect(result.current.timingDiagnostic?.workflowStatus).toBe("processing")

    unmount()
  })

  it("invalidates a stale paired session when writing its replacement fails", async () => {
    const { result } = renderTranscriptWorkflow()
    const staleDiagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-stale",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["stale"], "stale.mp3", { type: "audio/mpeg" }),
    })
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, "transcript-job-stale")
    window.localStorage.setItem(
      LATEST_TRANSCRIPT_SESSION_STORAGE_KEY,
      JSON.stringify({ jobId: "transcript-job-stale", timingDiagnosticId: staleDiagnostic.id })
    )
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === LATEST_TRANSCRIPT_SESSION_STORAGE_KEY) {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError")
      }
      return originalSetItem.call(this, key, value)
    })
    const runningJob = buildJob("running", { id: "transcript-job-current" })
    const sourceFile = new File(["current"], "current.mp3", { type: "audio/mpeg" })
    vi.mocked(api.createSampleProcessingJob).mockResolvedValue({ job: runningJob })

    act(() => result.current.handleSourceFileSelect(sourceFile))
    await act(async () => result.current.handleStartTranscription())

    expect(result.current.job?.id).toBe(runningJob.id)
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_SESSION_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)).toBe(runningJob.id)
  })

  it("restores the diagnostic paired with its stored job instead of another tab's active diagnostic", async () => {
    const firstJob = buildJob("success", { id: "transcript-job-first" })
    const firstDiagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-first",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["first"], "first.mp3", { type: "audio/mpeg" }),
    })
    const secondDiagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-second",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["second"], "second.mp3", { type: "audio/mpeg" }),
    })
    // A second tab may have most recently written the legacy job pointer, but
    // the paired session remains the only safe restoration source.
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, "transcript-job-second")
    window.localStorage.setItem(
      LATEST_TRANSCRIPT_SESSION_STORAGE_KEY,
      JSON.stringify({ jobId: firstJob.id, timingDiagnosticId: firstDiagnostic.id })
    )
    vi.mocked(api.fetchSampleProcessingJob).mockResolvedValue({ job: firstJob })

    const { result } = renderTranscriptWorkflow()

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.timingDiagnostic).toMatchObject({
      id: firstDiagnostic.id,
      workflowStatus: "success",
      actualElapsedMs: 5_000,
    })
    expect(readTranscriptTimingDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstDiagnostic.id, workflowStatus: "success" }),
        expect.objectContaining({ id: secondDiagnostic.id, workflowStatus: "incomplete", actualElapsedMs: null }),
      ])
    )
  })

  it("restores a completed transcript result and retains the latest pointer", async () => {
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, "transcript-job-1")
    vi.mocked(api.fetchSampleProcessingJob).mockResolvedValue({ job: buildJob("success") })
    const { result } = renderTranscriptWorkflow()

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.speakerTranscript.speakerSeparationResult).toEqual(speakerResult)
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)).toBe("transcript-job-1")
  })

  it("cancels an active transcript job", async () => {
    const runningJob = buildJob("running")
    const canceledJob = buildJob("canceled")
    const sourceFile = new File(["audio"], "meeting.mp3", { type: "audio/mpeg" })
    vi.mocked(api.createSampleProcessingJob).mockResolvedValue({ job: runningJob })
    vi.mocked(api.cancelSampleProcessingJob).mockResolvedValue({ job: canceledJob })
    const { result } = renderTranscriptWorkflow()

    act(() => result.current.handleSourceFileSelect(sourceFile))
    await act(async () => result.current.handleStartTranscription())
    expect(result.current.canCancel).toBe(true)
    await act(async () => result.current.handleCancelTranscription())

    expect(api.cancelSampleProcessingJob).toHaveBeenCalledWith(runningJob.id)
    expect(result.current.status).toBe("canceled")
    expect(result.current.job).toEqual(canceledJob)
    expect(result.current.timingDiagnostic).toMatchObject({
      actualElapsedMs: 5_000,
      workflowStatus: "canceled",
    })
  })

  it("keeps timing lifecycle updates attached to each concurrently mounted transcript workflow", async () => {
    const firstRunningJob = buildJob("running", { id: "transcript-job-first" })
    const secondRunningJob = buildJob("running", { id: "transcript-job-second" })
    const firstCanceledJob = buildJob("canceled", { id: "transcript-job-first" })
    vi.mocked(api.createSampleProcessingJob)
      .mockResolvedValueOnce({ job: firstRunningJob })
      .mockResolvedValueOnce({ job: secondRunningJob })
    vi.mocked(api.cancelSampleProcessingJob).mockResolvedValue({ job: firstCanceledJob })
    const first = renderTranscriptWorkflow()
    const second = renderTranscriptWorkflow()

    act(() => first.result.current.handleSourceFileSelect(new File(["first"], "first.mp3", { type: "audio/mpeg" })))
    await act(async () => first.result.current.handleStartTranscription())
    act(() => second.result.current.handleSourceFileSelect(new File(["second"], "second.mp3", { type: "audio/mpeg" })))
    await act(async () => second.result.current.handleStartTranscription())
    await act(async () => first.result.current.handleCancelTranscription())

    const records = readTranscriptTimingDiagnostics()
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceExtension: "mp3", workflowStatus: "canceled" }),
        expect.objectContaining({ sourceExtension: "mp3", workflowStatus: "processing" }),
      ])
    )
    expect(first.result.current.timingDiagnostic?.workflowStatus).toBe("canceled")
    expect(second.result.current.timingDiagnostic?.workflowStatus).toBe("processing")
  })

  it("records a terminal error when a transcript cannot be started", async () => {
    const sourceFile = new File(["audio"], "meeting.wav", { type: "audio/wav" })
    vi.mocked(api.createSampleProcessingJob).mockRejectedValue(new Error("Local processor unavailable."))
    const { result } = renderTranscriptWorkflow()

    act(() => result.current.handleSourceFileSelect(sourceFile))
    await act(async () => result.current.handleStartTranscription())

    expect(result.current.status).toBe("error")
    expect(result.current.error).toBe("Local processor unavailable.")
    expect(result.current.timingDiagnostic).toMatchObject({
      sourceExtension: "wav",
      workflowStatus: "error",
    })
    expect(result.current.timingDiagnostic?.actualElapsedMs).toBeGreaterThanOrEqual(0)
  })

  it("disables transcription when local diarization is unavailable", () => {
    const { result } = renderTranscriptWorkflow({ diarizationAvailable: false })
    act(() =>
      result.current.handleSourceFileSelect(new File(["audio"], "meeting.flac", { type: "audio/flac" }))
    )

    expect(result.current.canStart).toBe(false)
    expect(result.current.unavailableReason).toContain("Speaker detection is unavailable")
  })

  it("clears a stale latest job pointer when restoration fails", async () => {
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, "missing-job")
    const diagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-missing",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["audio"], "missing.flac", { type: "audio/flac" }),
    })
    window.localStorage.setItem(
      LATEST_TRANSCRIPT_SESSION_STORAGE_KEY,
      JSON.stringify({ jobId: "missing-job", timingDiagnosticId: diagnostic.id })
    )
    vi.mocked(api.fetchSampleProcessingJob).mockRejectedValue(new Error("Sample processing job not found."))
    const { result } = renderTranscriptWorkflow()

    await waitFor(() => expect(result.current.status).toBe("idle"))
    expect(result.current.job).toBeNull()
    expect(result.current.error).toBeNull()
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)).toBeNull()
    expect(result.current.timingDiagnostic?.workflowStatus).toBe("incomplete")
  })

  it("marks an orphaned local diagnostic incomplete when no restorable job remains", async () => {
    startTranscriptTimingDiagnostic({
      createId: () => "timing-orphaned",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["audio"], "orphaned.ogg", { type: "audio/ogg" }),
    })

    const { result } = renderTranscriptWorkflow()

    await waitFor(() => expect(result.current.timingDiagnostic?.workflowStatus).toBe("incomplete"))
    expect(readTranscriptTimingDiagnostics()[0]?.actualElapsedMs).toBeNull()
  })

  it("reconciles every pre-job diagnostic when concurrent tabs close before either job is persisted", async () => {
    const firstDiagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-first-pre-job",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["first"], "first.mp3", { type: "audio/mpeg" }),
    })
    const secondDiagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-second-pre-job",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["second"], "second.mp3", { type: "audio/mpeg" }),
    })

    const { result } = renderTranscriptWorkflow()

    await waitFor(() => expect(result.current.status).toBe("idle"))
    expect(readTranscriptTimingDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstDiagnostic.id, workflowStatus: "incomplete", actualElapsedMs: null }),
        expect.objectContaining({ id: secondDiagnostic.id, workflowStatus: "incomplete", actualElapsedMs: null }),
      ])
    )
  })

  it("retains diagnostics paired with another persisted transcript session while reconciling orphans", async () => {
    const pairedDiagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-paired-session",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["paired"], "paired.mp3", { type: "audio/mpeg" }),
    })
    const orphanDiagnostic = startTranscriptTimingDiagnostic({
      createId: () => "timing-unpaired-session",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      sourceFile: new File(["orphan"], "orphan.mp3", { type: "audio/mpeg" }),
    })
    const pairedJob = buildJob("running", { id: "transcript-job-paired" })
    window.localStorage.setItem(
      ACTIVE_TRANSCRIPT_SESSIONS_STORAGE_KEY,
      JSON.stringify([{ jobId: pairedJob.id, timingDiagnosticId: pairedDiagnostic.id }])
    )
    window.localStorage.setItem(
      LATEST_TRANSCRIPT_SESSION_STORAGE_KEY,
      JSON.stringify({ jobId: pairedJob.id, timingDiagnosticId: pairedDiagnostic.id })
    )
    vi.mocked(api.fetchSampleProcessingJob).mockResolvedValue({ job: pairedJob })

    const { result, unmount } = renderTranscriptWorkflow()

    await waitFor(() => expect(result.current.status).toBe("processing"))
    expect(readTranscriptTimingDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pairedDiagnostic.id, workflowStatus: "processing" }),
        expect.objectContaining({ id: orphanDiagnostic.id, workflowStatus: "incomplete", actualElapsedMs: null }),
      ])
    )
    unmount()
  })

  it("keeps an initially unrestorable stored job active until polling recovers", async () => {
    vi.useFakeTimers()
    const runningJob = buildJob("running")
    const completedJob = buildJob("success")
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, runningJob.id)
    vi.mocked(api.fetchSampleProcessingJob)
      .mockRejectedValueOnce(new Error("Local API temporarily unavailable."))
      .mockResolvedValueOnce({ job: runningJob })
      .mockResolvedValueOnce({ job: completedJob })
    const { result } = renderTranscriptWorkflow()

    await act(async () => Promise.resolve())

    expect(result.current.status).toBe("processing")
    expect(result.current.canCancel).toBe(true)
    expect(result.current.canStart).toBe(false)
    expect(result.current.error).toBe("Local API temporarily unavailable. Retrying.")
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)).toBe(runningJob.id)

    act(() => result.current.handleSourceFileSelect(new File(["audio"], "duplicate.mp3", { type: "audio/mpeg" })))
    expect(result.current.canStart).toBe(false)
    await act(async () => result.current.handleStartTranscription())
    expect(api.createSampleProcessingJob).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1_500))
    expect(result.current.status).toBe("processing")
    expect(result.current.job).toEqual(runningJob)
    expect(result.current.error).toBeNull()
    expect(result.current.canCancel).toBe(true)

    await act(async () => vi.advanceTimersByTimeAsync(1_500))
    expect(result.current.status).toBe("success")
    expect(result.current.job).toEqual(completedJob)
    expect(result.current.error).toBeNull()
  })

  it("clears a running job that disappears while polling", async () => {
    vi.useFakeTimers()
    const runningJob = buildJob("running")
    vi.mocked(api.createSampleProcessingJob).mockResolvedValue({ job: runningJob })
    vi.mocked(api.fetchSampleProcessingJob).mockRejectedValue(new Error("Sample processing job not found."))
    const { result } = renderTranscriptWorkflow()

    act(() => result.current.handleSourceFileSelect(new File(["audio"], "meeting.mp3", { type: "audio/mpeg" })))
    await act(async () => result.current.handleStartTranscription())
    expect(result.current.status).toBe("processing")

    await act(async () => vi.advanceTimersByTimeAsync(1_500))

    expect(result.current.status).toBe("idle")
    expect(result.current.job).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.processingElapsedMs).toBeNull()
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)).toBeNull()
  })

  it("keeps a running job recoverable across transient polling errors", async () => {
    vi.useFakeTimers()
    const runningJob = buildJob("running")
    const completedJob = buildJob("success")
    vi.mocked(api.createSampleProcessingJob).mockResolvedValue({ job: runningJob })
    vi.mocked(api.fetchSampleProcessingJob)
      .mockRejectedValueOnce(new Error("Local API temporarily unavailable."))
      .mockResolvedValueOnce({ job: completedJob })
    const { result } = renderTranscriptWorkflow()

    act(() => result.current.handleSourceFileSelect(new File(["audio"], "meeting.mp3", { type: "audio/mpeg" })))
    await act(async () => result.current.handleStartTranscription())
    await act(async () => vi.advanceTimersByTimeAsync(1_500))

    expect(result.current.status).toBe("processing")
    expect(result.current.canCancel).toBe(true)
    expect(result.current.canStart).toBe(false)
    expect(result.current.error).toBe("Local API temporarily unavailable. Retrying.")
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)).toBe(runningJob.id)

    await act(async () => vi.advanceTimersByTimeAsync(1_500))

    expect(result.current.status).toBe("success")
    expect(result.current.job).toEqual(completedJob)
    expect(result.current.error).toBeNull()
  })

  it("rejects unsupported non-audio uploads before starting", () => {
    const { result } = renderTranscriptWorkflow()
    act(() => result.current.handleSourceFileSelect(new File(["video"], "meeting.mp4", { type: "video/mp4" })))

    expect(result.current.sourceFile).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.validationError).toContain("Choose an MP3")
    expect(result.current.canStart).toBe(false)

    act(() => result.current.handleSourceFileSelect(new File(["audio"], "meeting.m4a", { type: "audio/mp4" })))
    expect(result.current.validationError).toBeNull()
    expect(result.current.canStart).toBe(true)
  })
})
