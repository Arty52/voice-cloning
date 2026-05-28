import { ChevronDown } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type MenuSelectOption = {
  label: string
  value: string
}

type MenuSelectProps = {
  ariaLabel: string
  className?: string
  disabled?: boolean
  onChange: (value: string) => void
  options: MenuSelectOption[]
  value: string
}

export function MenuSelect({ ariaLabel, className, disabled = false, onChange, options, value }: MenuSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

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
    <div className={cn("relative", className)} ref={rootRef}>
      <Button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${ariaLabel}: ${selectedOption?.label ?? "None"}`}
        className="h-9 min-w-28 justify-between border-input bg-background px-3 font-normal"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        ref={buttonRef}
        type="button"
        variant="secondary"
      >
        <span>{selectedOption?.label ?? "None"}</span>
        <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
      </Button>
      {isOpen ? (
        <div
          className="absolute right-0 top-full z-20 mt-2 min-w-full rounded-md border border-border bg-card p-1 shadow-xl"
          id={menuId}
          role="menu"
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
                  setIsOpen(false)
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
      ) : null}
    </div>
  )
}
