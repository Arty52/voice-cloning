import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, describe, expect, it, vi } from "vitest"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => false)
  HTMLElement.prototype.releasePointerCapture ??= vi.fn()
  HTMLElement.prototype.scrollIntoView ??= vi.fn()
  HTMLElement.prototype.setPointerCapture ??= vi.fn()
})

describe("Select", () => {
  it("renders grouped options and reports value changes", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <Select defaultValue="skippy" onValueChange={onValueChange}>
        <SelectTrigger aria-label="Source Voice">
          <SelectValue placeholder="Choose a voice" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Primary Voices</SelectLabel>
            <SelectItem value="skippy">Skippy</SelectItem>
            <SelectItem value="court">Court</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )

    const trigger = screen.getByRole("combobox", { name: "Source Voice" })

    expect(trigger.className).toContain("cursor-pointer")
    expect(trigger.className).toContain("hover:border-ring/60")
    expect(trigger.className).toContain("data-[state=open]:border-ring/70")

    await user.click(trigger)

    expect(screen.getByText("Primary Voices")).toBeInTheDocument()

    const courtOption = screen.getByRole("option", { name: "Court" })

    expect(courtOption.className).toContain("cursor-pointer")
    expect(courtOption.className).toContain("hover:bg-muted")
    expect(courtOption.className).toContain("data-[highlighted]:bg-muted")

    await user.click(courtOption)

    expect(onValueChange).toHaveBeenCalledWith("court")
  })

  it("supports disabled triggers", () => {
    render(
      <Select disabled value="skippy">
        <SelectTrigger aria-label="Source Voice">
          <SelectValue placeholder="Choose a voice" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="skippy">Skippy</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )

    expect(screen.getByRole("combobox", { name: "Source Voice" })).toBeDisabled()
  })
})
