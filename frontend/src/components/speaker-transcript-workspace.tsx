import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Download, Play, Save } from "lucide-react"

import { AudioPlayer } from "@/components/audio-player"
import { VoicePresetToggleGroup } from "@/components/voice-preset-toggle-group"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/loading"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { SpeakerTranscriptController } from "@/hooks/use-speaker-transcript"
import { downloadTranscript, type TranscriptExportFormat } from "@/lib/transcript-export"
import { cn } from "@/lib/utils"
import type {
  SampleProcessingJob,
  SpeakerSeparationResult,
  SpeakerSeparationSpeaker,
  SpeakerTranscriptItem,
  VoicePresetId,
} from "@/types"

type SpeakerTranscriptWorkspaceProps = {
  controller: SpeakerTranscriptController
  job: SampleProcessingJob | null
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}

const SPEAKER_COLORS = [
  "oklch(0.74 0.17 36)",
  "oklch(0.72 0.14 184)",
  "oklch(0.76 0.16 143)",
  "oklch(0.77 0.15 302)",
  "oklch(0.78 0.13 84)",
  "oklch(0.74 0.16 247)",
]

export function SpeakerTranscriptWorkspace({
  controller,
  job,
  voicePresets,
}: SpeakerTranscriptWorkspaceProps) {
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null)
  const playbackEndRef = useRef<number | null>(null)
  const [dragStartItemId, setDragStartItemId] = useState<string | null>(null)
  const [hoveredSpeakerId, setHoveredSpeakerId] = useState<string | null>(null)
  const [isSpeakerSaveDialogOpen, setSpeakerSaveDialogOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<TranscriptExportFormat>("markdown")
  const [includeStartTimes, setIncludeStartTimes] = useState(false)
  const speakerResult = controller.speakerSeparationResult
  const selectedSpeakers =
    speakerResult?.speakers.filter((speaker) => controller.selectedSpeakerIds.includes(speaker.id)) ?? []

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
  }, [controller.speakerSourceUrl])

  if (!speakerResult || !job) {
    return null
  }
  const activeJob = job
  const activeSpeakerResult = speakerResult

  function playTranscriptItem(item: SpeakerTranscriptItem) {
    const audio = sourceAudioRef.current
    if (!audio || !controller.speakerSourceUrl) {
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
      controller.handleTranscriptSelectionChange([itemId])
      return
    }
    const itemIds = speakerResult.transcript.items.map((item) => item.id)
    const startIndex = itemIds.indexOf(dragStartItemId)
    const endIndex = itemIds.indexOf(itemId)
    if (startIndex === -1 || endIndex === -1) {
      controller.handleTranscriptSelectionChange([itemId])
      return
    }
    const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
    controller.handleTranscriptSelectionChange(itemIds.slice(from, to + 1))
  }

  function handleConfirmSaveSpeakerVoices() {
    setSpeakerSaveDialogOpen(false)
    void controller.handleSaveSpeakerVoices()
  }

  function handleSpeakerNameBlur(speaker: SpeakerSeparationSpeaker) {
    const nextName = controller.speakerNameAssignments[speaker.id] ?? ""
    const currentName = speaker.assignedName ?? speaker.label
    if (nextName.trim() !== currentName.trim()) {
      void controller.assignSpeakerName(speaker.id, nextName)
    }
  }

  function handleExport() {
    downloadTranscript({
      format: exportFormat,
      includeStartTimes,
      result: activeSpeakerResult,
      sourceName: activeJob.sourceFilename || activeJob.sourceName,
      speakerNames: controller.speakerNameAssignments,
    })
  }

  return (
    <Card aria-label="Speaker Transcript Workspace" className="p-3 shadow-none sm:p-3">
      <audio aria-hidden="true" ref={sourceAudioRef} src={controller.speakerSourceUrl ?? undefined} />
      <CardHeader className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Speaker Streams</CardTitle>
          <CardDescription>{speakerResult.speakers.length} Voices Detected</CardDescription>
        </div>
        <SpeakerSaveDialog
          controller={controller}
          isOpen={isSpeakerSaveDialogOpen}
          onConfirm={handleConfirmSaveSpeakerVoices}
          onOpenChange={setSpeakerSaveDialogOpen}
          selectedSpeakers={selectedSpeakers}
          speakerResult={speakerResult}
          voicePresets={voicePresets}
        />
      </CardHeader>

      <CardContent>
        <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-3">
            {speakerResult.speakers.map((speaker, index) => {
              const checkboxId = `speaker-save-${job.id}-${speaker.id}`
              const nameInputId = `speaker-name-${job.id}-${speaker.id}`
              const isSelected = controller.selectedSpeakerIds.includes(speaker.id)
              return (
                <article
                  key={speaker.id}
                  onMouseEnter={() => setHoveredSpeakerId(speaker.id)}
                  onMouseLeave={() => setHoveredSpeakerId((current) => (current === speaker.id ? null : current))}
                  style={speakerStyle(index)}
                >
                  <Card className="flex flex-col gap-3 bg-background/70 p-3 shadow-none sm:p-3">
                    <CardHeader className="mb-0 flex-row items-start justify-between gap-3">
                      <Field className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={isSelected}
                            id={checkboxId}
                            onCheckedChange={(checked) =>
                              controller.handleSpeakerSaveSelectionChange(speaker.id, checked === true)
                            }
                          />
                          <FieldLabel className="truncate text-[var(--speaker-color)]" htmlFor={checkboxId}>
                            {speaker.label}
                          </FieldLabel>
                        </div>
                      </Field>
                      <Badge variant="secondary">{speaker.transcriptItemIds.length} Segments</Badge>
                    </CardHeader>
                    <CardContent className="gap-3">
                      {controller.speakerResultUrls[speaker.id] ? (
                        <AudioPlayer
                          ariaLabel={`${speaker.label} preview`}
                          src={controller.speakerResultUrls[speaker.id]}
                        />
                      ) : null}
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor={nameInputId}>Voice Name</FieldLabel>
                          <Input
                            id={nameInputId}
                            onBlur={() => handleSpeakerNameBlur(speaker)}
                            onChange={(event) => controller.handleSpeakerNameChange(speaker.id, event.target.value)}
                            value={controller.speakerNameAssignments[speaker.id] ?? ""}
                          />
                        </Field>
                        <VoicePresetToggleGroup
                          id={`speaker-preset-${job.id}-${speaker.id}`}
                          label="Voice Preset"
                          onChange={(voicePresetId) =>
                            controller.handleSpeakerVoicePresetChange(speaker.id, voicePresetId)
                          }
                          value={
                            controller.speakerVoicePresetIds[speaker.id] ??
                            voicePresets[0]?.id ??
                            "standardNarration"
                          }
                          voicePresets={voicePresets}
                        />
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </article>
              )
            })}
          </div>

          <Card className="flex min-h-72 flex-col bg-background/70 p-3 shadow-none sm:p-3">
            <CardHeader className="mb-2 flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">Transcript</CardTitle>
              {controller.selectedTranscriptItemIds.length > 0 ? (
                <Badge variant="secondary">{controller.selectedTranscriptItemIds.length} Selected</Badge>
              ) : null}
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              <ScrollArea className="min-h-72 flex-1 rounded-md border border-border bg-card/70 p-3 lg:min-h-0">
                <div className="flex flex-wrap gap-2 py-1" onPointerLeave={() => setDragStartItemId(null)}>
                  {speakerResult.transcript.items.map((item) => {
                    const speakerIndex = speakerIndexForItem(speakerResult, item)
                    const speaker = speakerResult.speakers[speakerIndex]
                    const isSelected = controller.selectedTranscriptItemIds.includes(item.id)
                    const isHoveredSpeaker = hoveredSpeakerId === item.speakerId
                    const draftText = controller.transcriptTextDrafts[item.id] ?? item.text
                    const isDirty = controller.unsavedTranscriptItemIds.includes(item.id)
                    return (
                      <Popover key={item.id}>
                        <PopoverTrigger asChild>
                          <button
                            className={cn(
                              "rounded-md border border-transparent bg-transparent px-2 py-1 text-left text-sm leading-6 text-[var(--speaker-color)] outline-none transition hover:border-border hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
                              isHoveredSpeaker &&
                                "lg:-translate-y-0.5 lg:border-[var(--speaker-color)] lg:bg-muted/70 lg:shadow-sm",
                              isSelected && "border-primary/50 bg-primary/10",
                              isDirty && "border-accent/60 bg-accent/10"
                            )}
                            onPointerDown={() => {
                              setDragStartItemId(item.id)
                              if (!isSelected) {
                                controller.handleTranscriptSelectionChange([item.id])
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
                            {draftText}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
                          <PopoverHeader>
                            <PopoverTitle>{speaker?.label ?? "Speaker"}</PopoverTitle>
                          </PopoverHeader>
                          <div className="mt-3 flex flex-col gap-3">
                            <Button onClick={() => playTranscriptItem(item)} size="sm" type="button" variant="secondary">
                              <Play aria-hidden="true" className="size-4" />
                              Play
                            </Button>
                            <Field>
                              <FieldLabel htmlFor={`transcript-text-${job.id}-${item.id}`}>Dialogue Text</FieldLabel>
                              <Textarea
                                className="min-h-28"
                                id={`transcript-text-${job.id}-${item.id}`}
                                onChange={(event) =>
                                  controller.handleTranscriptTextChange(item.id, event.target.value)
                                }
                                value={draftText}
                              />
                              <FieldDescription>Speaker and timing metadata remain unchanged.</FieldDescription>
                              <Button
                                disabled={
                                  !isDirty ||
                                  draftText.trim().length === 0 ||
                                  controller.transcriptSaveStatus === "loading"
                                }
                                onClick={() => void controller.saveTranscriptItems([item.id])}
                                type="button"
                              >
                                {controller.transcriptSaveStatus === "loading" ? (
                                  <Loading aria-hidden="true" size="sm" />
                                ) : (
                                  <Save aria-hidden="true" className="size-4" />
                                )}
                                {controller.transcriptSaveStatus === "loading" ? "Saving Correction" : "Save Correction"}
                              </Button>
                            </Field>
                            {speaker ? (
                              <Field>
                                <FieldLabel htmlFor={`transcript-name-${job.id}-${item.id}`}>Assign Name</FieldLabel>
                                <div className="flex gap-2">
                                  <Input
                                    id={`transcript-name-${job.id}-${item.id}`}
                                    onChange={(event) =>
                                      controller.handleSpeakerNameChange(speaker.id, event.target.value)
                                    }
                                    value={controller.speakerNameAssignments[speaker.id] ?? ""}
                                  />
                                  <Button
                                    onClick={() =>
                                      void controller.assignSpeakerName(
                                        speaker.id,
                                        controller.speakerNameAssignments[speaker.id] ?? ""
                                      )
                                    }
                                    type="button"
                                    variant="secondary"
                                  >
                                    Save
                                  </Button>
                                </div>
                              </Field>
                            ) : null}
                            <Field>
                              <FieldLabel>Assign Text To Speaker</FieldLabel>
                              <div className="grid grid-cols-2 gap-2">
                                {speakerResult.speakers.map((targetSpeaker, targetIndex) => (
                                  <Button
                                    key={targetSpeaker.id}
                                    onClick={() => {
                                      const itemIds = controller.selectedTranscriptItemIds.includes(item.id)
                                        ? controller.selectedTranscriptItemIds
                                        : [item.id]
                                      void controller.assignTranscriptItemsToSpeaker(itemIds, targetSpeaker.id)
                                    }}
                                    style={speakerStyle(targetIndex)}
                                    type="button"
                                    variant="secondary"
                                  >
                                    <span className="truncate text-[var(--speaker-color)]">
                                      {targetSpeaker.label}
                                    </span>
                                  </Button>
                                ))}
                              </div>
                            </Field>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )
                  })}
                </div>
              </ScrollArea>
            </CardContent>
            {controller.hasUnsavedTranscriptChanges ? (
              <CardFooter className="justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">
                  {controller.unsavedTranscriptItemIds.length} Unsaved Corrections
                </span>
                <Button
                  disabled={!controller.canSaveTranscript}
                  onClick={() => void controller.handleSaveTranscriptItems()}
                  type="button"
                >
                  {controller.transcriptSaveStatus === "loading" ? (
                    <Loading aria-hidden="true" size="sm" />
                  ) : (
                    <Save aria-hidden="true" className="size-4" />
                  )}
                  {controller.transcriptSaveStatus === "loading" ? "Saving Changes" : "Save Transcript Changes"}
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        </div>

        <TranscriptExportCard
          disabled={controller.hasUnsavedTranscriptChanges}
          exportFormat={exportFormat}
          includeStartTimes={includeStartTimes}
          onExport={handleExport}
          onExportFormatChange={setExportFormat}
          onIncludeStartTimesChange={setIncludeStartTimes}
        />

        {controller.assignmentError ? (
          <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
            <AlertTitle>Assignment Failed</AlertTitle>
            <AlertDescription>{controller.assignmentError}</AlertDescription>
          </Alert>
        ) : null}
        {controller.transcriptSaveError ? (
          <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
            <AlertTitle>Transcript Save Failed</AlertTitle>
            <AlertDescription>{controller.transcriptSaveError}</AlertDescription>
          </Alert>
        ) : null}
        {controller.speakerSaveError ? (
          <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
            <AlertTitle>Save Failed</AlertTitle>
            <AlertDescription>{controller.speakerSaveError}</AlertDescription>
          </Alert>
        ) : null}
        {controller.speakerSaveStatus === "success" ? (
          <Alert>
            <AlertTitle>Added To Voice Library</AlertTitle>
            <AlertDescription>Selected speaker voices are now available.</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SpeakerSaveDialog({
  controller,
  isOpen,
  onConfirm,
  onOpenChange,
  selectedSpeakers,
  speakerResult,
  voicePresets,
}: {
  controller: SpeakerTranscriptController
  isOpen: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  selectedSpeakers: SpeakerSeparationSpeaker[]
  speakerResult: SpeakerSeparationResult
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button disabled={!controller.canSaveSelectedSpeakers} type="button">
          {controller.speakerSaveStatus === "loading" ? (
            <Loading aria-hidden="true" size="sm" />
          ) : (
            <Save aria-hidden="true" className="size-4" />
          )}
          {controller.speakerSaveStatus === "loading" ? "Adding Speakers" : "Add Selected Voices"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Selected Voices To Voice Library</DialogTitle>
          <DialogDescription>
            These selected speaker streams will be added to the Voice Library as separate voices.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-60 flex-col gap-2 overflow-auto rounded-md border border-border bg-card/70 p-3">
          {selectedSpeakers.map((speaker) => {
            const speakerIndex = speakerResult.speakers.findIndex((candidate) => candidate.id === speaker.id)
            const voiceName =
              (controller.speakerNameAssignments[speaker.id] ?? "").trim() ||
              speaker.assignedName ||
              speaker.label
            const voicePresetId =
              controller.speakerVoicePresetIds[speaker.id] ?? voicePresets[0]?.id ?? "standardNarration"
            const presetLabel =
              voicePresets.find((voicePreset) => voicePreset.id === voicePresetId)?.label ?? voicePresetId
            return (
              <li
                className="flex items-start justify-between gap-3 text-sm"
                key={speaker.id}
                style={speakerStyle(speakerIndex >= 0 ? speakerIndex : 0)}
              >
                <span className="min-w-0 truncate font-medium text-[var(--speaker-color)]">{voiceName}</span>
                <span className="shrink-0 text-muted-foreground">{presetLabel}</span>
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button disabled={!controller.canSaveSelectedSpeakers} onClick={onConfirm} type="button">
            <Save aria-hidden="true" className="size-4" />
            Add To Voice Library
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TranscriptExportCard({
  disabled,
  exportFormat,
  includeStartTimes,
  onExport,
  onExportFormatChange,
  onIncludeStartTimesChange,
}: {
  disabled: boolean
  exportFormat: TranscriptExportFormat
  includeStartTimes: boolean
  onExport: () => void
  onExportFormatChange: (format: TranscriptExportFormat) => void
  onIncludeStartTimesChange: (included: boolean) => void
}) {
  return (
    <Card className="bg-background/70 p-3 shadow-none sm:p-3">
      <CardHeader className="mb-3">
        <CardTitle className="text-sm">Transcript Export</CardTitle>
        <CardDescription>Download the complete labeled dialogue in chronological order.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2" role="group" aria-labelledby="transcript-export-settings-label">
        <p className="text-sm font-medium sm:col-span-2" id="transcript-export-settings-label">
          Export Settings
        </p>
        <Field>
          <FieldLabel id="transcript-export-format-label">Document Format</FieldLabel>
          <ToggleGroup
            aria-labelledby="transcript-export-format-label"
            className="grid w-full grid-cols-2 rounded-md border border-border bg-background/60 p-1"
            onValueChange={(value) => {
              if (value === "markdown" || value === "text") {
                onExportFormatChange(value)
              }
            }}
            type="single"
            value={exportFormat}
            variant="default"
          >
            <ToggleGroupItem
              className="h-10 min-w-0 rounded border border-transparent px-3 text-center text-sm font-medium text-muted-foreground aria-checked:border-primary/60 aria-checked:bg-primary/10 aria-checked:text-foreground aria-checked:shadow-sm aria-checked:ring-1 aria-checked:ring-primary/30 aria-checked:hover:bg-primary/10"
              value="markdown"
            >
              Markdown
            </ToggleGroupItem>
            <ToggleGroupItem
              className="h-10 min-w-0 rounded border border-transparent px-3 text-center text-sm font-medium text-muted-foreground aria-checked:border-primary/60 aria-checked:bg-primary/10 aria-checked:text-foreground aria-checked:shadow-sm aria-checked:ring-1 aria-checked:ring-primary/30 aria-checked:hover:bg-primary/10"
              value="text"
            >
              TXT
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <label
            className="flex h-10 items-center gap-2 rounded-md border border-border bg-background/60 px-3 text-sm"
            htmlFor="transcript-export-start-times"
          >
            <Checkbox
              checked={includeStartTimes}
              id="transcript-export-start-times"
              onCheckedChange={(checked) => onIncludeStartTimesChange(checked === true)}
            />
            Include Timestamps
          </label>
        </Field>
      </CardContent>
      <CardFooter className="justify-between">
        <FieldDescription>
          {disabled ? "Save transcript corrections before exporting." : "Assigned names replace speaker placeholders."}
        </FieldDescription>
        <Button disabled={disabled} onClick={onExport} type="button">
          <Download aria-hidden="true" className="size-4" />
          Export Transcript
        </Button>
      </CardFooter>
    </Card>
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
