import { useRef, useState, type ComponentProps, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type MetadataBadgePopoverProps = {
  ariaLabel: string
  children: ReactNode
  contentClassName?: string
  label: string
  onOpenChange?: (open: boolean) => void
  open?: boolean
  side?: ComponentProps<typeof PopoverContent>["side"]
  sideOffset?: ComponentProps<typeof PopoverContent>["sideOffset"]
  variant?: ComponentProps<typeof Badge>["variant"]
}

export function MetadataBadgePopover({
  ariaLabel,
  children,
  contentClassName,
  label,
  onOpenChange,
  open,
  side,
  sideOffset,
  variant = "secondary",
}: MetadataBadgePopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const hoverOpenedRef = useRef(false)
  const pointerFocusRef = useRef(false)
  const suppressFocusOpenRef = useRef(false)
  const resolvedOpen = open ?? uncontrolledOpen

  function handleOpenChange(nextOpen: boolean) {
    if (open !== undefined && open === nextOpen) {
      return
    }
    onOpenChange?.(nextOpen)
    if (open === undefined) {
      setUncontrolledOpen(nextOpen)
    }
  }

  return (
    <Popover open={resolvedOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-label={ariaLabel}
          className={cn(
            "inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
          onFocus={() => {
            if (pointerFocusRef.current || suppressFocusOpenRef.current) {
              suppressFocusOpenRef.current = false
              return
            }
            handleOpenChange(true)
          }}
          onClick={(event) => {
            if (!hoverOpenedRef.current) {
              return
            }
            event.preventDefault()
            hoverOpenedRef.current = false
            handleOpenChange(true)
          }}
          onMouseEnter={() => {
            hoverOpenedRef.current = !resolvedOpen
            handleOpenChange(true)
          }}
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
        onCloseAutoFocus={() => {
          suppressFocusOpenRef.current = true
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side={side}
        sideOffset={sideOffset}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
