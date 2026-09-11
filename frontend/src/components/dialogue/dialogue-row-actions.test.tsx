import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DialogueRowActions, type DialogueRowActionsProps } from "./dialogue-row-actions"

function setup(overrides: Partial<DialogueRowActionsProps> = {}) {
  const onRegenerate = vi.fn()
  const props: DialogueRowActionsProps = { id: "row-1", index: 0, state: { label: "Up To Date", hasTake: true, previousTake: false, error: null, running: false }, canRegenerate: true, onRegenerate, ...overrides }
  render(<TooltipProvider><DialogueRowActions {...props} /></TooltipProvider>)
  return props
}

describe("dialogue row actions", () => {
  it("offers an accessible icon-only new take even when the row is current", async () => {
    const user = userEvent.setup()
    const props = setup()
    const button = screen.getByRole("button", { name: "Regenerate Dialogue Row 1" })
    expect(button).toHaveTextContent("")
    await user.click(button)
    expect(props.onRegenerate).toHaveBeenCalledExactlyOnceWith("row-1")
  })
  it("keeps generation disabled during a run", () => {
    setup({ canRegenerate: false, state: { label: "Generating", hasTake: true, previousTake: true, running: true, error: null } })
    expect(screen.getByRole("button", { name: "Regenerate Dialogue Row 1" })).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent("Generating")
  })
  it("labels unsynthesized edits as the previous take and starts playback only on click", async () => {
    const user = userEvent.setup()
    const dispatch = vi.fn()
    const activateSegment = vi.fn()
    const playback = { segmentSources: new Map([["row-1", { id: "audio", url: "/old-audio" }]]), activateSegment, controller: { snapshot: { source: null }, dispatch } } as unknown as NonNullable<DialogueRowActionsProps["playback"]>
    setup({ playback, state: { label: "Changed", hasTake: true, previousTake: true, running: false, error: null } })
    expect(dispatch).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Play Dialogue Row 1 Previous Take" }))
    expect(activateSegment).toHaveBeenCalledExactlyOnceWith("row-1")
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "play" })
  })
})
