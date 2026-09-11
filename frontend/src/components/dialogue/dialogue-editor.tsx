import { SlidersHorizontal, UserPlus, X } from "lucide-react"
import { type KeyboardEvent } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ActionMenu } from "@/components/ui/action-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Textarea } from "@/components/ui/textarea"
import { VoiceTuningControls } from "@/components/voice-tuning-controls"
import type { DialogueScriptController } from "@/hooks/use-dialogue-script"
import type { VoicePickerPreview } from "@/hooks/use-voice-picker-preview"
import { speakerColorClassName, type MultiVoiceScriptBlock } from "@/lib/dialogue-script"
import { cn } from "@/lib/utils"
import type { ProviderTuningControl, ProviderTuningValue, VoiceAsset, VoiceTuningValues } from "@/types"

import { VoicePickerControl } from "@/components/dialogue/voice-picker-control"

type DialogueEditorProps = {
  defaultVoice: VoiceAsset | null
  dialogue: DialogueScriptController
  dialogueSpeechSegmentCount: number | null
  effectiveVoiceSettingsByVoiceId: Record<string, VoiceTuningValues>
  isGenerating: boolean
  providerTuningControls: ProviderTuningControl[]
  providerTuningDefaultValues: VoiceTuningValues
  preview: VoicePickerPreview
  tuning: VoiceTuningValues
  voices: VoiceAsset[]
}

export function DialogueEditor({
  defaultVoice,
  dialogue,
  dialogueSpeechSegmentCount,
  effectiveVoiceSettingsByVoiceId,
  isGenerating,
  providerTuningControls,
  providerTuningDefaultValues,
  preview,
  tuning,
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
              preview={preview}
              voices={voices}
            />
          </div>
        </div>

        {dialogue.speakerLabels.length > 0 ? (
          <SpeakerMappings dialogue={dialogue} isGenerating={isGenerating} preview={preview} voices={voices} />
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
              effectiveVoiceSettingsByVoiceId={effectiveVoiceSettingsByVoiceId}
              index={index}
              isGenerating={isGenerating}
              providerTuningControls={providerTuningControls}
              providerTuningDefaultValues={providerTuningDefaultValues}
              preview={preview}
              tuning={tuning}
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
  preview: VoicePickerPreview
  voices: VoiceAsset[]
}

function SpeakerMappings({ dialogue, isGenerating, preview, voices }: SpeakerMappingsProps) {
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
                preview={preview}
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
  effectiveVoiceSettingsByVoiceId: Record<string, VoiceTuningValues>
  index: number
  isGenerating: boolean
  providerTuningControls: ProviderTuningControl[]
  providerTuningDefaultValues: VoiceTuningValues
  preview: VoicePickerPreview
  tuning: VoiceTuningValues
  voices: VoiceAsset[]
}

function DialogueRow({
  block,
  defaultVoice,
  dialogue,
  effectiveVoiceSettingsByVoiceId,
  index,
  isGenerating,
  providerTuningControls,
  providerTuningDefaultValues,
  preview,
  tuning,
  voices,
}: DialogueRowProps) {
  const { effectiveVoice, mappedVoice, overrideVoice } = resolveDialogueRowVoice({
    block,
    defaultVoice,
    speakerMappings: dialogue.speakerMappings,
    voices,
  })
  const mappingMissing = Boolean(block.speakerLabel && !effectiveVoice)
  const isAssignedVoice = Boolean(overrideVoice || mappedVoice)
  const isDefaultVoice = Boolean(defaultVoice && effectiveVoice?.id === defaultVoice.id)
  const assignedVoiceTuning =
    isAssignedVoice && effectiveVoice && !isDefaultVoice
      ? effectiveVoiceSettingsByVoiceId[effectiveVoice.id] ?? null
      : null
  const rowTuning = block.voiceSettings ?? assignedVoiceTuning ?? tuning
  const hasCustomRowTuning = block.voiceSettings !== null && block.voiceSettings !== undefined
  const hasMatchingVoiceRows =
    effectiveVoice !== null &&
    dialogue.blocks.some((candidate) => {
      if (candidate.id === block.id) {
        return false
      }
      return (
        resolveDialogueRowVoice({
          block: candidate,
          defaultVoice,
          speakerMappings: dialogue.speakerMappings,
          voices,
        }).effectiveVoice?.id === effectiveVoice.id
      )
    })
  const speakerId = `${block.id}-speaker`
  const textId = `${block.id}-text`

  function handleRowTuningValueChange(control: ProviderTuningControl, value: ProviderTuningValue) {
    dialogue.updateBlockVoiceSettings(block.id, {
      ...rowTuning,
      [control.id]: value,
    })
  }

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
            {hasCustomRowTuning ? <Badge variant="accent">Custom Tuning</Badge> : null}
            {providerTuningControls.length > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    aria-label={`Tune Dialogue Row ${index + 1}`}
                    disabled={isGenerating || !effectiveVoice}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <SlidersHorizontal aria-hidden="true" data-icon="inline-start" />
                    Tune
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-80 sm:w-96"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <PopoverHeader className="min-w-0 flex-1">
                      <PopoverTitle>Dialogue Row {index + 1} Tuning</PopoverTitle>
                      <PopoverDescription>Adjust settings for this dialogue row before generation.</PopoverDescription>
                    </PopoverHeader>
                    <ActionMenu
                      ariaLabel={`Open Dialogue Row ${index + 1} Tuning Actions`}
                      disabled={isGenerating || !effectiveVoice}
                      items={[
                        {
                          disabled: !hasCustomRowTuning || !hasMatchingVoiceRows,
                          icon: <SlidersHorizontal aria-hidden="true" className="size-4" />,
                          label: "Apply To Same Voice",
                          onSelect: () => dialogue.applyBlockVoiceSettingsToMatchingVoice(block.id, rowTuning),
                        },
                      ]}
                    />
                  </div>
                  <VoiceTuningControls
                    className="mt-4 grid-cols-1"
                    controls={providerTuningControls}
                    disabled={isGenerating || !effectiveVoice}
                    idPrefix={`dialogue-row-${block.id}-tuning`}
                    nominalValues={providerTuningDefaultValues}
                    onTuningValueChange={handleRowTuningValueChange}
                    tuning={rowTuning}
                  />
                </PopoverContent>
              </Popover>
            ) : null}
            <VoicePickerControl
              description="Choose a row-specific voice."
              disabled={isGenerating || voices.length === 0}
              disabledTooltip={voices.length === 0 ? "Add a voice before assigning dialogue rows." : null}
              onSelect={(voice) => dialogue.updateBlockVoice(block.id, voice)}
              selectedVoiceId={overrideVoice?.id ?? mappedVoice?.id}
              title="Assign Row Voice"
              triggerIcon={<UserPlus aria-hidden="true" />}
              triggerLabel={overrideVoice ? "Change Override" : "Override Voice"}
              preview={preview}
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

function resolveDialogueRowVoice({
  block,
  defaultVoice,
  speakerMappings,
  voices,
}: {
  block: MultiVoiceScriptBlock
  defaultVoice: VoiceAsset | null
  speakerMappings: DialogueScriptController["speakerMappings"]
  voices: VoiceAsset[]
}) {
  const mapping = block.speakerLabel
    ? speakerMappings.find((candidate) => candidate.speakerLabel === block.speakerLabel)
    : null
  const overrideVoice = voices.find((voice) => voice.id === block.voiceId) ?? null
  const mappedVoice = voices.find((voice) => voice.id === mapping?.voiceId) ?? null
  const effectiveVoice = overrideVoice ?? mappedVoice ?? (block.speakerLabel ? null : defaultVoice)

  return {
    effectiveVoice,
    mappedVoice,
    overrideVoice,
  }
}

function preventFormSubmitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") {
    event.preventDefault()
  }
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


function formatCount(count: number, singular: string) { return `${count} ${singular}${count === 1 ? "" : "s"}` }
