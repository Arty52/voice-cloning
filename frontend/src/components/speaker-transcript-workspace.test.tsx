import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useSpeakerTranscript } from "@/hooks/use-speaker-transcript"
import * as api from "@/lib/api"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { SampleProcessingJob, SpeakerSeparationResult } from "@/types"

import { SpeakerTranscriptWorkspace } from "./speaker-transcript-workspace"

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
      { id: "item-1", text: "Hello there.", startSeconds: 0, endSeconds: 1, speakerId: "speaker-1" },
      { id: "item-2", text: "General Kenobi.", startSeconds: 61, endSeconds: 62, speakerId: "speaker-2" },
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
  sourceName: "Planning Session",
  sourceFilename: "planning-session.m4a",
  sourceContentType: "audio/mp4",
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

const voicePresets = [
  { id: "standardNarration" as const, label: "Standard Narration", description: "Balanced narration." },
  { id: "animatedDialogue" as const, label: "Animated Dialogue", description: "Expressive dialogue." },
]

function TestWorkspace() {
  const [activeJob, setActiveJob] = useState(job)
  const controller = useSpeakerTranscript({
    job: activeJob,
    onJobUpdate: setActiveJob,
    onVoiceSaved: vi.fn(),
  })
  return (
    <TooltipProvider>
      <SpeakerTranscriptWorkspace controller={controller} job={activeJob} voicePresets={voicePresets} />
    </TooltipProvider>
  )
}

function TestWorkspacePair() {
  return (
    <>
      <div data-testid="workspace-one">
        <TestWorkspace />
      </div>
      <div data-testid="workspace-two">
        <TestWorkspace />
      </div>
    </>
  )
}

describe("SpeakerTranscriptWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("edits transcript text, blocks dirty export, and downloads selected TXT options after save", async () => {
    const user = userEvent.setup()
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
    const createObjectUrl = vi.fn(() => "blob:transcript")
    const revokeObjectUrl = vi.fn()
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl })
    const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    const append = vi.spyOn(document.body, "append")

    render(<TestWorkspace />)

    await screen.findByDisplayValue("Morgan")
    expect(screen.getByDisplayValue("Speaker 2")).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Export Settings" })).toBeInTheDocument()
    const markdown = screen.getByRole("radio", { name: "Markdown" })
    const text = screen.getByRole("radio", { name: "TXT" })
    expect(markdown).toHaveAttribute("aria-checked", "true")
    expect(markdown).toHaveAttribute("data-state", "on")
    expect(text).toHaveAttribute("aria-checked", "false")
    expect(text).toHaveAttribute("data-state", "off")
    const exportButton = screen.getByRole("button", { name: "Export Transcript" })
    expect(exportButton).toBeEnabled()

    await user.click(screen.getByRole("button", { name: "Hello there." }))
    const dialogueText = screen.getByRole("textbox", { name: "Dialogue Text" })
    await user.clear(dialogueText)
    await user.type(dialogueText, "  Corrected hello.  ")

    expect(exportButton).toBeDisabled()
    expect(screen.getByText("1 Unsaved Corrections")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save Correction" }))

    await waitFor(() => expect(updateTranscript).toHaveBeenCalledWith("job-1", {
      items: [{ itemId: "item-1", text: "  Corrected hello.  " }],
    }))
    await waitFor(() => expect(exportButton).toBeEnabled())

    await user.click(text)
    expect(markdown).toHaveAttribute("aria-checked", "false")
    expect(markdown).toHaveAttribute("data-state", "off")
    expect(text).toHaveAttribute("aria-checked", "true")
    expect(text).toHaveAttribute("data-state", "on")
    await user.click(screen.getByRole("checkbox", { name: "Include Timestamps" }))
    await user.click(exportButton)

    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(clickDownload).toHaveBeenCalledOnce()
    const anchor = append.mock.calls.find(([node]) => node instanceof HTMLAnchorElement)?.[0] as HTMLAnchorElement
    expect(anchor.download).toBe("planning-session-transcript.txt")
    expect(anchor.isConnected).toBe(false)
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith("blob:transcript"))
  })

  it("clears a transcript selection when the user clicks away", async () => {
    const user = userEvent.setup()

    render(<TestWorkspace />)

    await user.click(screen.getByRole("button", { name: "Hello there." }))
    expect(screen.getByText("1 Selected")).toBeInTheDocument()

    await user.click(screen.getByRole("heading", { name: "Transcript" }))

    await waitFor(() => expect(screen.queryByText("1 Selected")).not.toBeInTheDocument())
  })

  it("clears another workspace's selection when a transcript paragraph is selected", async () => {
    const user = userEvent.setup()

    render(<TestWorkspacePair />)

    const firstWorkspace = within(screen.getByTestId("workspace-one"))
    const secondWorkspace = within(screen.getByTestId("workspace-two"))
    await user.click(firstWorkspace.getByRole("button", { name: "Hello there." }))
    expect(firstWorkspace.getByText("1 Selected")).toBeInTheDocument()

    await user.click(secondWorkspace.getByRole("button", { name: "Hello there." }))

    await waitFor(() => expect(firstWorkspace.queryByText("1 Selected")).not.toBeInTheDocument())
    expect(secondWorkspace.getByText("1 Selected")).toBeInTheDocument()
  })
})
