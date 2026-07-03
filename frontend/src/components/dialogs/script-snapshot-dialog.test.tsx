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

  it("keeps snapshot details scrollable inside the dialog", () => {
    render(<ScriptSnapshotDialog onOpenChange={vi.fn()} open snapshot={dialogueSnapshot} />)

    const dialog = screen.getByRole("dialog", { name: "Generated Script Snapshot" })
    expect(dialog).toHaveClass("max-h-[min(90vh,720px)]", "grid-rows-[auto_minmax(0,1fr)_auto]", "overflow-hidden")
    expect(within(dialog).getByRole("region", { name: "Script Snapshot Details" })).toHaveClass("min-h-0")
  })

  it("keeps footer metadata left of the close action on desktop", () => {
    render(<ScriptSnapshotDialog onOpenChange={vi.fn()} open snapshot={dialogueSnapshot} />)

    const dialog = screen.getByRole("dialog", { name: "Generated Script Snapshot" })
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')
    expect(footer).not.toBeNull()

    const footerCloseButton = within(footer as HTMLElement).getByRole("button", { name: "Close" })
    expect(footerCloseButton).toHaveClass("sm:order-2")
    expect(within(footer as HTMLElement).getByText("Saved With Generated Audio").parentElement).toHaveClass(
      "sm:order-1",
      "sm:mr-auto"
    )
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
