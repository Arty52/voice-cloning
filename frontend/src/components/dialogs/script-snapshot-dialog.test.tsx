import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ScriptSnapshotDialog } from "@/components/dialogs/script-snapshot-dialog"
import type { GeneratedAudioScriptSnapshot } from "@/types"

describe("ScriptSnapshotDialog", () => {
  it("renders script text, dialogue rows, and speaker mappings accessibly", () => {
    render(<ScriptSnapshotDialog onOpenChange={vi.fn()} open snapshot={dialogueSnapshot} />)

    const dialog = screen.getByRole("dialog", { name: "Generated Script Snapshot" })
    expect(within(dialog).getByText("Dialogue Rows Snapshot")).toBeInTheDocument()
    expect(within(dialog).getByText("Hello. Hi.")).toBeInTheDocument()
    expect(within(dialog).getAllByText("Villain")).toHaveLength(2)
    expect(within(dialog).getByText("Villain: villain")).toBeInTheDocument()
    expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(2)
  })

  it("does not render without a snapshot", () => {
    render(<ScriptSnapshotDialog onOpenChange={vi.fn()} open snapshot={null} />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})

const dialogueSnapshot: GeneratedAudioScriptSnapshot = {
  version: 1,
  mode: "dialogue",
  text: "Hello.\nHi.",
  sourceVoiceId: "narrator",
  assignments: [],
  dialogueBlocks: [
    {
      id: "dialogue-block-1",
      speakerLabel: "Narrator",
      text: "Hello.",
      voiceId: null,
      voiceName: null,
      voiceSettings: null,
    },
    {
      id: "dialogue-block-2",
      speakerLabel: "Villain",
      text: "Hi.",
      voiceId: "villain",
      voiceName: "Villain",
      voiceSettings: { stability: 0.42 },
    },
  ],
  speakerMappings: [
    { speakerLabel: "Narrator", voiceId: "narrator" },
    { speakerLabel: "Villain", voiceId: "villain" },
  ],
  segmentGapMs: null,
}
