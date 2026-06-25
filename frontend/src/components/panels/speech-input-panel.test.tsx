import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import type { DialogueScriptController } from "@/hooks/use-dialogue-script"
import { speakerColorClassName, type MultiVoiceScriptBlock } from "@/lib/dialogue-script"
import type { VoiceTextAssignment } from "@/lib/voice-assignments"
import type { ProviderTuningControl, VoiceAsset } from "@/types"
import { TooltipProvider } from "@/components/ui/tooltip"

import { SpeechInputPanel } from "./speech-input-panel"

const narrator = voice("narrator", "Narrator")
const skippy = voice("skippy", "Skippy Voice")
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
const dialogueTuningControls: ProviderTuningControl[] = [
  {
    defaultValue: 0.5,
    description: "Controls stability.",
    id: "stability",
    label: "Stability",
    max: 1,
    min: 0,
    step: 0.01,
    type: "slider",
  },
]

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
    voiceSettingsByProvider: {},
    windowDurationSeconds: null,
    windowStartSeconds: null,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof SpeechInputPanel>[0]> = {}) {
  const props = {
    activeProviderId: "elevenlabs",
    assignmentError: null,
    assignmentSpeechSegmentCount: null,
    assignments: [],
    assignmentsStale: false,
    canGenerate: true,
    characterCount: 19,
    dialogue: dialogueController(),
    dialogueSpeechSegmentCount: null,
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
    providerTuningControls: [],
    selectedText: "",
    selectedVoice: narrator,
    text: "Hello villain line.",
    textRef: createRef<HTMLTextAreaElement>(),
    tuning: {},
    voices: [narrator, villain, skippy],
    ...overrides,
  }
  render(
    <TooltipProvider>
      <SpeechInputPanel {...props} />
    </TooltipProvider>
  )
  return props
}

function dialogueController(overrides: Partial<DialogueScriptController> = {}): DialogueScriptController {
  return {
    allBlocksSelected: false,
    applyBlockVoiceSettingsToMatchingVoice: vi.fn(),
    assignSelectedBlocks: vi.fn(),
    blocks: [],
    clearSelectedBlocks: vi.fn(),
    importFromText: vi.fn(),
    mode: "range",
    segmentBuild: {
      error: null,
      missingSpeakerLabels: [],
      segments: [],
      text: "",
    },
    selectedBlockCount: 0,
    selectedBlockIds: new Set<string>(),
    setAllBlocksSelected: vi.fn(),
    setMode: vi.fn(),
    speakerLabels: [],
    speakerMappings: [],
    toggleBlockSelection: vi.fn(),
    updateBlockSpeakerLabel: vi.fn(),
    updateBlockText: vi.fn(),
    updateBlockVoice: vi.fn(),
    updateBlockVoiceSettings: vi.fn(),
    updateSpeakerMapping: vi.fn(),
    ...overrides,
  } as DialogueScriptController
}

function dialogueBlock(overrides: Partial<MultiVoiceScriptBlock> = {}): MultiVoiceScriptBlock {
  return {
    id: "dialogue-block-1",
    speakerLabel: "Skippy",
    text: "Hello world.",
    voiceId: null,
    voiceName: null,
    voiceSettings: null,
    ...overrides,
  }
}

describe("SpeechInputPanel voice assignments", () => {
  it("disables assignment until speakable text is selected", () => {
    renderPanel()

    expect(screen.getByRole("button", { name: /^Assign Voice$/i })).toBeDisabled()
    expect(screen.queryByRole("checkbox", { name: "Natural Handoffs" })).not.toBeInTheDocument()
    expect(screen.getByText("Select script text to assign a voice.")).toBeInTheDocument()
  })

  it("explains why assignment is disabled when no text is selected", async () => {
    const user = userEvent.setup()
    renderPanel()

    const assignButton = screen.getByRole("button", { name: /^Assign Voice$/i })
    const trigger = assignButton.closest("[data-slot='tooltip-trigger']")
    expect(trigger).not.toBeNull()

    await user.hover(trigger as Element)

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Select script text before assigning a voice.")
  })

  it("explains the disabled assignment action on keyboard focus", async () => {
    renderPanel()

    const trigger = screen.getByRole("button", { name: /^Assign Voice$/i }).closest("[data-slot='tooltip-trigger']")
    expect(trigger).not.toBeNull()
    ;(trigger as HTMLElement).focus()

    expect(trigger).toHaveFocus()
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Select script text before assigning a voice.")
  })

  it("assigns the selected text to a picked voice", async () => {
    const user = userEvent.setup()
    const props = renderPanel({ selectedText: "villain line" })

    await user.click(screen.getByRole("button", { name: /^Assign Voice$/i }))
    await user.click(screen.getByRole("button", { name: "Villain" }))

    expect(props.onAssignVoice).toHaveBeenCalledWith(villain)
  })

  it("shows multi-line selected text as a compact excerpt", () => {
    renderPanel({ selectedText: "first line\nsecond line\nthird line" })

    expect(screen.getByText("Selected: first line / second line / third line")).toBeInTheDocument()
  })

  it("switches input modes and imports dialogue from the source text", async () => {
    const user = userEvent.setup()
    const dialogue = dialogueController()
    renderPanel({ dialogue, text: "Skippy: Hello." })

    await user.click(screen.getByRole("radio", { name: "Dialogue Rows" }))
    await user.click(screen.getByRole("button", { name: "Import Dialogue" }))

    expect(dialogue.setMode).toHaveBeenCalledWith("dialogue")
    expect(dialogue.importFromText).toHaveBeenCalledWith("Skippy: Hello.")
  })

  it("renders dialogue rows and mapping warnings", async () => {
    const user = userEvent.setup()
    const dialogue = dialogueController({
      blocks: [dialogueBlock()],
      mode: "dialogue",
      segmentBuild: {
        error: "Map voices for labeled speakers before generating: Skippy.",
        missingSpeakerLabels: ["Skippy"],
        segments: [],
        text: "",
      },
      speakerLabels: ["Skippy"],
      speakerMappings: [{ speakerLabel: "Skippy", voiceId: null }],
    })
    renderPanel({
      assignmentError: dialogue.segmentBuild.error,
      dialogue,
      selectedText: "ignored in dialogue mode",
    })

    expect(screen.getByRole("region", { name: "Dialogue Rows" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Speaker Voice Mapping" })).toBeInTheDocument()
    const alerts = screen.getAllByRole("alert")
    expect(alerts[0]).toHaveTextContent("Dialogue Rows Need Attention")
    expect(alerts[0]).toHaveTextContent("Map voices for labeled speakers before generating: Skippy.")
    expect(alerts[1]).toHaveTextContent("Map Skippy to a voice before generating.")
    const missingMappingRow = alerts[1].closest("article")
    expect(missingMappingRow).toHaveClass(
      "dialogue-speaker-row",
      speakerColorClassName("Skippy"),
      "border-destructive/50"
    )

    await user.clear(screen.getByLabelText("Speaker"))
    await user.type(screen.getByLabelText("Speaker"), "Narrator")
    await user.clear(screen.getByLabelText("Dialogue"))
    await user.type(screen.getByLabelText("Dialogue"), "Updated line.")
    await user.click(screen.getByRole("checkbox", { name: "Select Dialogue Row 1" }))

    expect(dialogue.updateBlockSpeakerLabel).toHaveBeenCalled()
    expect(dialogue.updateBlockText).toHaveBeenCalled()
    expect(dialogue.toggleBlockSelection).toHaveBeenCalledWith("dialogue-block-1", true)
  })

  it("opens tuning controls for imported dialogue rows before generation", async () => {
    const user = userEvent.setup()
    const dialogue = dialogueController({
      blocks: [dialogueBlock()],
      mode: "dialogue",
      segmentBuild: {
        error: null,
        missingSpeakerLabels: [],
        segments: [
          {
            assignmentId: "dialogue-block-1",
            assignmentKind: "assigned",
            clientSegmentId: "dialogue-block-1",
            end: "Hello world.".length,
            start: 0,
            text: "Hello world.",
            voiceId: "skippy",
            voiceName: "Skippy Voice",
          },
        ],
        text: "Hello world.",
      },
      speakerLabels: ["Skippy"],
      speakerMappings: [{ speakerLabel: "Skippy", voiceId: "skippy" }],
    })
    renderPanel({
      dialogue,
      providerTuningControls: dialogueTuningControls,
      tuning: { speed: 1, stability: 0.5 },
    })

    await user.click(screen.getByRole("button", { name: "Tune Dialogue Row 1" }))

    expect(screen.getByRole("heading", { name: "Dialogue Row 1 Tuning" })).toBeInTheDocument()
    expect(screen.getByText("Adjust settings for this dialogue row before generation.")).toBeInTheDocument()
    const rowActions = screen.getByRole("button", { name: "Open Dialogue Row 1 Tuning Actions" })
    await user.click(rowActions)
    expect(screen.getByRole("menuitem", { name: "Apply Tuning To Same Voice Rows" })).toBeDisabled()
    await user.click(rowActions)
    expect(screen.getByRole("slider", { name: "Stability" })).toHaveValue("0.5")

    fireEvent.change(screen.getByRole("slider", { name: "Stability" }), { target: { value: "0.34" } })

    expect(dialogue.updateBlockVoiceSettings).toHaveBeenCalledWith("dialogue-block-1", {
      speed: 1,
      stability: 0.34,
    })
  })

  it("applies dialogue row tuning to rows that resolve to the same voice", async () => {
    const user = userEvent.setup()
    const dialogue = dialogueController({
      applyBlockVoiceSettingsToMatchingVoice: vi.fn(),
      blocks: [
        dialogueBlock({ voiceSettings: { stability: 0.34 } }),
        dialogueBlock({ id: "dialogue-block-2", speakerLabel: "Skippy", text: "Another line." }),
      ],
      mode: "dialogue",
      segmentBuild: {
        error: null,
        missingSpeakerLabels: [],
        segments: [],
        text: "Hello world.\nAnother line.",
      },
      speakerLabels: ["Skippy"],
      speakerMappings: [{ speakerLabel: "Skippy", voiceId: "skippy" }],
    })
    renderPanel({
      dialogue,
      providerTuningControls: dialogueTuningControls,
      tuning: { stability: 0.5 },
    })

    await user.click(screen.getByRole("button", { name: "Tune Dialogue Row 1" }))
    await user.click(screen.getByRole("button", { name: "Open Dialogue Row 1 Tuning Actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Apply Tuning To Same Voice Rows" }))

    expect(dialogue.applyBlockVoiceSettingsToMatchingVoice).toHaveBeenCalledWith("dialogue-block-1", {
      stability: 0.34,
    })
  })

  it("marks dialogue rows with explicit tuning", () => {
    const dialogue = dialogueController({
      blocks: [dialogueBlock({ voiceSettings: { stability: 0.34 } })],
      mode: "dialogue",
      segmentBuild: {
        error: null,
        missingSpeakerLabels: [],
        segments: [
          {
            assignmentId: "dialogue-block-1",
            assignmentKind: "assigned",
            clientSegmentId: "dialogue-block-1",
            end: "Hello world.".length,
            start: 0,
            text: "Hello world.",
            voiceId: "skippy",
            voiceName: "Skippy Voice",
            voiceSettings: { stability: 0.34 },
          },
        ],
        text: "Hello world.",
      },
      speakerLabels: ["Skippy"],
      speakerMappings: [{ speakerLabel: "Skippy", voiceId: "skippy" }],
    })

    renderPanel({ dialogue, providerTuningControls: dialogueTuningControls })

    expect(screen.getByText("Custom Tuning")).toBeInTheDocument()
  })

  it("does not show range assignment stale warnings in dialogue mode", () => {
    const dialogue = dialogueController({
      blocks: [dialogueBlock({ voiceId: "skippy", voiceName: "Skippy Voice" })],
      mode: "dialogue",
      segmentBuild: {
        error: null,
        missingSpeakerLabels: [],
        segments: [
          {
            assignmentId: "dialogue-block-1",
            assignmentKind: "assigned",
            clientSegmentId: "dialogue-block-1",
            end: "Hello world.".length,
            start: 0,
            text: "Hello world.",
            voiceId: "skippy",
            voiceName: "Skippy Voice",
          },
        ],
        text: "Hello world.",
      },
      speakerLabels: ["Skippy"],
      speakerMappings: [{ speakerLabel: "Skippy", voiceId: "skippy" }],
    })

    renderPanel({ assignments: [assignment], assignmentsStale: true, dialogue })

    expect(screen.queryByText("Voice Assignments Need Attention")).not.toBeInTheDocument()
    expect(screen.queryByText(/Some script edits could not be matched/)).not.toBeInTheDocument()
  })

  it("prevents Enter in a dialogue row speaker field from submitting generation", () => {
    const dialogue = dialogueController({
      blocks: [dialogueBlock()],
      mode: "dialogue",
      segmentBuild: {
        error: null,
        missingSpeakerLabels: [],
        segments: [
          {
            assignmentId: "dialogue-block-1",
            assignmentKind: "assigned",
            clientSegmentId: "dialogue-block-1",
            end: "Hello world.".length,
            start: 0,
            text: "Hello world.",
            voiceId: "skippy",
            voiceName: "Skippy Voice",
          },
        ],
        text: "Hello world.",
      },
      speakerLabels: ["Skippy"],
      speakerMappings: [{ speakerLabel: "Skippy", voiceId: "skippy" }],
    })
    const props = renderPanel({ dialogue })

    const speakerField = screen.getByLabelText("Speaker")
    expect(fireEvent.keyDown(speakerField, { key: "Enter" })).toBe(false)

    expect(props.onGenerate).not.toHaveBeenCalled()
  })

  it("assigns selected dialogue rows through the voice picker", async () => {
    const user = userEvent.setup()
    const dialogue = dialogueController({
      blocks: [dialogueBlock()],
      mode: "dialogue",
      selectedBlockCount: 1,
      selectedBlockIds: new Set(["dialogue-block-1"]),
      speakerLabels: ["Skippy"],
      speakerMappings: [{ speakerLabel: "Skippy", voiceId: null }],
    })
    renderPanel({ dialogue })

    await user.click(screen.getByRole("button", { name: "Assign Selected" }))
    await user.click(screen.getByRole("button", { name: "Skippy Voice" }))

    expect(dialogue.assignSelectedBlocks).toHaveBeenCalledWith(skippy)
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
