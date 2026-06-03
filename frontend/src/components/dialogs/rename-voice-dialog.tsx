import { type FormEvent, useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/loading"
import type { VoiceAsset } from "@/types"

type RenameVoiceDialogProps = {
  error: string | null
  isSaving: boolean
  name: string
  onCancel: () => void
  onNameChange: (name: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  voice: VoiceAsset | null
}

export function RenameVoiceDialog({
  error,
  isSaving,
  name,
  onCancel,
  onNameChange,
  onSubmit,
  voice,
}: RenameVoiceDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (!voice) {
      return
    }

    inputRef.current?.focus()
    inputRef.current?.select()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancelRef.current()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [voice])

  if (!voice) {
    return null
  }

  const titleId = "rename-voice-dialog-title"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
        ref={dialogRef}
        role="dialog"
      >
        <h2 className="text-lg font-medium" id={titleId}>
          Rename Voice
        </h2>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <label className="block space-y-2 text-sm font-medium" htmlFor="rename-voice-name">
            <span>Voice Name</span>
            <Input
              aria-describedby={error ? "rename-voice-error" : undefined}
              aria-invalid={Boolean(error)}
              disabled={isSaving}
              id="rename-voice-name"
              onChange={(event) => onNameChange(event.target.value)}
              ref={inputRef}
              required
              value={name}
            />
          </label>
          {error ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
              id="rename-voice-error"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={isSaving} onClick={onCancel} type="button" variant="secondary">
              Cancel
            </Button>
            <Button disabled={isSaving || name.trim().length === 0} type="submit">
              {isSaving ? <Loading aria-hidden="true" size="sm" /> : null}
              Rename
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
