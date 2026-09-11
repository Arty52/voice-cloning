import { Pencil, RefreshCw, Save, Sparkles, Trash2, UserPlus, X } from "lucide-react"
import { type FormEvent, type RefObject } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Loading } from "@/components/ui/loading"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { MAX_SPEECH_TEXT_LENGTH } from "@/constants"
import type { DialogueScriptController } from "@/hooks/use-dialogue-script"
import type { VoicePickerPreview } from "@/hooks/use-voice-picker-preview"
import { cn } from "@/lib/utils"
import type { VoiceTextAssignment } from "@/lib/voice-assignments"
import type { ProviderTuningControl, VoiceAsset, VoiceTuningValues } from "@/types"

import { DialogueEditor, type DialogueEditingActions } from "@/components/dialogue/dialogue-editor"
import { DialogueSource } from "@/components/dialogue/dialogue-source"
import { VoicePickerControl } from "@/components/dialogue/voice-picker-control"

type SpeechInputPanelProps = {
  dialogueActions?: DialogueEditingActions
  sourceExpanded?: boolean
  onSourceExpandedChange?: (expanded: boolean) => void
  onImportDialogue?: () => void
  sourceError?: string | null
  assignmentError: string | null
  assignmentSpeechSegmentCount: number | null
  assignments: VoiceTextAssignment[]
  assignmentsStale: boolean
  canGenerate: boolean
  characterCount: number
  dialogue: DialogueScriptController
  dialogueSpeechSegmentCount: number | null
  effectiveVoiceSettingsByVoiceId?: Record<string, VoiceTuningValues>
  isGenerating: boolean
  naturalHandoffsEnabled: boolean
  naturalHandoffsSaveError?: string | null
  naturalHandoffsUnsaved?: boolean
  onAssignVoice: (voice: VoiceAsset) => void
  onCancelGeneration: () => void
  onClearAssignments: () => void
  onEditAssignmentVoice: (assignmentId: string, voice: VoiceAsset) => void
  onGenerate: (event?: FormEvent<HTMLFormElement>) => void
  onNaturalHandoffsEnabledChange: (enabled: boolean) => void
  onSaveNaturalHandoffsDefault?: () => void
  onRemoveAssignment: (assignmentId: string) => void
  onSourceVoiceChange: (voiceId: string) => void
  onTextChange: (text: string) => void
  onTextSelectionChange: () => void
  providerTuningControls?: ProviderTuningControl[]
  providerTuningDefaultValues?: VoiceTuningValues
  scriptRestoreWarning?: string | null
  selectedVoice: VoiceAsset | null
  selectedText: string
  text: string
  textRef: RefObject<HTMLTextAreaElement | null>
  tuning?: VoiceTuningValues
  voices: VoiceAsset[]
  voicePickerPreview: VoicePickerPreview
}

const EMPTY_VOICE_SETTINGS_BY_VOICE_ID: Record<string, VoiceTuningValues> = {}

export function SpeechInputPanel({
  dialogueActions,
  sourceExpanded = true,
  onSourceExpandedChange = () => {},
  onImportDialogue,
  sourceError,
  assignmentError,
  assignmentSpeechSegmentCount,
  assignments,
  assignmentsStale,
  canGenerate,
  characterCount,
  dialogue,
  dialogueSpeechSegmentCount,
  effectiveVoiceSettingsByVoiceId = EMPTY_VOICE_SETTINGS_BY_VOICE_ID,
  isGenerating,
  naturalHandoffsEnabled,
  naturalHandoffsSaveError = null,
  naturalHandoffsUnsaved = false,
  onAssignVoice,
  onCancelGeneration,
  onClearAssignments,
  onEditAssignmentVoice,
  onGenerate,
  onNaturalHandoffsEnabledChange,
  onSaveNaturalHandoffsDefault = noopSaveNaturalHandoffsDefault,
  onRemoveAssignment,
  onSourceVoiceChange,
  onTextChange,
  onTextSelectionChange,
  providerTuningControls = [],
  providerTuningDefaultValues = {},
  scriptRestoreWarning = null,
  selectedVoice,
  selectedText,
  text,
  textRef,
  tuning = {},
  voices,
  voicePickerPreview,
}: SpeechInputPanelProps) {
  const isDialogueMode = dialogue.mode === "dialogue"
  const canAssignSelection = selectedText.trim().length > 0 && voices.length > 0 && !isGenerating
  const showDialogueAlert = isDialogueMode && assignmentError
  const showVoiceAssignmentAlert = !isDialogueMode && (assignmentsStale || assignmentError)
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
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Field className="w-full sm:w-56">
          <FieldLabel htmlFor="generation-input-mode">Input Mode</FieldLabel>
          <Select
            disabled={isGenerating}
            onValueChange={(value) => {
              if (value === "range" || value === "dialogue") {
                dialogue.setMode(value)
              }
            }}
            value={dialogue.mode}
          >
            <SelectTrigger className="w-full" id="generation-input-mode">
              <SelectValue placeholder="Select input mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="range">Text Ranges</SelectItem>
                <SelectItem value="dialogue">Dialogue Rows</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {!isDialogueMode ? <Button
          disabled={isGenerating || !text.trim()}
          onClick={onImportDialogue ?? (() => dialogue.importFromText(text))}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Sparkles aria-hidden="true" />
          Import Dialogue
        </Button> : null}
      </div>

      {isDialogueMode ? (
        <DialogueSource expanded={sourceExpanded} onExpandedChange={onSourceExpandedChange} hasRows={dialogue.blocks.length > 0} disabled={isGenerating} text={text} textRef={textRef} onTextChange={onTextChange} onImport={onImportDialogue ?? (() => dialogue.importFromText(text))} />
      ) : <Field>
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
      </Field>}
      {sourceError ? <p role="alert" className="mt-2 text-sm text-destructive">{sourceError}</p> : null}

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
          preview={voicePickerPreview}
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
            {naturalHandoffsUnsaved ? (
              <Button
                disabled={isGenerating}
                onClick={onSaveNaturalHandoffsDefault}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Save aria-hidden="true" data-icon="inline-start" />
                Save
              </Button>
            ) : null}
          </div>
          {naturalHandoffsSaveError ? (
            <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
              <AlertTitle>Save Failed</AlertTitle>
              <AlertDescription>{naturalHandoffsSaveError}</AlertDescription>
            </Alert>
          ) : null}
        </Field>
      ) : null}

      {showVoiceAssignmentAlert ? (
        <Alert className="mt-4 border-destructive/40 bg-destructive/10 text-destructive" role="alert">
          <AlertTitle>Voice Assignments Need Attention</AlertTitle>
          <AlertDescription>
            {assignmentError ||
              "Some script edits could not be matched to the current voice assignments. Clear and reassign voices, or restore the matching text."}
          </AlertDescription>
        </Alert>
      ) : null}

      {showDialogueAlert ? (
        <Alert className="mt-4 border-destructive/40 bg-destructive/10 text-destructive" role="alert">
          <AlertTitle>Dialogue Rows Need Attention</AlertTitle>
          <AlertDescription>{assignmentError}</AlertDescription>
        </Alert>
      ) : null}

      {scriptRestoreWarning ? (
        <Alert className="mt-4 border-primary/40 bg-primary/10 text-foreground" role="alert">
          <AlertTitle>Script Restored With Missing Voices</AlertTitle>
          <AlertDescription>{scriptRestoreWarning}</AlertDescription>
        </Alert>
      ) : null}

      {!isDialogueMode && assignments.length > 0 ? (
        <VoiceAssignmentsList
          assignmentSpeechSegmentCount={assignmentSpeechSegmentCount}
          assignments={assignments}
          isGenerating={isGenerating}
          onEditAssignmentVoice={onEditAssignmentVoice}
          onRemoveAssignment={onRemoveAssignment}
          preview={voicePickerPreview}
          stale={assignmentsStale}
          voices={voices}
        />
      ) : null}

      {isDialogueMode ? (
        <DialogueEditor
          {...dialogueActions}
          defaultVoice={selectedVoice}
          dialogue={dialogue}
          dialogueSpeechSegmentCount={dialogueSpeechSegmentCount}
          effectiveVoiceSettingsByVoiceId={effectiveVoiceSettingsByVoiceId}
          isGenerating={isGenerating}
          providerTuningControls={providerTuningControls}
          providerTuningDefaultValues={providerTuningDefaultValues}
          preview={voicePickerPreview}
          tuning={tuning}
          voices={voices}
        />
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Field className="w-full sm:w-64" data-disabled={isGenerating || voices.length === 0 ? "" : undefined}>
          <FieldLabel htmlFor="source-voice">Source Voice</FieldLabel>
          <Select
            disabled={isGenerating || voices.length === 0}
            onValueChange={(voiceId) => {
              if (voices.some((voice) => voice.id === voiceId)) {
                onSourceVoiceChange(voiceId)
              }
            }}
            value={selectedVoice?.id ?? ""}
          >
            <SelectTrigger className="w-full" id="source-voice">
              <SelectValue placeholder="No voice selected" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectLabel>Voice Library</SelectLabel>
                {voices.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    {voice.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
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
  preview: VoicePickerPreview
  stale: boolean
  voices: VoiceAsset[]
}

function VoiceAssignmentsList({
  assignmentSpeechSegmentCount,
  assignments,
  isGenerating,
  onEditAssignmentVoice,
  onRemoveAssignment,
  preview,
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
                  preview={preview}
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

function noopSaveNaturalHandoffsDefault() {}
