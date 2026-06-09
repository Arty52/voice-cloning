import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AppHeader } from "@/components/app-header"
import { TooltipProvider } from "@/components/ui/tooltip"

function renderAppHeader() {
  return render(
    <TooltipProvider>
      <AppHeader />
    </TooltipProvider>
  )
}

describe("AppHeader", () => {
  it("links to the public GitHub repository", async () => {
    const user = userEvent.setup()
    renderAppHeader()

    const repositoryLink = screen.getByRole("link", { name: "View Source On GitHub" })
    expect(repositoryLink).toHaveAttribute("href", "https://github.com/Arty52/voice-cloning")
    expect(repositoryLink).toHaveAttribute("target", "_blank")
    expect(repositoryLink).toHaveAttribute("rel", "noreferrer")
    expect(screen.queryByText("View Source On GitHub")).not.toBeInTheDocument()

    await user.hover(repositoryLink)

    const tooltip = await screen.findByRole("tooltip")
    expect(within(tooltip).getByText("View Source On GitHub")).toBeInTheDocument()
  })

  it("opens the repository tooltip on keyboard focus", async () => {
    const user = userEvent.setup()
    renderAppHeader()

    await user.tab()

    const repositoryLink = screen.getByRole("link", { name: "View Source On GitHub" })
    expect(repositoryLink).toHaveFocus()
    const tooltip = await screen.findByRole("tooltip")
    expect(within(tooltip).getByText("View Source On GitHub")).toBeInTheDocument()
  })
})
