import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { getFocusableDialogElements } from "@/lib/focus"
import { cn } from "@/lib/utils"
import type { ConfirmationState } from "@/types"

export function ConfirmationDialog({
  confirmation,
  onCancel,
}: {
  confirmation: ConfirmationState | null
  onCancel: () => void
}) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCancelRef = useRef(onCancel)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (!confirmation) {
      return
    }

    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelButtonRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== "Tab") {
        return
      }

      const dialog = dialogRef.current
      if (!dialog) {
        return
      }
      const focusableElements = getFocusableDialogElements(dialog)
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      const previousElement = previouslyFocusedElementRef.current
      if (previousElement?.isConnected) {
        previousElement.focus()
      }
    }
  }, [confirmation])

  if (!confirmation) {
    return null
  }
  const titleId = "confirmation-dialog-title"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="text-lg font-medium" id={titleId}>
          {confirmation.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{confirmation.body}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onCancel} ref={cancelButtonRef} type="button" variant="secondary">
            Cancel
          </Button>
          <Button
            className={cn(confirmation.destructive && "border-destructive/60 text-foreground hover:bg-destructive/15")}
            onClick={() => {
              onCancel()
              void confirmation.onConfirm()
            }}
            type="button"
            variant={confirmation.destructive ? "secondary" : "primary"}
          >
            {confirmation.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
