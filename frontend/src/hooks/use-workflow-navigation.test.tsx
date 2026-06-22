import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { useWorkflowNavigation } from "@/hooks/use-workflow-navigation"

describe("useWorkflowNavigation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/")
  })

  it("defaults invalid or empty hashes to Voices", () => {
    window.history.replaceState(null, "", "/#not-real")

    render(<NavigationProbe />)

    expect(screen.getByTestId("active-section")).toHaveTextContent("voices")
  })

  it("tracks hash changes from browser navigation", () => {
    window.history.replaceState(null, "", "/#provider")

    render(<NavigationProbe />)

    expect(screen.getByTestId("active-section")).toHaveTextContent("provider")

    act(() => {
      window.history.pushState(null, "", "/#archive")
      window.dispatchEvent(new Event("hashchange"))
    })

    expect(screen.getByTestId("active-section")).toHaveTextContent("archive")
  })

  it("navigates to a section and updates the location hash", async () => {
    const user = userEvent.setup()
    render(<NavigationProbe />)

    await user.click(screen.getByRole("button", { name: "Generate" }))

    expect(screen.getByTestId("active-section")).toHaveTextContent("generate")
    expect(window.location.hash).toBe("#generate")
  })
})

function NavigationProbe() {
  const navigation = useWorkflowNavigation()

  return (
    <div>
      <div data-testid="active-section">{navigation.activeSectionId}</div>
      <button onClick={() => navigation.navigateToSection("generate")} type="button">
        Generate
      </button>
    </div>
  )
}
