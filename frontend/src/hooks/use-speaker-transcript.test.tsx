import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import type { SampleProcessingJob, SpeakerSeparationResult } from "@/types"

import { useSpeakerTranscript } from "./use-speaker-transcript"

const speakerResult: SpeakerSeparationResult = {
  kind: "speakerSeparation",
  speakers: [
    {
      id: "speaker-1",
      label: "Speaker 1",
      assignedName: "Morgan",
      transcriptItemIds: ["item-1"],
      result: { filename: "speaker-1.wav", contentType: "audio/wav", sha256: "speaker-1-hash" },
    },
    {
      id: "speaker-2",
      label: "Speaker 2",
      assignedName: null,
      transcriptItemIds: ["item-2"],
      result: { filename: "speaker-2.wav", contentType: "audio/wav", sha256: "speaker-2-hash" },
    },
  ],
  transcript: {
    items: [
      { id: "item-1", text: "Hello.", startSeconds: 0, endSeconds: 1, speakerId: "speaker-1" },
      { id: "item-2", text: "Hi.", startSeconds: 1.2, endSeconds: 2, speakerId: "speaker-2" },
    ],
  },
}

const job: SampleProcessingJob = {
  id: "job-1",
  operationId: "separateSpeakers",
  operationLabel: "Separate Speakers",
  status: "success",
  processingPresetId: null,
  processingPresetLabel: null,
  sourceName: "Conversation",
  sourceFilename: "conversation.wav",
  sourceContentType: "audio/wav",
  sourceSha256: "source-hash",
  sourcePreference: "original",
  engine: "pyannote-community-1+faster-whisper",
  workflowMode: "single",
  steps: [],
  activeStepId: null,
  createdAt: "2026-08-04T00:00:00Z",
  updatedAt: "2026-08-04T00:01:00Z",
  error: null,
  result: speakerResult,
}

describe("useSpeakerTranscript", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("initializes shared speaker state and persists dirty transcript drafts", async () => {
    const correctedJob: SampleProcessingJob = {
      ...job,
      result: {
        ...speakerResult,
        transcript: {
          items: [
            { ...speakerResult.transcript.items[0], text: "Corrected hello." },
            speakerResult.transcript.items[1],
          ],
        },
      },
    }
    const updateTranscript = vi
      .spyOn(api, "updateSampleProcessingTranscriptItems")
      .mockResolvedValue({ job: correctedJob })
    const onJobUpdate = vi.fn()
    const { result } = renderHook(() =>
      useSpeakerTranscript({ job, onJobUpdate, onVoiceSaved: vi.fn(), defaultVoicePresetId: "animatedDialogue" })
    )

    await waitFor(() => expect(result.current.selectedSpeakerIds).toEqual(["speaker-1", "speaker-2"]))
    expect(result.current.speakerNameAssignments).toEqual({
      "speaker-1": "Morgan",
      "speaker-2": "Speaker 2",
    })
    expect(result.current.speakerVoicePresetIds).toEqual({
      "speaker-1": "animatedDialogue",
      "speaker-2": "animatedDialogue",
    })

    act(() => {
      result.current.handleTranscriptTextChange("item-1", "  Corrected hello.  ")
    })
    expect(result.current.hasUnsavedTranscriptChanges).toBe(true)
    expect(result.current.unsavedTranscriptItemIds).toEqual(["item-1"])
    expect(result.current.canSaveTranscript).toBe(true)

    await act(async () => {
      await result.current.handleSaveTranscriptItems()
    })

    expect(updateTranscript).toHaveBeenCalledWith("job-1", {
      items: [{ itemId: "item-1", text: "  Corrected hello.  " }],
    })
    expect(onJobUpdate).toHaveBeenCalledWith(correctedJob)
    expect(result.current.transcriptTextDrafts["item-1"]).toBe("Corrected hello.")
    expect(result.current.hasUnsavedTranscriptChanges).toBe(false)
    expect(result.current.transcriptSaveStatus).toBe("success")
  })

  it("rejects blank correction drafts before calling the API", async () => {
    const updateTranscript = vi.spyOn(api, "updateSampleProcessingTranscriptItems")
    const { result } = renderHook(() =>
      useSpeakerTranscript({ job, onJobUpdate: vi.fn(), onVoiceSaved: vi.fn() })
    )
    await waitFor(() => expect(result.current.transcriptTextDrafts["item-1"]).toBe("Hello."))

    act(() => {
      result.current.handleTranscriptTextChange("item-1", "  \n  ")
    })
    expect(result.current.canSaveTranscript).toBe(false)

    await act(async () => {
      await result.current.saveTranscriptItems(["item-1"])
    })

    expect(updateTranscript).not.toHaveBeenCalled()
    expect(result.current.transcriptSaveStatus).toBe("error")
    expect(result.current.transcriptSaveError).toBe("Transcript text is required.")
  })

  it("ignores a correction response after the active job changes", async () => {
    let resolveUpdate: (payload: { job: SampleProcessingJob }) => void = () => undefined
    const response = new Promise<{ job: SampleProcessingJob }>((resolve) => {
      resolveUpdate = resolve
    })
    vi.spyOn(api, "updateSampleProcessingTranscriptItems").mockReturnValue(response)
    const onJobUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ activeJob }: { activeJob: SampleProcessingJob | null }) =>
        useSpeakerTranscript({ job: activeJob, onJobUpdate, onVoiceSaved: vi.fn() }),
      { initialProps: { activeJob: job as SampleProcessingJob | null } }
    )
    await waitFor(() => expect(result.current.transcriptTextDrafts["item-1"]).toBe("Hello."))
    act(() => {
      result.current.handleTranscriptTextChange("item-1", "Updated.")
    })

    let savePromise: Promise<void> = Promise.resolve()
    act(() => {
      savePromise = result.current.saveTranscriptItems(["item-1"])
    })
    await waitFor(() => expect(result.current.transcriptSaveStatus).toBe("loading"))
    rerender({ activeJob: null })
    await act(async () => {
      resolveUpdate({ job })
      await savePromise
    })

    expect(onJobUpdate).not.toHaveBeenCalled()
    expect(result.current.speakerSeparationResult).toBeNull()
    expect(result.current.transcriptTextDrafts).toEqual({})
  })
})
