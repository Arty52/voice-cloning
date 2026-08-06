import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { TranscriptWorkflowController } from "@/hooks/use-transcript-workflow"

import { TranscriptPanel } from "./transcript-panel"

function processingTranscript(): TranscriptWorkflowController {
  return {
    canCancel: true,
    canStart: false,
    error: null,
    handleCancelTranscription: vi.fn(async () => undefined),
    handleSourceFileSelect: vi.fn(),
    handleStartTranscription: vi.fn(),
    isProcessing: true,
    job: {
      activeProgressPhaseId: "separateSpeakers",
      engine: "pyannote-community-1 + faster-whisper",
      operationLabel: "Speaker Separation",
      progressPhases: [{ detail: "Separating speakers", id: "separateSpeakers", label: "Speaker Streams", status: "running" }],
      sourceFilename: "meeting.m4a",
      sourceName: "meeting.m4a",
      status: "running",
    },
    preStartEstimateRangeSeconds: null,
    processingElapsedMs: 2_000,
    processingEstimateRangeSeconds: { maxSeconds: 120, minSeconds: 45 },
    sourceFile: null,
    speakerTranscript: {},
    status: "processing",
    unavailableReason: null,
    validationError: null,
  } as unknown as TranscriptWorkflowController
}

describe("TranscriptPanel", () => {
  it("keeps the processing announcement outside the busy upload controls", () => {
    render(<TranscriptPanel transcript={processingTranscript()} voicePresets={[]} />)

    const activity = screen.getByRole("status")

    expect(activity).toHaveAccessibleName(
      "Transcript is processing with pyannote-community-1 + faster-whisper. Progress percentage is unavailable."
    )
    expect(activity.closest("[aria-busy='true']")).toBeNull()
    expect(screen.getByLabelText("Transcript Audio Drop Zone").closest("[aria-busy='true']")).not.toBeNull()
  })
})
