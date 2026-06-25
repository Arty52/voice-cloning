import { Upload } from "lucide-react"
import { type DragEvent, type ReactNode, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"

type AudioFileDropZoneProps = {
  children?: ReactNode
  disabled?: boolean
  id: string
  label: string
  onFileSelect: (file: File | null) => void
  selectedFileName?: string | null
}

export function AudioFileDropZone({
  children,
  disabled = false,
  id,
  label,
  onFileSelect,
  selectedFileName = null,
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
        aria-label="Audio Drop Zone"
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
          accept={AUDIO_ACCEPT}
          className="hidden"
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
          <span className="text-sm font-medium">{selectedFileName ? "Audio Selected" : "Drop Audio Here"}</span>
          <FieldDescription id={descriptionId}>
            Drag an audio file here, or choose one from your computer. Supports MP3, WAV, M4A, AAC, OGG, and FLAC.
          </FieldDescription>
        </div>
        {selectedFileName ? <Badge variant="secondary">{selectedFileName}</Badge> : null}
        <div className="flex w-full flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button disabled={disabled} onClick={() => inputRef.current?.click()} size="sm" type="button" variant="secondary">
              <Upload aria-hidden="true" data-icon="inline-start" />
              Choose Audio
            </Button>
            {children}
          </div>
        </div>
      </div>
    </Field>
  )
}
