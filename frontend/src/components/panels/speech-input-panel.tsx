import { Pencil, RefreshCw, Sparkles, Trash2, UserPlus, X } from "lucide-react"
import { useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MAX_SPEECH_TEXT_LENGTH } from "@/constants"
import { useIsMobile } from "@/hooks/use-mobile"
import type { DialogueScriptController } from "@/hooks/use-dialogue-script"
import { speakerColorClassName, type MultiVoiceScriptBlock } from "@/lib/dialogue-script"
import { cn } from "@/lib/utils"
import type { VoiceTextAssignment } from "@/lib/voice-assignments"
import type { VoiceAsset } from "@/types"

type SpeechInputPanelProps = {
  assignmentError: string | null
  assignmentSpeechSegmentCount: number | null
  assignments: VoiceTextAssignment[]
  assignmentsStale: boolean
  canGenerate: boolean
  characterCount: number
  dialogue: DialogueScriptController
  dialogueSpeechSegmentCount: number | null
  isGenerating: boolean
  naturalHandoffsEnabled: boolean
  onAssignVoice: (voice: VoiceAsset) => void
  onCancelGeneration: () => void
  onClearAssignments: () => void
  onEditAssignmentVoice: (assignmentId: string, voice: VoiceAsset) => void
  onGenerate: (event?: FormEvent<HTMLFormElement>) => void
  onNaturalHandoffsEnabledChange: (enabled: boolean) => void
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
  assignmentSpeechSegmentCount,
  assignments,
  assignmentsStale,
  canGenerate,
  characterCount,
  dialogue,
  dialogueSpeechSegmentCount,
  isGenerating,
  naturalHandoffsEnabled,
  onAssignVoice,
  onCancelGeneration,
  onClearAssignments,
  onEditAssignmentVoice,
  onGenerate,
  onNaturalHandoffsEnabledChange,
  onRemoveAssignment,
  onTextChange,
  onTextSelectionChange,
  selectedVoice,
  selectedText,
  text,
  textRef,
  voices,
}: SpeechInputPanelProps) {
  const isDialogueMode = dialogue.mode === "dialogue"
  const canAssignSelection = selectedText.trim().length > 0 && voices.length > 0 && !isGenerating
  const assignVoiceDisabledReason = getAssignVoiceDisabledReason({
    isGenerating,
    selectedText,
    voices,
  })
  const quickAssignmentVoices = assignedVoices(assignments, voices)
  const showNaturalHandoffs = assignments.length > 0 || (isDialogueMode && dialogue.segmentBuild.segments.length > 0)

  return (
    <form
      aria-busy={isGenerating}
      className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5"
      onSubmit={onGenerate}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          aria-label="Generation Input Mode"
          onValueChange={(value) => {
            if (value === "range" || value === "dialogue") {
              dialogue.setMode(value)
            }
          }}
          type="single"
          value={dialogue.mode}
          variant="outline"
        >
          <ToggleGroupItem value="range">Text Ranges</ToggleGroupItem>
          <ToggleGroupItem value="dialogue">Dialogue Rows</ToggleGroupItem>
        </ToggleGroup>
        <Button
          disabled={isGenerating || !text.trim()}
          onClick={() => dialogue.importFromText(text)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Sparkles aria-hidden="true" />
          Import Dialogue
        </Button>
      </div>

      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="speech-text">{isDialogueMode ? "Script Source" : "Text to Speak"}</FieldLabel>
          <span className="font-mono text-xs text-muted-foreground">
            {characterCount}/{MAX_SPEECH_TEXT_LENGTH}
          </span>
        </div>
        <Textarea
          className="max-h-none overflow-hidden"
          disabled={isGenerating}
          id="speech-text"
          maxLength={MAX_SPEECH_TEXT_LENGTH}
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
          {isDialogueMode
            ? "Import speaker-labeled text into editable dialogue rows."
            : selectedText.trim()
            ? `Selected: ${formatExcerpt(selectedText)}`
            : "Select script text to assign a voice."}
        </FieldDescription>
      </Field>

      {!isDialogueMode ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
        <VoicePickerControl
          description="Choose the voice for the selected text."
          disabled={!canAssignSelection}
          disabledTooltip={assignVoiceDisabledReason}
          onSelect={onAssignVoice}
          title="Assign Voice"
          triggerLabel="Assign Voice"
          triggerIcon={<UserPlus aria-hidden="true" />}
          voices={voices}
        />
        {quickAssignmentVoices.length > 0 ? (
          <div aria-label="Quick Voice Assignments" className="flex flex-wrap items-center gap-2">
            {quickAssignmentVoices.map((voice) => (
              <Button
                aria-label={`Assign Selected Text to ${voice.name}`}
                className="h-auto p-0"
                disabled={!canAssignSelection}
                key={voice.id}
                onClick={() => onAssignVoice(voice)}
                type="button"
                variant="ghost"
              >
                <Badge className="pointer-events-none" variant="accent">
                  {voice.name}
                </Badge>
              </Button>
            ))}
          </div>
        ) : null}
        {assignments.length > 0 ? (
          <Button disabled={isGenerating} onClick={onClearAssignments} size="sm" type="button" variant="ghost">
            Clear Assignments
          </Button>
        ) : null}
        </div>
      ) : null}

      {showNaturalHandoffs ? (
        <Field
          className="mt-3 rounded-md border border-border bg-background/60 p-3"
          data-disabled={isGenerating ? "" : undefined}
        >
          <div className="flex items-start gap-3">
            <Checkbox
              aria-describedby="natural-handoffs-description"
              checked={naturalHandoffsEnabled}
              disabled={isGenerating}
              id="natural-handoffs"
              onCheckedChange={(checked) => onNaturalHandoffsEnabledChange(checked === true)}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <FieldLabel htmlFor="natural-handoffs">Natural Handoffs</FieldLabel>
              <FieldDescription id="natural-handoffs-description">
                Adds a short pause between generated speech segments.
              </FieldDescription>
            </div>
          </div>
        </Field>
      ) : null}

      {assignmentsStale || assignmentError ? (
        <Alert className="mt-4 border-destructive/40 bg-destructive/10 text-destructive" role="alert">
          <AlertTitle>Voice Assignments Need Attention</AlertTitle>
          <AlertDescription>
            {assignmentError ||
              "Some script edits could not be matched to the current voice assignments. Clear and reassign voices, or restore the matching text."}
          </AlertDescription>
        </Alert>
      ) : null}

      {!isDialogueMode && assignments.length > 0 ? (
        <VoiceAssignmentsList
          assignmentSpeechSegmentCount={assignmentSpeechSegmentCount}
          assignments={assignments}
          isGenerating={isGenerating}
          onEditAssignmentVoice={onEditAssignmentVoice}
          onRemoveAssignment={onRemoveAssignment}
          stale={assignmentsStale}
          voices={voices}
        />
      ) : null}

      {isDialogueMode ? (
        <DialogueEditor
          defaultVoice={selectedVoice}
          dialogue={dialogue}
          dialogueSpeechSegmentCount={dialogueSpeechSegmentCount}
          isGenerating={isGenerating}
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
          <Button disabled={!canGenerate} onClick={() => onGenerate()} type="button" variant="secondary">
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
          {isGenerating ? (
            <Button
              className="border-destructive/60 text-foreground hover:bg-destructive/15"
              onClick={onCancelGeneration}
              type="button"
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
  assignmentSpeechSegmentCount: number | null
  assignments: VoiceTextAssignment[]
  isGenerating: boolean
  onEditAssignmentVoice: (assignmentId: string, voice: VoiceAsset) => void
  onRemoveAssignment: (assignmentId: string) => void
  stale: boolean
  voices: VoiceAsset[]
}

function VoiceAssignmentsList({
  assignmentSpeechSegmentCount,
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
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">Voice Assignments</h3>
          <Badge>{formatCount(assignments.length, "Assignment")}</Badge>
          {assignmentSpeechSegmentCount === null ? null : (
            <Badge variant="secondary">{formatCount(assignmentSpeechSegmentCount, "Speech Segment")}</Badge>
          )}
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
                  type="button"
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

type DialogueEditorProps = {
  defaultVoice: VoiceAsset | null
  dialogue: DialogueScriptController
  dialogueSpeechSegmentCount: number | null
  isGenerating: boolean
  voices: VoiceAsset[]
}

function DialogueEditor({
  defaultVoice,
  dialogue,
  dialogueSpeechSegmentCount,
  isGenerating,
  voices,
}: DialogueEditorProps) {
  const selectedRowsLabel = formatCount(dialogue.selectedBlockCount, "Selected Row")
  const canAssignRows = dialogue.selectedBlockCount > 0 && voices.length > 0 && !isGenerating
  const assignRowsDisabledReason = getAssignRowsDisabledReason({
    isGenerating,
    selectedBlockCount: dialogue.selectedBlockCount,
    voices,
  })

  return (
    <section className="mt-4 flex flex-col gap-4" aria-label="Dialogue Rows">
      <div className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Dialogue Rows</h3>
            <Badge>{formatCount(dialogue.blocks.length, "Row")}</Badge>
            {dialogueSpeechSegmentCount === null ? null : (
              <Badge variant="secondary">{formatCount(dialogueSpeechSegmentCount, "Speech Segment")}</Badge>
            )}
            {dialogue.selectedBlockCount > 0 ? <Badge variant="accent">{selectedRowsLabel}</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={dialogue.blocks.length === 0 || isGenerating}
              onClick={() => dialogue.setAllBlocksSelected(!dialogue.allBlocksSelected)}
              size="sm"
              type="button"
              variant="secondary"
            >
              {dialogue.allBlocksSelected ? "Clear Selection" : "Select All"}
            </Button>
            <VoicePickerControl
              description="Choose the voice for the selected dialogue rows."
              disabled={!canAssignRows}
              disabledTooltip={assignRowsDisabledReason}
              onSelect={dialogue.assignSelectedBlocks}
              title="Assign Selected Rows"
              triggerIcon={<UserPlus aria-hidden="true" />}
              triggerLabel="Assign Selected"
              voices={voices}
            />
          </div>
        </div>

        {dialogue.speakerLabels.length > 0 ? (
          <SpeakerMappings dialogue={dialogue} isGenerating={isGenerating} voices={voices} />
        ) : null}
      </div>

      {dialogue.blocks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-background/50 p-4 text-sm text-muted-foreground">
          Import dialogue to edit rows.
        </div>
      ) : (
        <div className="grid gap-3">
          {dialogue.blocks.map((block, index) => (
            <DialogueRow
              block={block}
              defaultVoice={defaultVoice}
              dialogue={dialogue}
              index={index}
              isGenerating={isGenerating}
              key={block.id}
              voices={voices}
            />
          ))}
        </div>
      )}
    </section>
  )
}

type SpeakerMappingsProps = {
  dialogue: DialogueScriptController
  isGenerating: boolean
  voices: VoiceAsset[]
}

function SpeakerMappings({ dialogue, isGenerating, voices }: SpeakerMappingsProps) {
  return (
    <section className="flex flex-col gap-2" aria-label="Speaker Voice Mapping">
      <h4 className="text-sm font-medium">Speaker Voice Mapping</h4>
      <div className="grid gap-2 md:grid-cols-2">
        {dialogue.speakerLabels.map((speakerLabel) => {
          const mapping = dialogue.speakerMappings.find((candidate) => candidate.speakerLabel === speakerLabel)
          const mappedVoice = voices.find((voice) => voice.id === mapping?.voiceId) ?? null
          const isMissing = !mappedVoice
          return (
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/70 p-2",
                isMissing && "border-destructive/40 bg-destructive/10"
              )}
              key={speakerLabel}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Badge className={cn("shrink-0", speakerColorClassName(speakerLabel))} variant="secondary">
                  {speakerLabel}
                </Badge>
                <span className="truncate text-sm text-muted-foreground">
                  {mappedVoice?.name ?? "Mapping Required"}
                </span>
              </div>
              <VoicePickerControl
                description={`Choose the voice for ${speakerLabel}.`}
                disabled={isGenerating || voices.length === 0}
                disabledTooltip={voices.length === 0 ? "Add a voice before mapping speakers." : null}
                onSelect={(voice) => dialogue.updateSpeakerMapping(speakerLabel, voice)}
                selectedVoiceId={mappedVoice?.id}
                title="Map Speaker"
                triggerIcon={<UserPlus aria-hidden="true" />}
                triggerLabel={mappedVoice ? "Change Voice" : "Map Voice"}
                voices={voices}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

type DialogueRowProps = {
  block: MultiVoiceScriptBlock
  defaultVoice: VoiceAsset | null
  dialogue: DialogueScriptController
  index: number
  isGenerating: boolean
  voices: VoiceAsset[]
}

function DialogueRow({ block, defaultVoice, dialogue, index, isGenerating, voices }: DialogueRowProps) {
  const mapping = block.speakerLabel
    ? dialogue.speakerMappings.find((candidate) => candidate.speakerLabel === block.speakerLabel)
    : null
  const overrideVoice = voices.find((voice) => voice.id === block.voiceId) ?? null
  const mappedVoice = voices.find((voice) => voice.id === mapping?.voiceId) ?? null
  const effectiveVoice = overrideVoice ?? mappedVoice ?? (block.speakerLabel ? null : defaultVoice)
  const mappingMissing = Boolean(block.speakerLabel && !effectiveVoice)
  const speakerId = `${block.id}-speaker`
  const textId = `${block.id}-text`

  return (
    <article
      className={cn(
        "dialogue-speaker-row rounded-md border border-border bg-background/70 p-3",
        speakerColorClassName(block.speakerLabel),
        mappingMissing && "border-destructive/50"
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Checkbox
              aria-label={`Select Dialogue Row ${index + 1}`}
              checked={dialogue.selectedBlockIds.has(block.id)}
              disabled={isGenerating}
              onCheckedChange={(checked) => dialogue.toggleBlockSelection(block.id, checked === true)}
            />
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)]">
              <Field>
                <FieldLabel htmlFor={speakerId}>Speaker</FieldLabel>
                <Input
                  disabled={isGenerating}
                  id={speakerId}
                  onChange={(event) => dialogue.updateBlockSpeakerLabel(block.id, event.target.value)}
                  onKeyDown={preventFormSubmitOnEnter}
                  placeholder="Narrator"
                  value={block.speakerLabel ?? ""}
                />
              </Field>
              <Field data-invalid={mappingMissing ? "" : undefined}>
                <FieldLabel htmlFor={textId}>Dialogue</FieldLabel>
                <Textarea
                  aria-invalid={mappingMissing}
                  disabled={isGenerating}
                  id={textId}
                  onChange={(event) => dialogue.updateBlockText(block.id, event.target.value)}
                  rows={2}
                  value={block.text}
                />
              </Field>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge variant={overrideVoice ? "accent" : "secondary"}>
              {effectiveVoice?.name ?? "Mapping Required"}
            </Badge>
            <VoicePickerControl
              description="Choose a row-specific voice."
              disabled={isGenerating || voices.length === 0}
              disabledTooltip={voices.length === 0 ? "Add a voice before assigning dialogue rows." : null}
              onSelect={(voice) => dialogue.updateBlockVoice(block.id, voice)}
              selectedVoiceId={overrideVoice?.id ?? mappedVoice?.id}
              title="Assign Row Voice"
              triggerIcon={<UserPlus aria-hidden="true" />}
              triggerLabel={overrideVoice ? "Change Override" : "Override Voice"}
              voices={voices}
            />
            {overrideVoice ? (
              <Button
                disabled={isGenerating}
                onClick={() => dialogue.updateBlockVoice(block.id, null)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" />
                Clear Override
              </Button>
            ) : null}
          </div>
        </div>
        {mappingMissing ? (
          <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
            <AlertTitle>Speaker Mapping Required</AlertTitle>
            <AlertDescription>Map {block.speakerLabel} to a voice before generating.</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </article>
  )
}

function preventFormSubmitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") {
    event.preventDefault()
  }
}

type VoicePickerControlProps = {
  description: string
  disabled: boolean
  disabledTooltip?: string | null
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
  disabledTooltip,
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
    <Button disabled={disabled} size="sm" type="button" variant="secondary">
      {triggerIcon}
      {triggerLabel}
    </Button>
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
            type="button"
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
  const normalized = value
    .replace(/\r?\n/g, " / ")
    .replace(/[ \t]+/g, " ")
    .trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`
}

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

function getAssignVoiceDisabledReason({
  isGenerating,
  selectedText,
  voices,
}: {
  isGenerating: boolean
  selectedText: string
  voices: VoiceAsset[]
}) {
  if (isGenerating) {
    return "Wait for generation to finish before assigning a voice."
  }
  if (!selectedText.trim()) {
    return "Select script text before assigning a voice."
  }
  if (voices.length === 0) {
    return "Add a voice before assigning selected text."
  }
  return null
}

function getAssignRowsDisabledReason({
  isGenerating,
  selectedBlockCount,
  voices,
}: {
  isGenerating: boolean
  selectedBlockCount: number
  voices: VoiceAsset[]
}) {
  if (isGenerating) {
    return "Wait for generation to finish before assigning rows."
  }
  if (selectedBlockCount === 0) {
    return "Select dialogue rows before assigning a voice."
  }
  if (voices.length === 0) {
    return "Add a voice before assigning dialogue rows."
  }
  return null
}

function assignedVoices(assignments: VoiceTextAssignment[], voices: VoiceAsset[]) {
  const voicesById = new Map(voices.map((voice) => [voice.id, voice]))
  const seenVoiceIds = new Set<string>()
  const result: VoiceAsset[] = []

  for (const assignment of assignments) {
    if (seenVoiceIds.has(assignment.voiceId)) {
      continue
    }
    const voice = voicesById.get(assignment.voiceId)
    if (!voice) {
      continue
    }
    seenVoiceIds.add(voice.id)
    result.push(voice)
  }

  return result
}
