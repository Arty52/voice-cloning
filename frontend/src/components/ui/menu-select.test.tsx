import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MenuSelect } from "./menu-select"

const options = [
  { label: "Skippy", value: "skippy" },
  { label: "Court", value: "court" },
  { label: "Vegeta", value: "vegeta" },
  { label: "Rapp", value: "rapp" },
]

describe("MenuSelect", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("renders the options in a portal and selects a value", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(
      <MenuSelect ariaLabel="Voice For Segment 3" onChange={onChange} options={options} value="vegeta" />
    )

    await user.click(screen.getByRole("button", { name: "Voice For Segment 3: Vegeta" }))

    const menu = screen.getByRole("menu")
    expect(document.body).toContainElement(menu)
    expect(container).not.toContainElement(menu)

    await user.click(screen.getByRole("menuitemradio", { name: "Rapp" }))

    expect(onChange).toHaveBeenCalledWith("rapp")
  })

  it("opens above the trigger when there is not enough room below", async () => {
    const user = userEvent.setup()
    render(<MenuSelect ariaLabel="Voice For Segment 3" onChange={vi.fn()} options={options} value="vegeta" />)

    const trigger = screen.getByRole("button", { name: "Voice For Segment 3: Vegeta" })
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 724,
      height: 36,
      left: 520,
      right: 640,
      top: 688,
      width: 120,
      x: 520,
      y: 688,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function getOffsetHeight(
      this: HTMLElement
    ) {
      return this.getAttribute("role") === "menu" ? 180 : 36
    })
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function getOffsetWidth(
      this: HTMLElement
    ) {
      return this.getAttribute("role") === "menu" ? 160 : 120
    })
    vi.stubGlobal("innerHeight", 760)
    vi.stubGlobal("innerWidth", 900)

    await user.click(trigger)

    expect(screen.getByRole("menu")).toHaveStyle({
      left: "480px",
      minWidth: "120px",
      top: "500px",
    })
  })
})
