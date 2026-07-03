import { useRef, useState, type ComponentProps, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type MetadataBadgePopoverProps = {
  ariaLabel: string
  children: ReactNode
  label: string
  variant?: ComponentProps<typeof Badge>["variant"]
}

export function MetadataBadgePopover({
  ariaLabel,
  children,
  label,
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
      <PopoverContent align="start" className="w-fit max-w-80" onOpenAutoFocus={(event) => event.preventDefault()}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
