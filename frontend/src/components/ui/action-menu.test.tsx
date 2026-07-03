import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import { ActionMenu } from "@/components/ui/action-menu"
import { TooltipProvider } from "@/components/ui/tooltip"

function renderActionMenu(items: ComponentProps<typeof ActionMenu>["items"]) {
  return render(
    <TooltipProvider>
      <ActionMenu ariaLabel="Open Actions" items={items} />
    </TooltipProvider>
  )
}

describe("ActionMenu", () => {
  it("shows described item tooltips after a delay", async () => {
    const user = userEvent.setup()
    renderActionMenu([
      {
        description: "Copy this item to the configured export folder.",
        label: "Export",
        onSelect: vi.fn(),
      },
    ])

    await user.click(screen.getByRole("button", { name: "Open Actions" }))
    const action = screen.getByRole("menuitem", { name: "Export" })
    await user.hover(action)

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Copy this item to the configured export folder."
    )
  })

  it("keeps described disabled items focusable without firing their action", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderActionMenu([
      {
        description: "Select an export folder before exporting.",
        disabled: true,
        label: "Export",
        onSelect,
      },
    ])

    await user.click(screen.getByRole("button", { name: "Open Actions" }))
    const action = screen.getByRole("menuitem", { name: "Export" })

    expect(action).toHaveAttribute("aria-disabled", "true")
    expect(action).not.toBeDisabled()

    action.focus()
    expect(action).toHaveFocus()

    await user.hover(action)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Select an export folder before exporting.")

    await user.click(action)

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole("menu")).toBeInTheDocument()
  })
})
