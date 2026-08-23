import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { TranscriptWorkflowController } from "@/hooks/use-transcript-workflow"

import { TranscriptPanel } from "./transcript-panel"

vi.mock("@/components/speaker-transcript-workspace", () => ({
  SpeakerTranscriptWorkspace: () => <div>Transcript content</div>,
}))

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

function completedTranscript(overrides: Partial<TranscriptWorkflowController> = {}): TranscriptWorkflowController {
  return {
    ...processingTranscript(),
    canCancel: false,
    canClearTranscript: true,
    clearError: null,
    clearStatus: "idle",
    handleClearTranscript: vi.fn(async () => true),
    isClearingTranscript: false,
    isProcessing: false,
    job: {
      ...processingTranscript().job,
      id: "transcript-job-1",
      operationId: "separateSpeakers",
      status: "success",
      result: { kind: "speakerSeparation", speakers: [], transcript: { items: [] } },
    },
    status: "success",
    ...overrides,
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

  it("requires confirmation before permanently clearing a transcript", async () => {
    const user = userEvent.setup()
    const transcript = completedTranscript()
    render(<TranscriptPanel transcript={transcript} voicePresets={[]} />)

    await user.click(screen.getByRole("button", { name: "Clear Transcript" }))

    const dialog = screen.getByRole("alertdialog", { name: "Clear Transcript?" })
    expect(dialog).toBeVisible()
    expect(screen.getByText(/Saved voices and local timing diagnostics are not deleted/i)).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(transcript.handleClearTranscript).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Clear Transcript" }))
    await user.click(screen.getAllByRole("button", { name: "Clear Transcript" }).at(-1)!)

    expect(transcript.handleClearTranscript).toHaveBeenCalledTimes(1)
  })

  it("disables clearing while transcript edits are still being saved", () => {
    const transcript = completedTranscript({ canClearTranscript: false })
    render(<TranscriptPanel transcript={transcript} voicePresets={[]} />)

    expect(screen.getByRole("button", { name: "Clear Transcript" })).toBeDisabled()
  })
})
