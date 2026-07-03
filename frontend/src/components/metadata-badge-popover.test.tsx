import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { MetadataBadgePopover } from "@/components/metadata-badge-popover"

function renderMetadataBadgePopover() {
  return render(
    <MetadataBadgePopover ariaLabel="Open Generation Metadata" label="Metadata" variant="accent">
      <div>Generated with 3 Segments</div>
    </MetadataBadgePopover>
  )
}

describe("MetadataBadgePopover", () => {
  it("renders an accessible badge button without showing popover content initially", () => {
    renderMetadataBadgePopover()

    const trigger = screen.getByRole("button", { name: "Open Generation Metadata" })
    expect(trigger).toHaveTextContent("Metadata")
    expect(screen.queryByText("Generated with 3 Segments")).not.toBeInTheDocument()
  })

  it("opens the popover on hover", async () => {
    const user = userEvent.setup()
    renderMetadataBadgePopover()

    await user.hover(screen.getByRole("button", { name: "Open Generation Metadata" }))

    expect(await screen.findByText("Generated with 3 Segments")).toBeInTheDocument()
  })

  it("opens the popover on keyboard focus", async () => {
    const user = userEvent.setup()
    renderMetadataBadgePopover()

    await user.tab()

    expect(screen.getByRole("button", { name: "Open Generation Metadata" })).toHaveFocus()
    expect(await screen.findByText("Generated with 3 Segments")).toBeInTheDocument()
  })

  it("opens the popover on click", async () => {
    const user = userEvent.setup()
    renderMetadataBadgePopover()

    await user.click(screen.getByRole("button", { name: "Open Generation Metadata" }))

    expect(await screen.findByText("Generated with 3 Segments")).toBeInTheDocument()
  })
})
