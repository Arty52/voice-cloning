import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { SampleProcessingJob, SpeakerSeparationResult } from "@/types"

import { LATEST_TRANSCRIPT_JOB_STORAGE_KEY, useTranscriptWorkflow } from "./use-transcript-workflow"

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
  })

  it("restores and resumes a running latest transcript job", async () => {
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, "transcript-job-1")
    vi.mocked(api.fetchSampleProcessingJob).mockResolvedValue({ job: buildJob("running") })
    const { result, unmount } = renderTranscriptWorkflow()

    expect(result.current.status).toBe("restoring")
    await waitFor(() => expect(result.current.status).toBe("processing"))
    expect(result.current.job?.id).toBe("transcript-job-1")
    expect(result.current.processingElapsedMs).not.toBeNull()

    unmount()
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
    vi.mocked(api.fetchSampleProcessingJob).mockRejectedValue(new Error("Sample processing job not found."))
    const { result } = renderTranscriptWorkflow()

    await waitFor(() => expect(result.current.status).toBe("idle"))
    expect(result.current.job).toBeNull()
    expect(result.current.error).toBeNull()
    expect(window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)).toBeNull()
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
