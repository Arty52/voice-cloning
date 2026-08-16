import { Check, Pause, Play, Volume2 } from "lucide-react"
import { useId, useMemo, useState, type ReactNode } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import type { VoicePickerOption } from "@/lib/voice-ui-contracts"
import { cn } from "@/lib/utils"

type VoicePickerPreview = {
  activePreview: {
    error: string | null
    isLoading: boolean
    isPlaying: boolean
    voiceId: string
  } | null
  clearPreview: () => void
  togglePreview: (voiceId: string) => boolean
}

type VoicePickerProps = {
  description: string
  disabled: boolean
  disabledTooltip?: string | null
  onSelect: (voiceId: string) => void
  options: VoicePickerOption[]
  preview: VoicePickerPreview
  selectedVoiceId?: string
  title: string
  triggerIcon: ReactNode
  triggerLabel: string
}

/**
 * Shared Voice Studio picker composition. It preserves the existing Geist and
 * shadcn/Radix treatment while exposing semantic selection and preview actions.
 */
export function VoicePicker({
  description,
  disabled,
  disabledTooltip,
  onSelect,
  options,
  preview,
  selectedVoiceId,
  title,
  triggerIcon,
  triggerLabel,
}: VoicePickerProps) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const trigger = (
    <Button disabled={disabled} size="sm" type="button" variant="secondary">
      {triggerIcon}
      {triggerLabel}
    </Button>
  )

  function handleSelect(voiceId: string) {
    preview.clearPreview()
    onSelect(voiceId)
    setOpen(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      preview.clearPreview()
    }
    setOpen(nextOpen)
  }

  const picker = (
    <VoicePickerOptions
      onSelect={handleSelect}
      options={options}
      preview={preview}
      selectedVoiceId={selectedVoiceId}
    />
  )

  if (disabled) {
    if (!disabledTooltip) {
      return trigger
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex cursor-not-allowed rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
          >
            {trigger}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {disabledTooltip}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (isMobile) {
    return (
      <Sheet onOpenChange={handleOpenChange} open={open}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent className="max-h-[85vh]" side="bottom">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <SheetBody>{picker}</SheetBody>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader className="mb-3">
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
        {picker}
      </PopoverContent>
    </Popover>
  )
}

function VoicePickerOptions({
  onSelect,
  options,
  preview,
  selectedVoiceId,
}: Pick<VoicePickerProps, "onSelect" | "options" | "preview" | "selectedVoiceId">) {
  const [query, setQuery] = useState("")
  const searchInputId = useId()
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = useMemo(
    () =>
      options.filter((option) =>
        [option.name, option.description ?? "", ...option.metadata]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [normalizedQuery, options],
  )
  const hasScrollableVoiceList = filteredOptions.length > 5

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Field>
        <FieldLabel className="sr-only" htmlFor={searchInputId}>
          Search voices
        </FieldLabel>
        <Input
          id={searchInputId}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search voices"
          type="search"
          value={query}
        />
      </Field>
      {preview.activePreview?.error ? (
        <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
          <AlertDescription>{preview.activePreview.error}</AlertDescription>
        </Alert>
      ) : null}
      {filteredOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          No voices match this search.
        </p>
      ) : (
        <ScrollArea
          aria-label="Voice List"
          className={cn("pr-3", hasScrollableVoiceList ? "h-72" : "max-h-72")}
          role="region"
        >
          <div className="flex flex-col gap-2">
            {filteredOptions.map((option) => (
              <VoicePickerOptionRow
                key={option.id}
                onSelect={onSelect}
                option={option}
                preview={preview}
                selected={option.id === selectedVoiceId}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

function VoicePickerOptionRow({
  onSelect,
  option,
  preview,
  selected,
}: {
  onSelect: (voiceId: string) => void
  option: VoicePickerOption
  preview: VoicePickerPreview
  selected: boolean
}) {
  const isActive = preview.activePreview?.voiceId === option.id
  const previewLabel = isActive && preview.activePreview?.isPlaying
    ? `Pause preview for ${option.name}`
    : `Preview ${option.name}`
  const previewUnavailable = option.preview === null

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-transparent p-1",
        selected && "border-border bg-secondary/70",
      )}
    >
      <Button
        aria-pressed={selected}
        className="h-auto min-h-10 min-w-0 flex-1 justify-start whitespace-normal px-2 py-2 text-left"
        onClick={() => onSelect(option.id)}
        type="button"
        variant="ghost"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-foreground">{option.name}</span>
          {option.description || option.metadata.length > 0 ? (
            <span aria-hidden="true" className="truncate text-xs font-normal text-muted-foreground">
              {[option.description, ...option.metadata].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </span>
        {selected ? <Check aria-label="Selected" data-icon="inline-end" /> : null}
      </Button>
      <Button
        aria-label={previewUnavailable ? `Preview unavailable for ${option.name}` : previewLabel}
        disabled={previewUnavailable}
        onClick={() => preview.togglePreview(option.id)}
        size="icon"
        title={previewUnavailable ? "Preview unavailable" : previewLabel}
        type="button"
        variant="ghost"
      >
        {preview.activePreview?.isLoading && isActive ? (
          <Volume2 aria-hidden="true" />
        ) : isActive && preview.activePreview?.isPlaying ? (
          <Pause aria-hidden="true" />
        ) : (
          <Play aria-hidden="true" />
        )}
      </Button>
    </div>
  )
}
