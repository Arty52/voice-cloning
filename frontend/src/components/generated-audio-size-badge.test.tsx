import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { GeneratedAudioSizeBadge } from "@/components/generated-audio-size-badge"
import { TooltipProvider } from "@/components/ui/tooltip"

function renderGeneratedAudioSizeBadge() {
  return render(
    <TooltipProvider>
      <GeneratedAudioSizeBadge sizeBytes={898_656} />
    </TooltipProvider>
  )
}

describe("GeneratedAudioSizeBadge", () => {
  it("shows the compact size while keeping exact bytes in the tooltip", async () => {
    const user = userEvent.setup()
    renderGeneratedAudioSizeBadge()

    const trigger = screen.getByLabelText("Generated Audio Size 878 KB; Exact Size 898,656 bytes")
    expect(trigger).toHaveTextContent("878 KB")
    expect(screen.queryByText("898,656 bytes")).not.toBeInTheDocument()

    await user.hover(trigger)

    const tooltip = await screen.findByRole("tooltip")
    expect(within(tooltip).getByText("Exact Size")).toBeInTheDocument()
    expect(within(tooltip).getByText("898,656 bytes")).toBeInTheDocument()
  })

  it("opens the exact size tooltip on keyboard focus", async () => {
    const user = userEvent.setup()
    renderGeneratedAudioSizeBadge()

    await user.tab()

    expect(screen.getByLabelText("Generated Audio Size 878 KB; Exact Size 898,656 bytes")).toHaveFocus()
    const tooltip = await screen.findByRole("tooltip")
    expect(within(tooltip).getByText("898,656 bytes")).toBeInTheDocument()
  })
})
