import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { GenerationBar, type GenerationBarProps } from "./generation-bar"

function renderBar(overrides: Partial<GenerationBarProps> = {}) {
  const onRegenerateAll = vi.fn()
  const onCancel = vi.fn()
  const props = { canGenerate: true, canRegenerateAll: true, isDialogue: true, isGenerating: false, characterCount: 600, rowCount: 16, onRegenerateAll, onCancel, ...overrides }
  render(<TooltipProvider><form><GenerationBar {...props} /></form></TooltipProvider>)
  return props
}
const revision = { canRevise: true, changedIds: ["one", "two"], spacingChanged: false, linked: true, fullGenerationReason: null }

describe("generation bar", () => {
  it("starts with Generate All and exposes an icon-only Regenerate All action", async () => {
    const user = userEvent.setup()
    const props = renderBar()
    expect(screen.getByRole("button", { name: "Generate All" })).toBeEnabled()
    const icon = screen.getByRole("button", { name: "Regenerate All" })
    expect(icon).toHaveTextContent("")
    await user.click(icon)
    expect(props.onRegenerateAll).toHaveBeenCalledTimes(1)
  })
  it("shows the affected count and disables the current draft", () => {
    renderBar({ revision })
    expect(screen.getByRole("button", { name: "Generate Changes (2)" })).toBeEnabled()
  })
  it("keeps a new take available when everything is current", () => {
    renderBar({ revision: { ...revision, changedIds: [] }, canGenerate: false })
    expect(screen.getByRole("button", { name: "Generate Changes" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Regenerate All" })).toBeEnabled()
    expect(screen.getByRole("status")).toHaveTextContent("All rows are up to date.")
  })
  it("explains incompatible settings beside Generate All", () => {
    renderBar({ revision: { ...revision, canRevise: false, fullGenerationReason: "The model changed. Generate all rows." } })
    expect(screen.getByRole("button", { name: "Generate All" })).toBeEnabled()
    expect(screen.getByRole("status")).toHaveTextContent("The model changed.")
  })
  it("locks generation and keeps cancellation accessible during a run", async () => {
    const user = userEvent.setup()
    const props = renderBar({ isGenerating: true })
    expect(screen.getByRole("button", { name: "Generating..." })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Regenerate All" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })
})
