import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

describe("Sidebar", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders persistent desktop navigation with an active item", () => {
    mockViewport(false)

    render(<SidebarFixture />)

    expect(screen.getByRole("complementary", { name: "Workflow Sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Voices" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByText("Workflow")).not.toHaveClass("uppercase")
    expect(screen.getByRole("main")).toHaveTextContent("Main Content")
  })

  it("opens workflow navigation in a mobile sheet", async () => {
    mockViewport(true)
    const user = userEvent.setup()

    render(<SidebarFixture />)

    expect(screen.queryByRole("dialog", { name: "Workflow Navigation" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Toggle Workflow Navigation" }))

    expect(screen.getByRole("dialog", { name: "Workflow Navigation" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Voices" })).toHaveAttribute("aria-current", "page")
  })
})

function SidebarFixture() {
  return (
    <SidebarProvider>
      <Sidebar aria-label="Workflow Sidebar">
        <SidebarHeader>
          <div>Voice Clone Lab</div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workflow</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>Voices</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <SidebarTrigger />
        <div>Main Content</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function mockViewport(isMobile: boolean) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: isMobile ? 390 : 1024,
  })
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: isMobile,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  })
}
