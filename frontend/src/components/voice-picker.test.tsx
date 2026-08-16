import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Volume2 } from "lucide-react"
import { describe, expect, it, vi } from "vitest"

import { VoicePicker } from "./voice-picker"

const preview = {
  activePreview: null,
  clearPreview: vi.fn(),
  togglePreview: vi.fn(() => true),
}

const options = [
  {
    description: null,
    id: "narrator",
    metadata: [],
    name: "Narrator",
    preview: { id: "narrator-preview", kind: "voicePreview" as const, label: "Narrator", url: "/narrator.mp3" },
  },
]

describe("VoicePicker", () => {
  it("gives each open picker search field a unique accessible id", async () => {
    const user = userEvent.setup()
    const first = render(
      <VoicePicker
        description="Select a first voice."
        disabled={false}
        onSelect={vi.fn()}
        options={options}
        preview={preview}
        title="First voice"
        triggerIcon={<Volume2 />}
        triggerLabel="Choose first voice"
      />,
    )

    await user.click(screen.getByRole("button", { name: "Choose first voice" }))
    const firstSearchId = screen.getByRole("searchbox", { name: "Search voices" }).id
    first.unmount()

    render(
      <VoicePicker
        description="Select a second voice."
        disabled={false}
        onSelect={vi.fn()}
        options={options}
        preview={preview}
        title="Second voice"
        triggerIcon={<Volume2 />}
        triggerLabel="Choose second voice"
      />,
    )
    await user.click(screen.getByRole("button", { name: "Choose second voice" }))
    const secondSearchId = screen.getByRole("searchbox", { name: "Search voices" }).id

    expect(firstSearchId).not.toBe(secondSearchId)
  })

  it("clears preview playback before closing after a selection", async () => {
    const user = userEvent.setup()
    const selection = vi.fn()
    render(
      <VoicePicker
        description="Select a voice."
        disabled={false}
        onSelect={selection}
        options={options}
        preview={preview}
        title="Voice"
        triggerIcon={<Volume2 />}
        triggerLabel="Choose voice"
      />,
    )

    await user.click(screen.getByRole("button", { name: "Choose voice" }))
    await user.click(screen.getByRole("button", { name: "Narrator" }))

    expect(preview.clearPreview).toHaveBeenCalledOnce()
    expect(selection).toHaveBeenCalledWith("narrator")
  })
})
