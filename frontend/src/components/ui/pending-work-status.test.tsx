import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Badge } from "@/components/ui/badge"
import { PendingWorkStatus } from "@/components/ui/pending-work-status"

describe("PendingWorkStatus", () => {
  it("renders an accessible live status with title and description", () => {
    render(
      <PendingWorkStatus
        aria-label="Speech generation status"
        description="Building the latest audio result."
        title="Generating Speech"
      />
    )

    const status = screen.getByRole("status", { name: "Speech generation status" })
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status).toHaveTextContent("Generating Speech")
    expect(status).toHaveTextContent("Building the latest audio result.")
    expect(within(status).queryByRole("status")).not.toBeInTheDocument()
  })

  it("renders status label, metadata, and child progress content", () => {
    render(
      <PendingWorkStatus
        meta={<Badge variant="secondary">2 Segments</Badge>}
        statusLabel="Running"
        title="Generating Dialogue"
      >
        <div>Segment 1: Narrator</div>
      </PendingWorkStatus>
    )

    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Running")
    expect(status).toHaveTextContent("2 Segments")
    expect(status).toHaveTextContent("Segment 1: Narrator")
  })

  it("forwards HTML attributes and renders the shared shine element", () => {
    render(
      <PendingWorkStatus className="custom-status" data-testid="pending-status" title="Inspecting Source" />
    )

    const status = screen.getByTestId("pending-status")
    expect(status).toHaveClass("pending-work-status")
    expect(status).toHaveClass("custom-status")
    expect(status.querySelector(".pending-work-status__shine")).toBeInTheDocument()
  })
})
