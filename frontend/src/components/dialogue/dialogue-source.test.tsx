import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef, useState } from "react"
import { describe, expect, it } from "vitest"
import { DialogueSource } from "./dialogue-source"

function Workspace() {
  const [expanded, setExpanded] = useState(true)
  const [hasRows, setHasRows] = useState(false)
  const [text, setText] = useState("Speaker: Original text")
  const ref = useRef<HTMLTextAreaElement>(null)
  return <DialogueSource expanded={expanded} onExpandedChange={setExpanded} hasRows={hasRows} disabled={false} text={text} textRef={ref} onTextChange={setText} onImport={() => { setHasRows(true); setExpanded(false) }} />
}

describe("dialogue source", () => {
  it("collapses after import, keeps focus outside hidden content, and reopens the original source", async () => {
    const user = userEvent.setup()
    render(<Workspace />)
    await user.click(screen.getByRole("button", { name: "Import Dialogue" }))
    const toggle = screen.getByRole("button", { name: "Show Script Source" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(toggle).toHaveFocus()
    expect(screen.queryByRole("textbox", { name: "Script Source" })).not.toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByRole("textbox", { name: "Script Source" })).toHaveValue("Speaker: Original text")
    expect(screen.getByRole("button", { name: "Reimport Dialogue" })).toBeEnabled()
  })
  it("supports keyboard collapse and reopening", async () => {
    const user = userEvent.setup()
    render(<Workspace />)
    screen.getByRole("button", { name: "Hide Script Source" }).focus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("button", { name: "Show Script Source" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("textbox", { name: "Script Source" })).toBeVisible()
  })
})
