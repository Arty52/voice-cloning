import { MoreHorizontal } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const ACTION_MENU_TOOLTIP_DELAY_MS = 700

type ActionMenuBaseItem = {
  description?: string
  destructive?: boolean
  disabled?: boolean
  icon?: ReactNode
  label: string
}

type ActionMenuButtonItem = ActionMenuBaseItem & {
  download?: never
  href?: never
  onSelect: () => void
}

type ActionMenuLinkItem = ActionMenuBaseItem & {
  download?: string
  href: string
  onSelect?: never
}

export type ActionMenuItem = ActionMenuButtonItem | ActionMenuLinkItem

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
          {items.map((item) => {
            const itemClassName = cn(
              "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm outline-none transition hover:bg-muted focus-visible:bg-muted",
              item.disabled ? "cursor-not-allowed opacity-50" : null,
              item.destructive ? "text-destructive" : "text-foreground"
            )
            const menuItem = renderActionMenuEntry(item, itemClassName, () => setIsOpen(false))

            if (item.description) {
              return (
                <Tooltip delayDuration={ACTION_MENU_TOOLTIP_DELAY_MS} key={item.label}>
                  <TooltipTrigger asChild>{menuItem}</TooltipTrigger>
                  <TooltipContent className="max-w-72" side="left" sideOffset={8}>
                    {item.description}
                  </TooltipContent>
                </Tooltip>
              )
            }

            return (
              menuItem
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function renderActionMenuEntry(item: ActionMenuItem, itemClassName: string, onClose: () => void) {
  const isTooltipDisabledItem = Boolean(item.disabled && item.description)

  if (item.href && !item.disabled) {
    return (
      <a
        className={itemClassName}
        download={item.download}
        href={item.href}
        key={item.label}
        onClick={onClose}
        role="menuitem"
      >
        {item.icon}
        <span>{item.label}</span>
      </a>
    )
  }

  return (
    <button
      aria-disabled={isTooltipDisabledItem ? true : undefined}
      className={itemClassName}
      disabled={item.disabled && !item.description}
      key={item.label}
      onClick={() => {
        if (item.disabled) {
          return
        }
        onClose()
        item.onSelect?.()
      }}
      role="menuitem"
      type="button"
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  )
}
