import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import type { VoiceTextAssignment } from "@/lib/voice-assignments"
import type { VoiceAsset } from "@/types"

import { SpeechInputPanel } from "./speech-input-panel"

const narrator = voice("narrator", "Narrator")
const villain = voice("villain", "Villain")
const assignment: VoiceTextAssignment = {
  end: 20,
  id: "assignment-one",
  sourceText: "Hello villain line.",
  start: 6,
  text: "villain line",
  voiceId: villain.id,
  voiceName: villain.name,
}

function voice(id: string, name: string): VoiceAsset {
  return {
    contentType: "audio/mpeg",
    createdAt: "2026-06-23T00:00:00.000Z",
    filePath: `${id}.mp3`,
    id,
    name,
    processingSteps: [],
    sampleMode: "excerpt",
    sha256: `${id}-hash`,
    source: "upload",
    sourceContentType: null,
    sourceFilePath: null,
    sourceSha256: null,
    voicePresetId: "standardNarration",
    windowDurationSeconds: null,
    windowStartSeconds: null,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof SpeechInputPanel>[0]> = {}) {
  const props = {
    assignmentError: null,
    assignments: [],
    assignmentsStale: false,
    canGenerate: true,
    characterCount: 19,
    isGenerating: false,
    onAssignVoice: vi.fn(),
    onCancelGeneration: vi.fn(),
    onClearAssignments: vi.fn(),
    onEditAssignmentVoice: vi.fn(),
    onGenerate: vi.fn(),
    onRemoveAssignment: vi.fn(),
    onTextChange: vi.fn(),
    onTextSelectionChange: vi.fn(),
    selectedText: "",
    selectedVoice: narrator,
    text: "Hello villain line.",
    textRef: createRef<HTMLTextAreaElement>(),
    voices: [narrator, villain],
    ...overrides,
  }
  render(<SpeechInputPanel {...props} />)
  return props
}

describe("SpeechInputPanel voice assignments", () => {
  it("disables assignment until speakable text is selected", () => {
    renderPanel()

    expect(screen.getByRole("button", { name: /^Assign Voice$/i })).toBeDisabled()
    expect(screen.getByText("Select script text to assign a voice.")).toBeInTheDocument()
  })

  it("assigns the selected text to a picked voice", async () => {
    const user = userEvent.setup()
    const props = renderPanel({ selectedText: "villain line" })

    await user.click(screen.getByRole("button", { name: /^Assign Voice$/i }))
    await user.click(screen.getByRole("button", { name: "Villain" }))

    expect(props.onAssignVoice).toHaveBeenCalledWith(villain)
  })

  it("renders edit, remove, and stale assignment states", async () => {
    const user = userEvent.setup()
    const props = renderPanel({
      assignments: [assignment],
      assignmentsStale: true,
    })

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be matched/i)
    expect(screen.getByRole("region", { name: /voice assignments/i })).toBeInTheDocument()
    expect(screen.getByText("Villain")).toBeInTheDocument()
    expect(screen.getByText("villain line")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Edit Voice$/i }))
    await user.click(screen.getByRole("button", { name: "Narrator" }))
    await user.click(screen.getByRole("button", { name: /^Remove$/i }))

    expect(props.onEditAssignmentVoice).toHaveBeenCalledWith("assignment-one", narrator)
    expect(props.onRemoveAssignment).toHaveBeenCalledWith("assignment-one")
  })

  it("shows validation errors and clears all assignments", async () => {
    const user = userEvent.setup()
    const props = renderPanel({
      assignmentError: "Voice assignments cannot overlap.",
      assignments: [assignment],
    })

    expect(screen.getByRole("alert")).toHaveTextContent("Voice assignments cannot overlap.")

    await user.click(screen.getByRole("button", { name: /^Clear Assignments$/i }))

    expect(props.onClearAssignments).toHaveBeenCalled()
  })
})
