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

  it("keeps a pointer-opened controlled popover open on the following click", async () => {
    render(<ControlledMetadataBadgePopoverGroup />)

    const firstTrigger = screen.getByRole("button", { name: "Open First Metadata" })
    const secondTrigger = screen.getByRole("button", { name: "Open Second Metadata" })

    fireEvent.pointerDown(firstTrigger)

    expect(await screen.findByText("First Details")).toBeInTheDocument()

    fireEvent.pointerUp(firstTrigger)
    fireEvent.click(firstTrigger)

    expect(screen.getByText("First Details")).toBeInTheDocument()

    fireEvent.pointerDown(secondTrigger)

    expect(await screen.findByText("Second Details")).toBeInTheDocument()
    expect(screen.queryByText("First Details")).not.toBeInTheDocument()

    fireEvent.pointerUp(secondTrigger)
    fireEvent.click(secondTrigger)

    expect(screen.getByText("Second Details")).toBeInTheDocument()
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

function ControlledMetadataBadgePopoverGroup() {
  const [openId, setOpenId] = useState<string | null>(null)

  function handleOpenChange(id: string, open: boolean) {
    setOpenId((currentOpenId) => {
      if (open) {
        return id
      }
      return currentOpenId === id ? null : currentOpenId
    })
  }

  return (
    <>
      <MetadataBadgePopover
        ariaLabel="Open First Metadata"
        label="First"
        onOpenChange={(open) => handleOpenChange("first", open)}
        open={openId === "first"}
      >
        <div>First Details</div>
      </MetadataBadgePopover>
      <MetadataBadgePopover
        ariaLabel="Open Second Metadata"
        label="Second"
        onOpenChange={(open) => handleOpenChange("second", open)}
        open={openId === "second"}
      >
        <div>Second Details</div>
      </MetadataBadgePopover>
    </>
  )
}
