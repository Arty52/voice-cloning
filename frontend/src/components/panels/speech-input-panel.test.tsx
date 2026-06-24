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
const duplicateVoiceAssignment: VoiceTextAssignment = {
  ...assignment,
  end: 5,
  id: "assignment-two",
  start: 0,
  text: "Hello",
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
    assignmentSpeechSegmentCount: null,
    assignments: [],
    assignmentsStale: false,
    canGenerate: true,
    characterCount: 19,
    isGenerating: false,
    naturalHandoffsEnabled: true,
    onAssignVoice: vi.fn(),
    onCancelGeneration: vi.fn(),
    onClearAssignments: vi.fn(),
    onEditAssignmentVoice: vi.fn(),
    onGenerate: vi.fn(),
    onNaturalHandoffsEnabledChange: vi.fn(),
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
    expect(screen.queryByRole("checkbox", { name: "Natural Handoffs" })).not.toBeInTheDocument()
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
    expect(screen.getAllByText("Villain").length).toBeGreaterThan(0)
    expect(screen.getByText("villain line")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Edit Voice$/i }))
    await user.click(screen.getByRole("button", { name: "Narrator" }))
    await user.click(screen.getByRole("button", { name: /^Remove$/i }))

    expect(props.onEditAssignmentVoice).toHaveBeenCalledWith("assignment-one", narrator)
    expect(props.onRemoveAssignment).toHaveBeenCalledWith("assignment-one")
  })

  it("distinguishes assigned spans from generated speech segments", () => {
    renderPanel({
      assignmentSpeechSegmentCount: 3,
      assignments: [assignment],
    })

    const assignmentsRegion = screen.getByRole("region", { name: /voice assignments/i })
    expect(assignmentsRegion).toHaveTextContent("1 Assignment")
    expect(assignmentsRegion).toHaveTextContent("3 Speech Segments")
    expect(assignmentsRegion).not.toHaveTextContent("1 Segment")
  })

  it("shows enabled natural handoffs when voice assignments exist", async () => {
    const user = userEvent.setup()
    const props = renderPanel({
      assignments: [assignment],
    })

    const handoffs = screen.getByRole("checkbox", { name: "Natural Handoffs" })
    expect(handoffs).toBeChecked()
    expect(screen.getByText("Adds a short pause between generated speech segments.")).toBeInTheDocument()

    await user.click(handoffs)

    expect(props.onNaturalHandoffsEnabledChange).toHaveBeenCalledWith(false)
  })

  it("disables natural handoffs while generating", () => {
    renderPanel({
      assignments: [assignment],
      isGenerating: true,
    })

    expect(screen.getByRole("checkbox", { name: "Natural Handoffs" })).toBeDisabled()
  })

  it("shows unique quick assignment shortcuts for assigned voices", async () => {
    const user = userEvent.setup()
    const props = renderPanel({
      assignments: [assignment, duplicateVoiceAssignment],
      selectedText: "another line",
    })

    const quickButtons = screen.getAllByRole("button", { name: "Assign Selected Text to Villain" })
    expect(quickButtons).toHaveLength(1)

    await user.click(quickButtons[0])

    expect(props.onAssignVoice).toHaveBeenCalledWith(villain)
  })

  it("disables quick assignment shortcuts until text is selected", () => {
    renderPanel({
      assignments: [assignment],
    })

    expect(screen.getByRole("button", { name: "Assign Selected Text to Villain" })).toBeDisabled()
  })

  it("disables quick assignment shortcuts while generating", () => {
    renderPanel({
      assignments: [assignment],
      isGenerating: true,
      selectedText: "another line",
    })

    expect(screen.getByRole("button", { name: "Assign Selected Text to Villain" })).toBeDisabled()
  })

  it("shows validation errors and clears all assignments", async () => {
    const user = userEvent.setup()
    const props = renderPanel({
      assignmentError: "Voice assignments cannot overlap.",
      assignments: [assignment],
    })

    expect(screen.getByRole("alert")).toHaveTextContent("Voice assignments cannot overlap.")
    expect(screen.getByRole("region", { name: /voice assignments/i })).not.toHaveTextContent(/Speech Segments?/)

    await user.click(screen.getByRole("button", { name: /^Clear Assignments$/i }))

    expect(props.onClearAssignments).toHaveBeenCalled()
  })
})
