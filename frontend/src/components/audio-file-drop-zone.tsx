import { Upload } from "lucide-react"
import { type DragEvent, type ReactNode, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const AUDIO_ACCEPT =
  ".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/mpeg,audio/wav,audio/x-wav,audio/aac,audio/ogg,audio/flac"
const DEFAULT_HELPER_COPY =
  "Drag an audio file here, or choose one from your computer. Supports MP3, WAV, M4A, AAC, OGG, and FLAC."

type AudioFileDropZoneProps = {
  accept?: string
  ariaLabel?: string
  chooseLabel?: string
  children?: ReactNode
  disabled?: boolean
  emptyLabel?: string
  helperCopy?: string
  id: string
  label: string
  onFileSelect: (file: File | null) => void
  selectedFileName?: string | null
  selectedLabel?: string
}

export function AudioFileDropZone({
  accept = AUDIO_ACCEPT,
  ariaLabel = "Audio Drop Zone",
  chooseLabel = "Choose Audio",
  children,
  disabled = false,
  emptyLabel = "Drop Audio Here",
  helperCopy = DEFAULT_HELPER_COPY,
  id,
  label,
  onFileSelect,
  selectedFileName = null,
  selectedLabel = "Audio Selected",
}: AudioFileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!disabled) {
      setIsDragging(true)
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) {
      return
    }
    onFileSelect(event.dataTransfer.files[0] ?? null)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id} id={labelId}>
        {label}
      </FieldLabel>
      <div
        aria-label={ariaLabel}
        aria-describedby={descriptionId}
        className={cn(
          "flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-background/60 p-4 text-center transition",
          isDragging && "border-primary bg-primary/10",
          disabled && "opacity-60"
        )}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        role="group"
      >
        <Input
          accept={accept}
          className="sr-only size-px border-0 p-0"
          disabled={disabled}
          id={id}
          onChange={(event) => {
            onFileSelect(event.currentTarget.files?.[0] ?? null)
            event.currentTarget.value = ""
          }}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
        <Upload aria-hidden="true" className="size-5 text-primary" />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{selectedFileName ? selectedLabel : emptyLabel}</span>
          <FieldDescription id={descriptionId}>{helperCopy}</FieldDescription>
        </div>
        {selectedFileName ? <Badge variant="secondary">{selectedFileName}</Badge> : null}
        <div className="flex w-full flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button disabled={disabled} onClick={() => inputRef.current?.click()} size="sm" type="button" variant="secondary">
              <Upload aria-hidden="true" data-icon="inline-start" />
              {chooseLabel}
            </Button>
            {children}
          </div>
        </div>
      </div>
    </Field>
  )
}
