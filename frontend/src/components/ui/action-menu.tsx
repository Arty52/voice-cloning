import { MoreHorizontal } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ActionMenuItem = {
  destructive?: boolean
  disabled?: boolean
  icon?: ReactNode
  label: string
  onSelect: () => void
}

type ActionMenuProps = {
  ariaLabel: string
  disabled?: boolean
  items: ActionMenuItem[]
}

export function ActionMenu({ ariaLabel, disabled = false, items }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={rootRef}>
      <Button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className="shrink-0"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        ref={buttonRef}
        size="icon"
        type="button"
        variant="ghost"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </Button>
      {isOpen ? (
        <div
          className="absolute right-0 top-full z-20 mt-2 min-w-36 rounded-md border border-border bg-card p-1 shadow-xl"
          id={menuId}
          role="menu"
        >
          {items.map((item) => (
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm outline-none transition hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50",
                item.destructive ? "text-destructive" : "text-foreground"
              )}
              disabled={item.disabled}
              key={item.label}
              onClick={() => {
                setIsOpen(false)
                item.onSelect()
              }}
              role="menuitem"
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
