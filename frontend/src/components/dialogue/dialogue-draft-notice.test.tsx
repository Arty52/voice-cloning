import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DialogueDraftNotice } from "./dialogue-draft-notice"

describe("dialogue draft notices", () => {
  it("offers both choices when another tab updates the draft", async () => {
    const user = userEvent.setup()
    const onKeepCurrent = vi.fn(), onUseSaved = vi.fn()
    render(<DialogueDraftNotice conflict error={null} disabled={false} onKeepCurrent={onKeepCurrent} onUseSaved={onUseSaved} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Local autosaving is paused")
    await user.click(screen.getByRole("button", { name: "Keep This Draft" }))
    await user.click(screen.getByRole("button", { name: "Use Saved Draft" }))
    expect(onKeepCurrent).toHaveBeenCalledOnce()
    expect(onUseSaved).toHaveBeenCalledOnce()
  })
  it("lets users retry local saving after storage failure", async () => {
    const user = userEvent.setup()
    const save = vi.fn()
    render(<DialogueDraftNotice conflict={false} error="Storage is full" disabled={false} onKeepCurrent={save} onUseSaved={vi.fn()} />)
    await user.click(screen.getByRole("button", { name: "Save Draft Again" }))
    expect(save).toHaveBeenCalledOnce()
  })
})
