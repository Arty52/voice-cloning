import { type CSSProperties, useEffect, useRef, useState } from "react"
import { AudioLines, ChevronDown, FileAudio, Info, Play, Save, Upload, Wand2 } from "lucide-react"

import { AudioPlayer } from "@/components/audio-player"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/loading"
import { MenuSelect } from "@/components/ui/menu-select"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { VoicePresetToggleGroup } from "@/components/voice-preset-toggle-group"
import type { SampleProcessingController } from "@/hooks/use-sample-processing"
import { formatElapsedTime } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import type {
  SampleProcessingOperationId,
  SampleProcessingPresetId,
  SpeakerSeparationResult,
  SpeakerTranscriptItem,
  VoicePresetId,
} from "@/types"

type SampleProcessingPanelProps = {
  isCollapsible?: boolean
  isExpanded: boolean
  onToggleExpanded: () => void
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}

const SOURCE_PREFERENCE_ORIGINAL_DESCRIPTION =
  "Uses the retained full upload/source file when one exists; otherwise falls back to the active sample."
const SOURCE_PREFERENCE_ACTIVE_DESCRIPTION = "Uses the provider-facing sample currently stored for the selected voice."
const SOURCE_PREFERENCE_SAVE_DESCRIPTION =
  "Processing creates a preview only. Add To Voice Library saves that preview as a new voice and does not replace the selected voice."
const SPEAKER_COLORS = [
  "oklch(0.74 0.17 36)",
  "oklch(0.72 0.14 184)",
  "oklch(0.76 0.16 143)",
  "oklch(0.77 0.15 302)",
  "oklch(0.78 0.13 84)",
  "oklch(0.74 0.16 247)",
]

export function SampleProcessingPanel({
  isCollapsible = true,
  isExpanded,
  onToggleExpanded,
  processing,
  voicePresets,
}: SampleProcessingPanelProps) {
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null)
  const playbackEndRef = useRef<number | null>(null)
  const [dragStartItemId, setDragStartItemId] = useState<string | null>(null)
  const operationOptions = processing.operations.map((operation) => ({
    label: operation.enabled
      ? operationDisplayLabel(operation.id, operation.label)
      : `${operationDisplayLabel(operation.id, operation.label)} Unavailable`,
    value: operation.id,
  }))
  const voiceOptions = processing.voiceOptions.length > 0 ? processing.voiceOptions : [{ label: "No Voices", value: "" }]
  const isUnavailable =
    processing.optionsStatus === "success" &&
    processing.enabledOperations.length === 0 &&
    processing.operations.length > 0
  const statusLabel = panelStatusLabel(processing)
  const elapsedTimeLabel = panelElapsedTimeLabel(processing)
  const presetLabel = presetControlLabel(processing.operationId)
  const isDetailsVisible = isExpanded || !isCollapsible
  const speakerResult = processing.speakerSeparationResult

  useEffect(() => {
    const audio = sourceAudioRef.current
    if (!audio) {
      return
    }
    const audioElement = audio
    function handleTimeUpdate() {
      const endSeconds = playbackEndRef.current
      if (endSeconds !== null && audioElement.currentTime >= endSeconds) {
        audioElement.pause()
        playbackEndRef.current = null
      }
    }
    audioElement.addEventListener("timeupdate", handleTimeUpdate)
    return () => audioElement.removeEventListener("timeupdate", handleTimeUpdate)
  }, [processing.speakerSourceUrl])

  function playTranscriptItem(item: SpeakerTranscriptItem) {
    const audio = sourceAudioRef.current
    if (!audio || !processing.speakerSourceUrl) {
      return
    }
    playbackEndRef.current = item.endSeconds
    audio.currentTime = item.startSeconds
    void audio.play().catch(() => {
      playbackEndRef.current = null
    })
  }

  function updateTranscriptSelectionThrough(itemId: string) {
    if (!speakerResult || !dragStartItemId) {
      processing.handleTranscriptSelectionChange([itemId])
      return
    }
    const itemIds = speakerResult.transcript.items.map((item) => item.id)
    const startIndex = itemIds.indexOf(dragStartItemId)
    const endIndex = itemIds.indexOf(itemId)
    if (startIndex === -1 || endIndex === -1) {
      processing.handleTranscriptSelectionChange([itemId])
      return
    }
    const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
    processing.handleTranscriptSelectionChange(itemIds.slice(from, to + 1))
  }

  return (
    <section aria-busy={processing.isProcessing} className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-medium">Sample Processing</h2>
            <Badge className={cn(processing.status === "error" && "border-destructive/40 bg-destructive/10 text-destructive")}>
              {statusLabel}
            </Badge>
            {elapsedTimeLabel ? (
              <span aria-label="Sample Processing Elapsed Time" className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {elapsedTimeLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Prepare samples before adding them to the Voice Library.</p>
        </div>
        {isCollapsible ? (
          <Button
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Close Sample Processing" : "Open Sample Processing"}
            onClick={onToggleExpanded}
            size="icon"
            type="button"
            variant="secondary"
          >
            <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
          </Button>
        ) : null}
      </div>

      {isDetailsVisible ? (
        <div className="mt-4 space-y-4">
          {processing.optionsStatus === "loading" ? (
            <div className="rounded-md border border-border bg-background/60 p-3">
              <Loading text="Loading Processing Options" variant="secondary" />
            </div>
          ) : null}

          {processing.optionsError ? (
            <Alert role="alert">
              <AlertTitle>Sample Processing Unavailable</AlertTitle>
              <AlertDescription>{processing.optionsError}</AlertDescription>
            </Alert>
          ) : null}

          {isUnavailable ? (
            <Alert>
              <AlertTitle>Sample Processing Unavailable</AlertTitle>
              <AlertDescription>Configure a local processor to enable sample operations.</AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-3" onSubmit={processing.handleStartProcessing}>
            <FieldGroup>
              <Field>
                <FieldLabel id="sample-processing-operation-label">Operation</FieldLabel>
                <MenuSelect
                  ariaLabel="Sample Processing Operation"
                  disabled={processing.optionsStatus !== "success" || processing.operations.length === 0 || processing.isProcessing}
                  onChange={(value) => {
                    if (isSampleProcessingOperationId(value)) {
                      processing.setOperationId(value)
                    }
                  }}
                  options={operationOptions}
                  value={processing.operationId}
                />
                {processing.selectedOperation ? (
                  <FieldDescription>{processing.selectedOperation.description}</FieldDescription>
                ) : null}
              </Field>

              {processing.selectedOperation?.enabled === true && processing.processingPresets.length > 0 ? (
                <Field>
                  <FieldLabel id="sample-processing-preset-label">{presetLabel}</FieldLabel>
                  <ToggleGroup
                    aria-labelledby="sample-processing-preset-label"
                    className="grid w-full grid-cols-2 rounded-md border border-border bg-background/60 p-1"
                    disabled={processing.isProcessing}
                    onValueChange={(value) => {
                      if (isSampleProcessingPresetId(value)) {
                        processing.setProcessingPresetId(value)
                      }
                    }}
                    type="single"
                    value={processing.processingPresetId}
                  >
                    {processing.processingPresets.map((preset) => (
                      <ToggleGroupItem
                        className="h-9 min-w-0 rounded px-2 text-center text-xs font-medium text-muted-foreground aria-checked:bg-primary aria-checked:text-primary-foreground aria-checked:shadow-sm"
                        key={preset.id}
                        value={preset.id}
                      >
                        <span className="min-w-0 truncate">{preset.label}</span>
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {processing.selectedProcessingPreset ? (
                    <FieldDescription>{processing.selectedProcessingPreset.description}</FieldDescription>
                  ) : null}
                </Field>
              ) : null}

              <Field>
                <FieldLabel>Source</FieldLabel>
                <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background/60 p-1" role="group" aria-label="Sample source">
                  <Button
                    aria-pressed={processing.sourceMode === "voice"}
                    className={cn(processing.sourceMode !== "voice" && "bg-transparent")}
                    disabled={processing.isProcessing}
                    onClick={() => processing.handleSourceModeChange("voice")}
                    type="button"
                    variant={processing.sourceMode === "voice" ? "secondary" : "ghost"}
                  >
                    <FileAudio aria-hidden="true" className="size-4" />
                    Saved Voice
                  </Button>
                  <Button
                    aria-pressed={processing.sourceMode === "upload"}
                    className={cn(processing.sourceMode !== "upload" && "bg-transparent")}
                    disabled={processing.isProcessing}
                    onClick={() => processing.handleSourceModeChange("upload")}
                    type="button"
                    variant={processing.sourceMode === "upload" ? "secondary" : "ghost"}
                  >
                    <Upload aria-hidden="true" className="size-4" />
                    Audio File
                  </Button>
                </div>
              </Field>

              {processing.sourceMode === "voice" ? (
                <>
                  <Field>
                    <FieldLabel id="sample-processing-voice-label">Saved Voice</FieldLabel>
                    <MenuSelect
                      ariaLabel="Sample Processing Saved Voice"
                      disabled={processing.isProcessing || voiceOptions.length === 0 || voiceOptions[0]?.value === ""}
                      onChange={processing.setSourceVoiceId}
                      options={voiceOptions}
                      value={processing.sourceVoiceId}
                    />
                  </Field>
                  <Field>
                    <div className="flex items-center gap-1.5">
                      <FieldLabel id="sample-processing-source-preference-label">Source Preference</FieldLabel>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label="Explain Source Preference"
                            className="size-6 shrink-0"
                            disabled={processing.isProcessing}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Info aria-hidden="true" data-icon="inline-start" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-72" side="top" sideOffset={6}>
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">Original Source</span>
                              <span>{SOURCE_PREFERENCE_ORIGINAL_DESCRIPTION}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">Active Sample</span>
                              <span>{SOURCE_PREFERENCE_ACTIVE_DESCRIPTION}</span>
                            </div>
                            <span>{SOURCE_PREFERENCE_SAVE_DESCRIPTION}</span>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div
                      className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background/60 p-1"
                      role="group"
                      aria-labelledby="sample-processing-source-preference-label"
                    >
                      <Button
                        aria-describedby="sample-processing-original-source-description sample-processing-source-save-description"
                        aria-pressed={processing.sourcePreference === "original"}
                        className={cn(processing.sourcePreference !== "original" && "bg-transparent")}
                        disabled={processing.isProcessing}
                        onClick={() => processing.setSourcePreference("original")}
                        type="button"
                        variant={processing.sourcePreference === "original" ? "secondary" : "ghost"}
                      >
                        Original Source
                      </Button>
                      <Button
                        aria-describedby="sample-processing-active-sample-description sample-processing-source-save-description"
                        aria-pressed={processing.sourcePreference === "active"}
                        className={cn(processing.sourcePreference !== "active" && "bg-transparent")}
                        disabled={processing.isProcessing}
                        onClick={() => processing.setSourcePreference("active")}
                        type="button"
                        variant={processing.sourcePreference === "active" ? "secondary" : "ghost"}
                      >
                        Active Sample
                      </Button>
                    </div>
                    <FieldDescription className="sr-only" id="sample-processing-original-source-description">
                      {SOURCE_PREFERENCE_ORIGINAL_DESCRIPTION}
                    </FieldDescription>
                    <FieldDescription className="sr-only" id="sample-processing-active-sample-description">
                      {SOURCE_PREFERENCE_ACTIVE_DESCRIPTION}
                    </FieldDescription>
                    <FieldDescription className="sr-only" id="sample-processing-source-save-description">
                      {SOURCE_PREFERENCE_SAVE_DESCRIPTION}
                    </FieldDescription>
                  </Field>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="sample-processing-file">Audio File</FieldLabel>
                  <Input
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                    disabled={processing.isProcessing}
                    id="sample-processing-file"
                    onChange={processing.handleSourceFileChange}
                    type="file"
                  />
                </Field>
              )}
            </FieldGroup>

            {processing.error ? (
              <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
                <AlertTitle>Processing Failed</AlertTitle>
                <AlertDescription>{processing.error}</AlertDescription>
              </Alert>
            ) : null}

            <Button className="w-full" disabled={!processing.canStart} type="submit">
              {processing.isProcessing ? <Loading aria-hidden="true" size="sm" /> : <Wand2 aria-hidden="true" className="size-4" />}
              {processing.status === "starting"
                ? "Starting Processing"
                : processing.status === "processing"
                  ? "Processing Sample"
                  : "Start Processing"}
            </Button>
          </form>

          {processing.resultUrl && processing.job ? (
            <form className="space-y-3 rounded-md border border-border bg-background/60 p-3" onSubmit={processing.handleSaveProcessedVoice}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Processed Preview</div>
                <AudioLines aria-hidden="true" className="size-4 text-primary" />
              </div>
              <AudioPlayer ariaLabel="Processed sample preview" src={processing.resultUrl} />
              <label className="block space-y-2 text-sm font-medium" htmlFor="processed-voice-name">
                <span>Voice Name</span>
                <Input
                  disabled={processing.saveStatus === "loading"}
                  id="processed-voice-name"
                  onChange={(event) => processing.setSaveName(event.target.value)}
                  required
                  value={processing.saveName}
                />
              </label>
              <VoicePresetToggleGroup
                disabled={processing.saveStatus === "loading"}
                id="processed-voice-preset"
                label="Voice Preset"
                onChange={processing.setSaveVoicePresetId}
                value={processing.saveVoicePresetId}
                voicePresets={voicePresets}
              />
              {processing.saveError ? (
                <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
                  <AlertTitle>Save Failed</AlertTitle>
                  <AlertDescription>{processing.saveError}</AlertDescription>
                </Alert>
              ) : null}
              {processing.saveStatus === "success" ? (
                <Alert>
                  <AlertTitle>Added To Voice Library</AlertTitle>
                  <AlertDescription>{processing.saveName.trim()} is now selected.</AlertDescription>
                </Alert>
              ) : null}
              <Button className="w-full" disabled={!processing.canSave} type="submit">
                {processing.saveStatus === "loading" ? <Loading aria-hidden="true" size="sm" /> : <Save aria-hidden="true" className="size-4" />}
                {processing.saveStatus === "loading" ? "Adding Voice" : "Add To Voice Library"}
              </Button>
            </form>
          ) : null}

          {speakerResult && processing.job ? (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3">
              <audio aria-hidden="true" ref={sourceAudioRef} src={processing.speakerSourceUrl ?? undefined} />
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">Speaker Streams</div>
                  <div className="text-xs text-muted-foreground">{speakerResult.speakers.length} Voices Detected</div>
                </div>
                <Button disabled={!processing.canSaveSelectedSpeakers} onClick={() => void processing.handleSaveSpeakerVoices()} type="button">
                  {processing.speakerSaveStatus === "loading" ? <Loading aria-hidden="true" size="sm" /> : <Save aria-hidden="true" className="size-4" />}
                  {processing.speakerSaveStatus === "loading" ? "Adding Speakers" : "Add Selected Voices"}
                </Button>
              </div>

              <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="flex flex-col gap-3">
                  {speakerResult.speakers.map((speaker, index) => {
                    const checkboxId = `speaker-save-${speaker.id}`
                    const nameInputId = `speaker-name-${speaker.id}`
                    const isSelected = processing.selectedSpeakerIds.includes(speaker.id)
                    return (
                      <article
                        className="flex flex-col gap-3 rounded-md border border-border bg-card/70 p-3"
                        key={speaker.id}
                        style={speakerStyle(index)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex min-w-0 items-center gap-2 text-sm font-medium" htmlFor={checkboxId}>
                            <Checkbox
                              checked={isSelected}
                              id={checkboxId}
                              onCheckedChange={(checked) => processing.handleSpeakerSaveSelectionChange(speaker.id, checked === true)}
                            />
                            <span className="min-w-0 truncate text-[var(--speaker-color)]">{speaker.label}</span>
                          </label>
                          <Badge variant="secondary">{speaker.transcriptItemIds.length} Segments</Badge>
                        </div>

                        {processing.speakerResultUrls[speaker.id] ? (
                          <AudioPlayer ariaLabel={`${speaker.label} preview`} src={processing.speakerResultUrls[speaker.id]} />
                        ) : null}

                        <FieldGroup>
                          <Field>
                            <FieldLabel htmlFor={nameInputId}>Voice Name</FieldLabel>
                            <Input
                              id={nameInputId}
                              onBlur={() => void processing.assignSpeakerName(speaker.id, processing.speakerNameAssignments[speaker.id] ?? "")}
                              onChange={(event) => processing.handleSpeakerNameChange(speaker.id, event.target.value)}
                              value={processing.speakerNameAssignments[speaker.id] ?? ""}
                            />
                          </Field>
                          <VoicePresetToggleGroup
                            id={`speaker-preset-${speaker.id}`}
                            label="Voice Preset"
                            onChange={(voicePresetId) => processing.handleSpeakerVoicePresetChange(speaker.id, voicePresetId)}
                            value={processing.speakerVoicePresetIds[speaker.id] ?? voicePresets[0]?.id ?? "standardNarration"}
                            voicePresets={voicePresets}
                          />
                        </FieldGroup>
                      </article>
                    )
                  })}
                </div>

                <div className="flex min-h-72 flex-col gap-2 rounded-md border border-border bg-card/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Transcript</div>
                    {processing.selectedTranscriptItemIds.length > 0 ? (
                      <Badge variant="secondary">{processing.selectedTranscriptItemIds.length} Selected</Badge>
                    ) : null}
                  </div>
                  <ScrollArea className="min-h-72 flex-1 rounded-md border border-border bg-background/70 p-3 lg:min-h-0">
                    <div className="flex flex-wrap gap-2" onPointerLeave={() => setDragStartItemId(null)}>
                      {speakerResult.transcript.items.map((item) => {
                        const speakerIndex = speakerIndexForItem(speakerResult, item)
                        const speaker = speakerResult.speakers[speakerIndex]
                        const isSelected = processing.selectedTranscriptItemIds.includes(item.id)
                        return (
                          <Popover key={item.id}>
                            <PopoverTrigger asChild>
                              <button
                                className={cn(
                                  "rounded-md border border-transparent bg-transparent px-2 py-1 text-left text-sm leading-6 text-[var(--speaker-color)] outline-none transition hover:border-border hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
                                  isSelected && "border-primary/50 bg-primary/10"
                                )}
                                onPointerDown={() => {
                                  setDragStartItemId(item.id)
                                  if (!isSelected) {
                                    processing.handleTranscriptSelectionChange([item.id])
                                  }
                                }}
                                onPointerEnter={(event) => {
                                  if (event.buttons === 1) {
                                    updateTranscriptSelectionThrough(item.id)
                                  }
                                }}
                                onPointerUp={() => setDragStartItemId(null)}
                                style={speakerStyle(speakerIndex)}
                                type="button"
                              >
                                {item.text}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-80">
                              <PopoverHeader>
                                <PopoverTitle>{speaker?.label ?? "Speaker"}</PopoverTitle>
                              </PopoverHeader>
                              <div className="mt-3 flex flex-col gap-3">
                                <Button onClick={() => playTranscriptItem(item)} size="sm" type="button" variant="secondary">
                                  <Play aria-hidden="true" className="size-4" />
                                  Play
                                </Button>
                                {speaker ? (
                                  <FieldGroup>
                                    <Field>
                                      <FieldLabel htmlFor={`transcript-name-${item.id}`}>Assign Name</FieldLabel>
                                      <div className="flex gap-2">
                                        <Input
                                          id={`transcript-name-${item.id}`}
                                          onChange={(event) => processing.handleSpeakerNameChange(speaker.id, event.target.value)}
                                          value={processing.speakerNameAssignments[speaker.id] ?? ""}
                                        />
                                        <Button
                                          onClick={() => void processing.assignSpeakerName(speaker.id, processing.speakerNameAssignments[speaker.id] ?? "")}
                                          type="button"
                                          variant="secondary"
                                        >
                                          Save
                                        </Button>
                                      </div>
                                    </Field>
                                  </FieldGroup>
                                ) : null}
                                <div className="flex flex-col gap-2">
                                  <div className="text-xs font-medium text-muted-foreground">Assign Text To Speaker</div>
                                  <div className="grid grid-cols-2 gap-2">
                                    {speakerResult.speakers.map((targetSpeaker, targetIndex) => (
                                      <Button
                                        key={targetSpeaker.id}
                                        onClick={() => {
                                          const itemIds = processing.selectedTranscriptItemIds.includes(item.id)
                                            ? processing.selectedTranscriptItemIds
                                            : [item.id]
                                          void processing.assignTranscriptItemsToSpeaker(itemIds, targetSpeaker.id)
                                        }}
                                        style={speakerStyle(targetIndex)}
                                        type="button"
                                        variant="secondary"
                                      >
                                        <span className="truncate text-[var(--speaker-color)]">{targetSpeaker.label}</span>
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              {processing.assignmentError ? (
                <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
                  <AlertTitle>Assignment Failed</AlertTitle>
                  <AlertDescription>{processing.assignmentError}</AlertDescription>
                </Alert>
              ) : null}
              {processing.speakerSaveError ? (
                <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
                  <AlertTitle>Save Failed</AlertTitle>
                  <AlertDescription>{processing.speakerSaveError}</AlertDescription>
                </Alert>
              ) : null}
              {processing.speakerSaveStatus === "success" ? (
                <Alert>
                  <AlertTitle>Added To Voice Library</AlertTitle>
                  <AlertDescription>Selected speaker voices are now available.</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function panelStatusLabel(processing: SampleProcessingController) {
  if (processing.status === "starting") {
    return "Starting"
  }
  if (processing.status === "processing") {
    return "Processing"
  }
  if (processing.status === "success") {
    return "Ready"
  }
  if (processing.status === "error") {
    return "Error"
  }
  if (processing.optionsStatus === "loading" || processing.optionsStatus === "idle") {
    return "Loading"
  }
  if (processing.enabledOperations.length === 0) {
    return "Unavailable"
  }
  return "Ready"
}

function panelElapsedTimeLabel(processing: SampleProcessingController) {
  if (processing.processingElapsedMs === null) {
    return null
  }
  const elapsedTime = formatElapsedTime(processing.processingElapsedMs)
  if (processing.status === "starting" || processing.status === "processing") {
    return `Elapsed ${elapsedTime}`
  }
  if (processing.status === "success") {
    return `Finished In ${elapsedTime}`
  }
  if (processing.status === "error") {
    return `Stopped After ${elapsedTime}`
  }
  return null
}

function presetControlLabel(operationId: SampleProcessingOperationId) {
  if (operationId === "isolateVoice") {
    return "Isolation Strength"
  }
  if (operationId === "trimSilence") {
    return "Trim Aggressiveness"
  }
  return "Processing Preset"
}

function operationDisplayLabel(operationId: SampleProcessingOperationId, label: string) {
  if (operationId === "separateSpeakers") {
    return "Speaker Separation"
  }
  return label
}

function isSampleProcessingOperationId(value: string): value is SampleProcessingOperationId {
  return value === "isolateVoice" || value === "trimSilence" || value === "separateSpeakers"
}

function isSampleProcessingPresetId(value: string): value is SampleProcessingPresetId {
  return (
    value === "fast" ||
    value === "balanced" ||
    value === "clean" ||
    value === "maxIsolation" ||
    value === "trimLight" ||
    value === "trimBalanced" ||
    value === "trimAggressive"
  )
}

function speakerIndexForItem(result: SpeakerSeparationResult, item: SpeakerTranscriptItem) {
  const index = result.speakers.findIndex((speaker) => speaker.id === item.speakerId)
  return index >= 0 ? index : 0
}

function speakerStyle(index: number): CSSProperties {
  return {
    "--speaker-color": SPEAKER_COLORS[index % SPEAKER_COLORS.length],
  } as CSSProperties
}
