import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { PanelLeft } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

const SIDEBAR_WIDTH = "17rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"

type SidebarContextValue = {
  isMobile: boolean
  open: boolean
  openMobile: boolean
  setOpen: (open: boolean) => void
  setOpenMobile: (open: boolean) => void
  toggleSidebar: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }
  return context
}

export function SidebarProvider({
  children,
  className,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  style,
  ...props
}: ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const [openMobile, setOpenMobile] = useState(false)
  const open = openProp ?? internalOpen

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (onOpenChange) {
        onOpenChange(nextOpen)
        return
      }
      setInternalOpen(nextOpen)
    },
    [onOpenChange]
  )

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current)
      return
    }
    setOpen(!open)
  }, [isMobile, open, setOpen])

  const contextValue = useMemo(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      toggleSidebar,
    }),
    [isMobile, open, openMobile, setOpen, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={cn("flex min-h-svh w-full bg-background text-foreground", className)}
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
            ...style,
          } as CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

export function Sidebar({ children, className, side = "left", ...props }: ComponentProps<"aside"> & { side?: "left" | "right" }) {
  const { isMobile, openMobile, setOpenMobile, open } = useSidebar()

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          className="w-[var(--sidebar-width-mobile)] max-w-none border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:max-w-none"
          showCloseButton={false}
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Workflow Navigation</SheetTitle>
            <SheetDescription>Navigate between Voice Clone Lab workflow sections.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-svh w-[var(--sidebar-width)] shrink-0 flex-col border-sidebar-border bg-sidebar text-sidebar-foreground md:flex",
        side === "left" ? "border-r" : "border-l",
        !open && "md:hidden",
        className
      )}
      data-side={side}
      {...props}
    >
      {children}
    </aside>
  )
}

export function SidebarInset({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("flex min-w-0 flex-1 flex-col bg-background", className)} {...props} />
}

export function SidebarTrigger({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      aria-label="Toggle Workflow Navigation"
      className={cn("shrink-0", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    >
      <PanelLeft aria-hidden="true" data-icon="inline-start" />
    </Button>
  )
}

export function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 p-4", className)} {...props} />
}

export function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 p-4", className)} {...props} />
}

export function SidebarContent({ className, ...props }: ComponentProps<typeof ScrollArea>) {
  return <ScrollArea className={cn("min-h-0 flex-1", className)} {...props} />
}

export function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-col gap-2 p-2", className)} {...props} />
}

export function SidebarGroupLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("px-2 text-xs font-medium uppercase tracking-normal text-sidebar-foreground/70", className)}
      {...props}
    />
  )
}

export function SidebarGroupContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0", className)} {...props} />
}

export function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("flex min-w-0 flex-col gap-1", className)} {...props} />
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("relative min-w-0", className)} {...props} />
}

const sidebarMenuButtonVariants = cva(
  "flex h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>svg]:shrink-0 [&>svg]:text-sidebar-foreground/70 [&>span:last-child]:truncate",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "",
        outline: "border border-sidebar-border bg-background/35",
      },
    },
  }
)

export function SidebarMenuButton({
  asChild = false,
  className,
  isActive = false,
  tooltip,
  variant,
  ...props
}: ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button"
  const button = (
    <Comp
      aria-current={isActive ? "page" : undefined}
      className={cn(sidebarMenuButtonVariants({ variant }), className)}
      data-active={isActive ? "true" : undefined}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent align="center" side="right" sideOffset={8}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export function SidebarMenuBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute right-2 top-1/2 inline-flex min-w-5 -translate-y-1/2 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground/70",
        className
      )}
      {...props}
    />
  )
}

export function SidebarSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return <Separator className={cn("bg-sidebar-border", className)} {...props} />
}
