import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"

describe("Button", () => {
  it("renders a native button by default", () => {
    render(<Button>Save</Button>)

    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toHaveAttribute("type", "button")
  })

  it("renders a semantic child link with button styling", () => {
    render(
      <Button asChild size="icon" variant="ghost">
        <a aria-label="View Source On GitHub" href="https://github.com/Arty52/voice-cloning">
          GitHub
        </a>
      </Button>
    )

    const link = screen.getByRole("link", { name: "View Source On GitHub" })
    expect(link).toHaveAttribute("href", "https://github.com/Arty52/voice-cloning")
    expect(link).not.toHaveAttribute("type")
    expect(link).toHaveClass("size-10")
  })
})
