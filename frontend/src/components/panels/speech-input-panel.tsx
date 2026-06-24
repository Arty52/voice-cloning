import { Pencil, RefreshCw, Sparkles, Trash2, UserPlus, X } from "lucide-react"
import { useState, type FormEvent, type ReactNode, type RefObject } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Loading } from "@/components/ui/loading"
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
import { Textarea } from "@/components/ui/textarea"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import type { VoiceTextAssignment } from "@/lib/voice-assignments"
import type { VoiceAsset } from "@/types"

type SpeechInputPanelProps = {
  assignmentError: string | null
  assignments: VoiceTextAssignment[]
  assignmentsStale: boolean
  canGenerate: boolean
  characterCount: number
  isGenerating: boolean
  onAssignVoice: (voice: VoiceAsset) => void
  onCancelGeneration: () => void
  onClearAssignments: () => void
  onEditAssignmentVoice: (assignmentId: string, voice: VoiceAsset) => void
  onGenerate: (event?: FormEvent<HTMLFormElement>) => void
  onRemoveAssignment: (assignmentId: string) => void
  onTextChange: (text: string) => void
  onTextSelectionChange: () => void
  selectedVoice: VoiceAsset | null
  selectedText: string
  text: string
  textRef: RefObject<HTMLTextAreaElement | null>
  voices: VoiceAsset[]
}

export function SpeechInputPanel({
  assignmentError,
  assignments,
  assignmentsStale,
  canGenerate,
  characterCount,
  isGenerating,
  onAssignVoice,
  onCancelGeneration,
  onClearAssignments,
  onEditAssignmentVoice,
  onGenerate,
  onRemoveAssignment,
  onTextChange,
  onTextSelectionChange,
  selectedVoice,
  selectedText,
  text,
  textRef,
  voices,
}: SpeechInputPanelProps) {
  const canAssignSelection = selectedText.trim().length > 0 && voices.length > 0 && !isGenerating

  return (
    <form
      aria-busy={isGenerating}
      className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5"
      onSubmit={onGenerate}
    >
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="speech-text">Text to Speak</FieldLabel>
          <span className="font-mono text-xs text-muted-foreground">{characterCount}/5000</span>
        </div>
        <Textarea
          className="max-h-none overflow-hidden"
          disabled={isGenerating}
          id="speech-text"
          maxLength={5000}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyUp={onTextSelectionChange}
          onMouseUp={onTextSelectionChange}
          onSelect={onTextSelectionChange}
          placeholder="Enter the text you want to synthesize."
          ref={textRef}
          rows={1}
          value={text}
        />
        <FieldDescription>
          {selectedText.trim()
            ? `Selected: ${formatExcerpt(selectedText)}`
            : "Select script text to assign a voice."}
        </FieldDescription>
      </Field>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <VoicePickerControl
          description="Choose the voice for the selected text."
          disabled={!canAssignSelection}
          onSelect={onAssignVoice}
          title="Assign Voice"
          triggerLabel="Assign Voice"
          triggerIcon={<UserPlus aria-hidden="true" />}
          voices={voices}
        />
        {assignments.length > 0 ? (
          <Button disabled={isGenerating} onClick={onClearAssignments} size="sm" variant="ghost">
            Clear Assignments
          </Button>
        ) : null}
      </div>

      {assignmentsStale || assignmentError ? (
        <Alert className="mt-4 border-destructive/40 bg-destructive/10 text-destructive" role="alert">
          <AlertTitle>Voice Assignments Need Attention</AlertTitle>
          <AlertDescription>
            {assignmentError ||
              "Some script edits could not be matched to the current voice assignments. Clear and reassign voices, or restore the matching text."}
          </AlertDescription>
        </Alert>
      ) : null}

      {assignments.length > 0 ? (
        <VoiceAssignmentsList
          assignments={assignments}
          isGenerating={isGenerating}
          onEditAssignmentVoice={onEditAssignmentVoice}
          onRemoveAssignment={onRemoveAssignment}
          stale={assignmentsStale}
          voices={voices}
        />
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Source: <span className="text-foreground">{selectedVoice?.name || "No voice selected"}</span>
          </span>
          <Button asChild size="sm" variant="ghost">
            <a href="#voices">Change Voice</a>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canGenerate} type="submit">
            {isGenerating ? (
              <Loading aria-hidden="true" size="sm" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            {isGenerating ? "Generating..." : "Generate"}
          </Button>
          <Button disabled={!canGenerate} onClick={() => onGenerate()} variant="secondary">
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
          {isGenerating ? (
            <Button
              className="border-destructive/60 text-foreground hover:bg-destructive/15"
              onClick={onCancelGeneration}
              variant="secondary"
            >
              <X aria-hidden="true" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  )
}

type VoiceAssignmentsListProps = {
  assignments: VoiceTextAssignment[]
  isGenerating: boolean
  onEditAssignmentVoice: (assignmentId: string, voice: VoiceAsset) => void
  onRemoveAssignment: (assignmentId: string) => void
  stale: boolean
  voices: VoiceAsset[]
}

function VoiceAssignmentsList({
  assignments,
  isGenerating,
  onEditAssignmentVoice,
  onRemoveAssignment,
  stale,
  voices,
}: VoiceAssignmentsListProps) {
  return (
    <section className="mt-4" aria-label="Voice Assignments">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Voice Assignments</h3>
          <Badge>{assignments.length} Segments</Badge>
        </div>
        {stale ? <Badge className="border-destructive/40 bg-destructive/10 text-destructive">Stale</Badge> : null}
      </div>
      <div className="grid gap-2">
        {assignments.map((assignment) => (
          <article
            className={cn(
              "rounded-md border border-border bg-background/70 p-3",
              stale && "border-destructive/40 bg-destructive/10"
            )}
            key={assignment.id}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="accent">{assignment.voiceName}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {assignment.start}-{assignment.end}
                  </span>
                </div>
                <p className="break-words text-sm leading-6 text-foreground">{formatExcerpt(assignment.text, 180)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <VoicePickerControl
                  description="Choose a replacement voice for this assignment."
                  disabled={isGenerating}
                  onSelect={(voice) => onEditAssignmentVoice(assignment.id, voice)}
                  selectedVoiceId={assignment.voiceId}
                  title="Edit Voice"
                  triggerLabel="Edit Voice"
                  triggerIcon={<Pencil aria-hidden="true" />}
                  voices={voices}
                />
                <Button
                  disabled={isGenerating}
                  onClick={() => onRemoveAssignment(assignment.id)}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

type VoicePickerControlProps = {
  description: string
  disabled: boolean
  onSelect: (voice: VoiceAsset) => void
  selectedVoiceId?: string
  title: string
  triggerIcon: ReactNode
  triggerLabel: string
  voices: VoiceAsset[]
}

function VoicePickerControl({
  description,
  disabled,
  onSelect,
  selectedVoiceId,
  title,
  triggerIcon,
  triggerLabel,
  voices,
}: VoicePickerControlProps) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  function handleSelect(voice: VoiceAsset) {
    onSelect(voice)
    setOpen(false)
  }

  const picker = (
    <VoicePickerList
      onSelect={handleSelect}
      selectedVoiceId={selectedVoiceId}
      voices={voices}
    />
  )
  const trigger = (
    <Button disabled={disabled} size="sm" variant="secondary">
      {triggerIcon}
      {triggerLabel}
    </Button>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
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
    <Popover open={open} onOpenChange={setOpen}>
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

type VoicePickerListProps = {
  onSelect: (voice: VoiceAsset) => void
  selectedVoiceId?: string
  voices: VoiceAsset[]
}

function VoicePickerList({ onSelect, selectedVoiceId, voices }: VoicePickerListProps) {
  return (
    <ScrollArea className="max-h-72 pr-3">
      <div className="flex flex-col gap-2">
        {voices.map((voice) => (
          <Button
            className="h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left"
            key={voice.id}
            onClick={() => onSelect(voice)}
            variant={voice.id === selectedVoiceId ? "secondary" : "ghost"}
          >
            <span className="min-w-0 flex-1 truncate">{voice.name}</span>
          </Button>
        ))}
      </div>
    </ScrollArea>
  )
}

function formatExcerpt(value: string, maxLength = 80) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`
}
