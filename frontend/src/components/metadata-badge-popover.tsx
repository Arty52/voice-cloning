import { useRef, useState, type ComponentProps, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type MetadataBadgePopoverProps = {
  ariaLabel: string
  children: ReactNode
  contentClassName?: string
  label: string
  side?: ComponentProps<typeof PopoverContent>["side"]
  sideOffset?: ComponentProps<typeof PopoverContent>["sideOffset"]
  variant?: ComponentProps<typeof Badge>["variant"]
}

export function MetadataBadgePopover({
  ariaLabel,
  children,
  contentClassName,
  label,
  side,
  sideOffset,
  variant = "secondary",
}: MetadataBadgePopoverProps) {
  const [open, setOpen] = useState(false)
  const pointerFocusRef = useRef(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={ariaLabel}
          className={cn(
            "inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
          onFocus={() => {
            if (pointerFocusRef.current) {
              return
            }
            setOpen(true)
          }}
          onMouseEnter={() => setOpen(true)}
          onPointerDown={() => {
            pointerFocusRef.current = true
          }}
          onPointerUp={() => {
            pointerFocusRef.current = false
          }}
          type="button"
        >
          <Badge className="pointer-events-none" variant={variant}>
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-fit max-w-80", contentClassName)}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side={side}
        sideOffset={sideOffset}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
