import { ChevronDown } from "lucide-react"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type MenuSelectOption = {
  label: string
  value: string
}

type MenuSelectProps = {
  ariaLabel: string
  buttonClassName?: string
  className?: string
  disabled?: boolean
  onChange: (value: string) => void
  options: MenuSelectOption[]
  value: string
}

type MenuPosition = {
  left: number
  minWidth: number
  top: number
}

export function MenuSelect({
  ariaLabel,
  buttonClassName,
  className,
  disabled = false,
  onChange,
  options,
  value,
}: MenuSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  function closeMenu() {
    setIsOpen(false)
    setMenuPosition(null)
  }

  function toggleMenu() {
    if (isOpen) {
      closeMenu()
      return
    }
    setMenuPosition(null)
    setIsOpen(true)
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        closeMenu()
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

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }

    function updateMenuPosition() {
      const button = buttonRef.current
      const menu = menuRef.current
      if (!button || !menu) {
        return
      }

      const buttonRect = button.getBoundingClientRect()
      const gap = 8
      const viewportPadding = 8
      const menuHeight = menu.offsetHeight
      const menuWidth = Math.max(menu.offsetWidth, buttonRect.width)
      const availableAbove = buttonRect.top - viewportPadding
      const availableBelow = window.innerHeight - buttonRect.bottom - viewportPadding
      const shouldOpenAbove = availableBelow < menuHeight + gap && availableAbove > availableBelow
      const top = shouldOpenAbove
        ? Math.max(viewportPadding, buttonRect.top - menuHeight - gap)
        : Math.max(
            viewportPadding,
            Math.min(buttonRect.bottom + gap, window.innerHeight - menuHeight - viewportPadding)
          )
      const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
      const left = Math.min(Math.max(viewportPadding, buttonRect.right - menuWidth), maxLeft)

      setMenuPosition({
        left,
        minWidth: buttonRect.width,
        top,
      })
    }

    updateMenuPosition()
    window.addEventListener("resize", updateMenuPosition)
    window.addEventListener("scroll", updateMenuPosition, true)
    return () => {
      window.removeEventListener("resize", updateMenuPosition)
      window.removeEventListener("scroll", updateMenuPosition, true)
    }
  }, [isOpen, options.length, value])

  const menu = isOpen ? (
    <div
      className="fixed z-50 rounded-md border border-border bg-card p-1 shadow-xl"
      id={menuId}
      ref={menuRef}
      role="menu"
      style={{
        left: menuPosition?.left ?? 0,
        minWidth: menuPosition?.minWidth,
        top: menuPosition?.top ?? 0,
        visibility: menuPosition ? "visible" : "hidden",
      }}
    >
      {options.map((option) => {
        const isSelected = option.value === value
        return (
          <button
            aria-checked={isSelected}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded px-2.5 py-2 text-left text-sm outline-none transition hover:bg-muted focus-visible:bg-muted",
              isSelected ? "text-foreground" : "text-muted-foreground"
            )}
            key={option.value}
            onClick={() => {
              closeMenu()
              onChange(option.value)
              buttonRef.current?.focus()
            }}
            role="menuitemradio"
            type="button"
          >
            <span>{option.label}</span>
            {isSelected ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <Button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${ariaLabel}: ${selectedOption?.label ?? "None"}`}
        className={cn("h-9 min-w-28 justify-between border-input bg-background px-3 font-normal", buttonClassName)}
        disabled={disabled}
        onClick={toggleMenu}
        ref={buttonRef}
        type="button"
        variant="secondary"
      >
        <span>{selectedOption?.label ?? "None"}</span>
        <ChevronDown aria-hidden="true" className={cn("transition-transform", isOpen && "rotate-180")} data-icon="inline-end" />
      </Button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  )
}
