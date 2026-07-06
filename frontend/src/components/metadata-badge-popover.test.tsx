import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
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

  it("keeps focusable popover content reachable from the keyboard", async () => {
    const user = userEvent.setup()
    render(
      <MetadataBadgePopover ariaLabel="Open Generation Metadata" label="Metadata">
        <button type="button">Review Segment Details</button>
      </MetadataBadgePopover>
    )

    await user.tab()
    expect(screen.getByRole("button", { name: "Open Generation Metadata" })).toHaveFocus()
    expect(await screen.findByRole("button", { name: "Review Segment Details" })).toBeInTheDocument()

    await user.tab()

    expect(screen.getByRole("button", { name: "Review Segment Details" })).toHaveFocus()
  })

  it("toggles the popover on click", async () => {
    renderMetadataBadgePopover()

    const trigger = screen.getByRole("button", { name: "Open Generation Metadata" })
    fireEvent.click(trigger)

    expect(await screen.findByText("Generated with 3 Segments")).toBeInTheDocument()

    fireEvent.click(trigger)

    await waitFor(() => {
      expect(screen.queryByText("Generated with 3 Segments")).not.toBeInTheDocument()
    })
  })

  it("keeps a hover-opened popover open on the following click", async () => {
    const user = userEvent.setup()
    renderMetadataBadgePopover()

    const trigger = screen.getByRole("button", { name: "Open Generation Metadata" })
    await user.click(trigger)

    expect(await screen.findByText("Generated with 3 Segments")).toBeInTheDocument()

    await user.click(trigger)

    await waitFor(() => {
      expect(screen.queryByText("Generated with 3 Segments")).not.toBeInTheDocument()
    })
  })

  it("supports caller-controlled open state", async () => {
    const user = userEvent.setup()
    render(<ControlledMetadataBadgePopover />)

    const trigger = screen.getByRole("button", { name: "Open Controlled Metadata" })
    expect(screen.queryByText("Controlled Details")).not.toBeInTheDocument()

    fireEvent.mouseEnter(trigger)

    expect(await screen.findByText("Controlled Details")).toBeInTheDocument()

    await user.click(trigger)

    await waitFor(() => {
      expect(screen.queryByText("Controlled Details")).not.toBeInTheDocument()
    })
  })
})

function ControlledMetadataBadgePopover() {
  const [open, setOpen] = useState(false)

  return (
    <MetadataBadgePopover
      ariaLabel="Open Controlled Metadata"
      label="Controlled"
      onOpenChange={setOpen}
      open={open}
    >
      <div>Controlled Details</div>
    </MetadataBadgePopover>
  )
}
