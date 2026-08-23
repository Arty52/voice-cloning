import { render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it } from "vitest"

import { ScrollArea } from "./scroll-area"

describe("ScrollArea", () => {
  it("exposes its viewport for controlled scrolling without replacing the shadcn primitive", () => {
    const viewportRef = createRef<HTMLDivElement>()

    render(
      <ScrollArea aria-label="Transcript Viewport" viewportRef={viewportRef}>
        <p>Transcript content</p>
      </ScrollArea>,
    )

    expect(screen.getByRole("generic", { name: "Transcript Viewport" })).toBeVisible()
    expect(viewportRef.current).toHaveAttribute("data-radix-scroll-area-viewport")
    expect(viewportRef.current).toContainElement(screen.getByText("Transcript content"))
  })
})
