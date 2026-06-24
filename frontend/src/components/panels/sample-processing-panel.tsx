import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import {
  AudioLines,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleAlert,
  FileAudio,
  Loader2,
  Mic,
  Pause,
  Play,
  Save,
  Scissors,
  Upload,
  Users,
  Wand2,
} from "lucide-react"

import { AudioFileDropZone } from "@/components/audio-file-drop-zone"
import { AudioPlayer } from "@/components/audio-player"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { MenuSelect } from "@/components/ui/menu-select"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { VoicePresetToggleGroup } from "@/components/voice-preset-toggle-group"
import type { SampleProcessingController } from "@/hooks/use-sample-processing"
import { formatElapsedTime } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import { voicePresetLabel } from "@/lib/voice-presets"
import type {
  SampleProcessingOperationId,
  SampleProcessingPresetId,
  SampleProcessingSourcePreference,
  SpeakerSeparationResult,
  SpeakerSeparationSpeaker,
  SpeakerTranscriptItem,
  VoiceAsset,
  VoicePresetId,
} from "@/types"

type SampleProcessingPanelProps = {
  isCollapsible?: boolean
  isExpanded: boolean
  onToggleExpanded: () => void
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}

const PROCESS_FROM_DESCRIPTION = "Choose which version of this saved voice to prepare."
const PROCESS_FROM_ORIGINAL_DESCRIPTION =
  "Best for cleanup, splitting speakers, and trimming. Uses the full uploaded source when available."
const PROCESS_FROM_ORIGINAL_UNAVAILABLE_DESCRIPTION = "This saved voice does not have a retained original recording."
const PROCESS_FROM_SAVED_SAMPLE_DESCRIPTION = "Best for quick touch-ups. Uses the current library sample."
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
  const isUnavailable =
    processing.optionsStatus === "success" &&
    processing.enabledOperations.length === 0 &&
    processing.operations.length > 0
  const statusLabel = panelStatusLabel(processing)
  const elapsedTimeLabel = panelElapsedTimeLabel(processing)
  const isDetailsVisible = isExpanded || !isCollapsible

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
          <p className="mt-1 text-sm text-muted-foreground">Prepare source audio before saving it as a voice.</p>
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
              <SourceSelection processing={processing} voicePresets={voicePresets} />
              <WorkflowStackSelection processing={processing} />
            </FieldGroup>

            {processing.job ? <ProcessingProgress processing={processing} /> : null}

            {processing.error ? (
              <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
                <AlertTitle>Processing Failed</AlertTitle>
                <AlertDescription>{processing.error}</AlertDescription>
              </Alert>
            ) : null}

            <div className={cn("grid gap-2", processing.canCancel && "sm:grid-cols-[minmax(0,1fr)_auto]")}>
              <Button className="w-full" disabled={!processing.canStart} type="submit">
                {processing.isProcessing ? <Loading aria-hidden="true" size="sm" /> : <Wand2 aria-hidden="true" className="size-4" />}
                {processing.status === "starting"
                  ? "Starting Processing"
                  : processing.status === "processing"
                    ? "Processing Sample"
                    : "Start Processing"}
              </Button>
              {processing.canCancel ? (
                <Button
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void processing.handleCancelProcessing()}
                  type="button"
                  variant="secondary"
                >
                  <Ban aria-hidden="true" className="size-4" />
                  Abort
                </Button>
              ) : null}
            </div>
          </form>

          <SingleResultSave processing={processing} voicePresets={voicePresets} />
          <SpeakerResultSave processing={processing} voicePresets={voicePresets} />
        </div>
      ) : null}
    </section>
  )
}

function WorkflowStackSelection({ processing }: { processing: SampleProcessingController }) {
  const orderedOperations = orderedWorkflowOperations(processing)
  const isDisabled = processing.optionsStatus !== "success" || processing.operations.length === 0 || processing.isProcessing

  return (
    <Field>
      <FieldLabel id="sample-processing-workflow-label">Workflow Stack</FieldLabel>
      <div
        aria-labelledby="sample-processing-workflow-label"
        className="grid w-full grid-cols-1 gap-2 md:grid-cols-3"
        role="group"
      >
        {orderedOperations.map((operation) => {
          const operationCopy = operationCardCopy(operation.id)
          const isSelected = processing.selectedOperationIds.includes(operation.id)
          const descriptionId = `sample-processing-operation-${operation.id}-description`
          const selectedStep = processing.selectedWorkflowSteps.find((step) => step.operationId === operation.id)
          const presetId = selectedStep?.processingPresetId ?? operation.defaultProcessingPresetId ?? operation.processingPresets[0]?.id
          const selectedPreset = operation.processingPresets.find((preset) => preset.id === presetId) ?? null
          const Icon = operationIcon(operation.id)
          const hasPresetControls = isSelected && operation.processingPresets.length > 0

          return (
            <div
              className={cn(
                "flex h-full flex-col rounded-md border border-border bg-background/60 transition-[background-color,box-shadow]",
                hasPresetControls ? "p-2" : "p-0",
                isSelected && "border-primary/60 bg-primary/10 shadow-sm"
              )}
              key={operation.id}
            >
              <button
                aria-describedby={descriptionId}
                aria-label={operationCopy.title}
                aria-pressed={isSelected}
                className={cn(
                  "flex min-h-28 w-full flex-col items-start justify-start gap-3 rounded text-left outline-none transition-[background-color,box-shadow] hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  hasPresetControls ? "p-2" : "flex-1 p-4"
                )}
                disabled={isDisabled || !operation.enabled}
                onClick={() => processing.setWorkflowStepSelected(operation.id, !isSelected)}
                type="button"
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 truncate">{operationCopy.title}</span>
                  </span>
                  {!operation.enabled ? (
                    <Badge variant="secondary">Unavailable</Badge>
                  ) : (
                    <WorkflowSelectionIndicator isSelected={isSelected} />
                  )}
                </span>
                <span className="text-xs leading-5 text-muted-foreground" id={descriptionId}>
                  {operationCopy.description}
                </span>
              </button>
              {hasPresetControls ? (
                <Field className="mt-2" data-disabled={processing.isProcessing ? true : undefined}>
                  <Separator className="bg-border/70" />
                  <FieldLabel className="text-xs" id={`sample-processing-preset-${operation.id}-label`}>
                    {presetControlLabel(operation.id)}
                  </FieldLabel>
                  <MenuSelect
                    ariaLabel={presetControlLabel(operation.id)}
                    buttonClassName="w-full"
                    className="w-full"
                    disabled={processing.isProcessing}
                    onChange={(value) => {
                      if (isSampleProcessingPresetId(value)) {
                        processing.setProcessingPresetIdForOperation(operation.id, value)
                      }
                    }}
                    options={operation.processingPresets.map((preset) => ({ label: preset.label, value: preset.id }))}
                    value={presetId ?? ""}
                  />
                  {selectedPreset ? (
                    <FieldDescription>{selectedPreset.description}</FieldDescription>
                  ) : null}
                </Field>
              ) : null}
            </div>
          )
        })}
      </div>
    </Field>
  )
}

function WorkflowSelectionIndicator({ isSelected }: { isSelected: boolean }) {
  const SelectionIcon = isSelected ? CheckCircle2 : Circle

  return (
    <SelectionIcon
      aria-hidden="true"
      className={cn("size-5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground/70")}
    />
  )
}

function SourceSelection({
  processing,
  voicePresets,
}: {
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}) {
  return (
    <>
      <Field>
        <FieldLabel>Source</FieldLabel>
        <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background/60 p-1" role="group" aria-label="Sample source">
          <Button
            aria-pressed={processing.sourceMode === "voice"}
            className={cn(
              "transition-[background-color,box-shadow]",
              processing.sourceMode !== "voice" && "border border-transparent bg-transparent"
            )}
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
            className={cn(
              "transition-[background-color,box-shadow]",
              processing.sourceMode !== "upload" && "border border-transparent bg-transparent"
            )}
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
            <FieldLabel id="sample-processing-voice-label">Select Voice</FieldLabel>
            <SavedVoiceCarousel
              disabled={processing.isProcessing}
              onSelectVoice={processing.setSourceVoiceId}
              onUseAudioFile={() => processing.handleSourceModeChange("upload")}
              selectedVoiceId={processing.sourceVoiceId}
              voicePresets={voicePresets}
              voices={processing.sourceVoices}
            />
          </Field>
          <ProcessFromSelection processing={processing} />
        </>
      ) : (
        <AudioFileDropZone
          disabled={processing.isProcessing}
          id="sample-processing-file"
          label="Audio File"
          onFileSelect={processing.handleSourceFileSelect}
          selectedFileName={processing.sourceFile?.name ?? null}
        />
      )}
    </>
  )
}

function ProcessFromSelection({ processing }: { processing: SampleProcessingController }) {
  return (
    <Field>
      <FieldLabel id="sample-processing-source-preference-label">Process From</FieldLabel>
      <FieldDescription>{PROCESS_FROM_DESCRIPTION}</FieldDescription>
      <div
        aria-labelledby="sample-processing-source-preference-label"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        role="group"
      >
        <ProcessFromOptionCard
          description={
            processing.canUseOriginalRecording
              ? PROCESS_FROM_ORIGINAL_DESCRIPTION
              : PROCESS_FROM_ORIGINAL_UNAVAILABLE_DESCRIPTION
          }
          disabled={processing.isProcessing || !processing.canUseOriginalRecording}
          isSelected={processing.effectiveSourcePreference === "original"}
          label={processing.canUseOriginalRecording ? "Original Recording" : "Original Recording Unavailable"}
          onSelect={() => processing.setSourcePreference("original")}
          value="original"
        >
          {processing.canUseOriginalRecording ? <Badge variant="secondary">Recommended</Badge> : null}
        </ProcessFromOptionCard>
        <ProcessFromOptionCard
          description={PROCESS_FROM_SAVED_SAMPLE_DESCRIPTION}
          disabled={processing.isProcessing}
          isSelected={processing.effectiveSourcePreference === "active"}
          label="Saved Sample"
          onSelect={() => processing.setSourcePreference("active")}
          value="active"
        />
      </div>
    </Field>
  )
}

function ProcessFromOptionCard({
  children,
  description,
  disabled,
  isSelected,
  label,
  onSelect,
  value,
}: {
  children?: ReactNode
  description: string
  disabled: boolean
  isSelected: boolean
  label: string
  onSelect: () => void
  value: SampleProcessingSourcePreference
}) {
  const descriptionId = `sample-processing-process-from-${value}-description`

  return (
    <button
      aria-describedby={descriptionId}
      aria-label={label}
      aria-pressed={isSelected}
      className={cn(
        "flex min-h-28 flex-col items-start justify-between gap-3 rounded-md border border-border bg-background/60 p-3 text-left outline-none transition-[background-color,box-shadow] hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        isSelected && "border-primary bg-primary/10 hover:bg-primary/10"
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium text-foreground">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {children}
          {isSelected ? <Check aria-label="Selected process source" className="size-4 text-primary" /> : null}
        </span>
      </span>
      <span className="text-xs leading-5 text-muted-foreground" id={descriptionId}>
        {description}
      </span>
    </button>
  )
}

function SavedVoiceCarousel({
  disabled,
  onSelectVoice,
  onUseAudioFile,
  selectedVoiceId,
  voicePresets,
  voices,
}: {
  disabled: boolean
  onSelectVoice: (voiceId: string) => void
  onUseAudioFile: () => void
  selectedVoiceId: string
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
  voices: VoiceAsset[]
}) {
  const [activePreviewVoiceId, setActivePreviewVoiceId] = useState<string | null>(null)
  const handlePreviewStart = useCallback((voiceId: string) => {
    setActivePreviewVoiceId(voiceId)
  }, [])
  const handlePreviewStop = useCallback((voiceId: string) => {
    setActivePreviewVoiceId((currentVoiceId) => (currentVoiceId === voiceId ? null : currentVoiceId))
  }, [])
  const visibleActivePreviewVoiceId = disabled ? null : activePreviewVoiceId

  return (
    <div
      aria-labelledby="sample-processing-voice-label"
      className="flex gap-2 overflow-x-auto rounded-md border border-border bg-background/60 p-2"
      role="group"
    >
      {voices.length === 0 ? <SavedVoiceEmptyCard /> : null}
      {voices.map((voice) => (
        <SavedVoiceSourceCard
          disabled={disabled}
          isSelected={voice.id === selectedVoiceId}
          key={voice.id}
          activePreviewVoiceId={visibleActivePreviewVoiceId}
          onPreviewStart={handlePreviewStart}
          onPreviewStop={handlePreviewStop}
          onSelectVoice={onSelectVoice}
          voice={voice}
          voicePreset={voicePresetLabel(voicePresets, voice.voicePresetId)}
        />
      ))}
      <button
        aria-label="Use Audio File"
        className="flex min-h-32 min-w-56 snap-start flex-col items-start justify-between gap-4 rounded-md border border-dashed border-border bg-background/70 p-3 text-left outline-none transition-[background-color,box-shadow] hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={onUseAudioFile}
        type="button"
      >
        <span className="flex w-full items-start justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
            <Upload aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <span className="truncate">Use Audio File</span>
          </span>
        </span>
        <span className="text-xs leading-5 text-muted-foreground">
          Upload a source sample instead of choosing a saved voice.
        </span>
      </button>
    </div>
  )
}

function SavedVoiceEmptyCard() {
  return (
    <div className="flex min-h-32 min-w-64 snap-start flex-col justify-center gap-2 rounded-md border border-dashed border-border bg-background/50 p-3">
      <span className="text-sm font-medium text-foreground">No Saved Voices</span>
      <FieldDescription>Upload an audio file to prepare a sample without saving a voice first.</FieldDescription>
    </div>
  )
}

function SavedVoiceSourceCard({
  activePreviewVoiceId,
  disabled,
  isSelected,
  onPreviewStart,
  onPreviewStop,
  onSelectVoice,
  voice,
  voicePreset,
}: {
  activePreviewVoiceId: string | null
  disabled: boolean
  isSelected: boolean
  onPreviewStart: (voiceId: string) => void
  onPreviewStop: (voiceId: string) => void
  onSelectVoice: (voiceId: string) => void
  voice: VoiceAsset
  voicePreset: string
}) {
  const descriptionId = `sample-processing-source-voice-${voice.id}-description`
  const sourceLabel = voice.source === "default" ? "Default" : "Uploaded"
  const fileLabel = voice.sourceFilePath ?? voice.filePath

  return (
    <div
      aria-label={`${voice.name} Source Voice`}
      className={cn(
        "relative min-h-32 min-w-64 snap-start rounded-md border border-border bg-background/70 p-1 transition-[background-color,box-shadow] hover:bg-muted/50",
        isSelected && "border-primary bg-primary/10 hover:bg-primary/10"
      )}
      role="group"
    >
      <button
        aria-describedby={descriptionId}
        aria-label={`Select ${voice.name}`}
        aria-pressed={isSelected}
        className="flex size-full min-h-28 flex-col items-start justify-between gap-3 rounded px-2 py-2 pr-12 text-left outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => onSelectVoice(voice.id)}
        type="button"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="line-clamp-2 text-sm font-medium text-foreground">{voice.name}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge className="px-1.5 py-0.5" variant="secondary">
              {voicePreset}
            </Badge>
            <Badge className="px-1.5 py-0.5" variant="secondary">
              {sourceLabel}
            </Badge>
          </span>
        </span>
        <span className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground" id={descriptionId}>
          Source: {fileLabel}
        </span>
        {isSelected ? <Check aria-label="Selected voice" className="absolute right-3 top-3 size-4 text-primary" /> : null}
      </button>
      <CompactVoicePreviewButton
        activePreviewVoiceId={activePreviewVoiceId}
        disabled={disabled}
        onPreviewStart={onPreviewStart}
        onPreviewStop={onPreviewStop}
        voice={voice}
      />
    </div>
  )
}

function CompactVoicePreviewButton({
  activePreviewVoiceId,
  disabled,
  onPreviewStart,
  onPreviewStop,
  voice,
}: {
  activePreviewVoiceId: string | null
  disabled: boolean
  onPreviewStart: (voiceId: string) => void
  onPreviewStop: (voiceId: string) => void
  voice: VoiceAsset
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hasActivePlaybackRef = useRef(false)
  const isPlaying = activePreviewVoiceId === voice.id

  const stopPreview = useCallback(
    ({ reset = false, updateActive = true }: { reset?: boolean; updateActive?: boolean } = {}) => {
      const audio = audioRef.current
      if (audio && hasActivePlaybackRef.current) {
        audio.pause()
        if (reset) {
          audio.currentTime = 0
        }
      }
      hasActivePlaybackRef.current = false
      if (updateActive) {
        onPreviewStop(voice.id)
      }
    },
    [onPreviewStop, voice.id]
  )

  useEffect(() => {
    if (disabled && hasActivePlaybackRef.current) {
      stopPreview({ reset: true, updateActive: false })
    }
  }, [disabled, stopPreview])

  useEffect(() => {
    if (!isPlaying && hasActivePlaybackRef.current) {
      stopPreview({ reset: true, updateActive: false })
    }
  }, [isPlaying, stopPreview])

  useEffect(
    () => {
      const audio = audioRef.current
      return () => {
        if (audio && hasActivePlaybackRef.current) {
          audio.pause()
          audio.currentTime = 0
          hasActivePlaybackRef.current = false
        }
      }
    },
    []
  )

  async function handlePreviewToggle() {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    if (isPlaying) {
      stopPreview()
      return
    }

    try {
      onPreviewStart(voice.id)
      hasActivePlaybackRef.current = true
      await audio.play()
    } catch {
      hasActivePlaybackRef.current = false
      onPreviewStop(voice.id)
    }
  }

  return (
    <>
      <audio
        onEnded={() => {
          hasActivePlaybackRef.current = false
          onPreviewStop(voice.id)
        }}
        onPause={() => {
          hasActivePlaybackRef.current = false
          onPreviewStop(voice.id)
        }}
        onPlay={() => {
          hasActivePlaybackRef.current = true
          onPreviewStart(voice.id)
        }}
        preload="none"
        ref={audioRef}
        src={`/api/voices/${encodeURIComponent(voice.id)}/sample`}
      />
      <Button
        aria-label={`${isPlaying ? "Pause" : "Play"} ${voice.name} Preview`}
        className="absolute bottom-3 right-3 size-8"
        disabled={disabled}
        onClick={handlePreviewToggle}
        size="icon"
        type="button"
        variant="secondary"
      >
        {isPlaying ? <Pause aria-hidden="true" data-icon="inline-start" /> : <Play aria-hidden="true" data-icon="inline-start" />}
      </Button>
    </>
  )
}

function ProcessingProgress({ processing }: { processing: SampleProcessingController }) {
  const steps = processing.job?.steps ?? []
  if (steps.length === 0) {
    return null
  }

  return (
    <section aria-label="Sample Processing Progress" className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium">Workflow Progress</div>
        {processing.activeStep ? (
          <Badge variant="secondary">Active Step: {processing.activeStep.operationLabel}</Badge>
        ) : null}
      </div>
      <ol className="mt-3 grid gap-2">
        {steps.map((step, index) => {
          const StepIcon = stepStatusIcon(step.status)
          return (
            <li
              className={cn(
                "flex items-start gap-3 rounded-md border border-border bg-card/70 p-3",
                step.id === processing.job?.activeStepId && "border-primary/60 bg-primary/10"
              )}
              key={step.id}
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-medium">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{step.operationLabel}</span>
                  <Badge
                    className={cn(
                      step.status === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
                      step.status === "canceled" && "border-destructive/40 bg-destructive/10 text-destructive"
                    )}
                    variant={step.status === "success" ? "accent" : "secondary"}
                  >
                    <StepIcon aria-hidden="true" className={cn("size-3", step.status === "running" && "animate-spin")} />
                    {stepStatusLabel(step.status)}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {step.processingPresetLabel ? <span>{step.processingPresetLabel}</span> : null}
                  {step.engine ? <span>{step.engine}</span> : null}
                  {step.error ? <span className="text-destructive">{step.error}</span> : null}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function SingleResultSave({
  processing,
  voicePresets,
}: {
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}) {
  if (!processing.resultUrl || !processing.job) {
    return null
  }

  return (
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
  )
}

function SpeakerResultSave({
  processing,
  voicePresets,
}: {
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}) {
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null)
  const playbackEndRef = useRef<number | null>(null)
  const [dragStartItemId, setDragStartItemId] = useState<string | null>(null)
  const [hoveredSpeakerId, setHoveredSpeakerId] = useState<string | null>(null)
  const [isSpeakerSaveDialogOpen, setSpeakerSaveDialogOpen] = useState(false)
  const speakerResult = processing.speakerSeparationResult
  const selectedSpeakers = speakerResult?.speakers.filter((speaker) => processing.selectedSpeakerIds.includes(speaker.id)) ?? []

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

  if (!speakerResult || !processing.job) {
    return null
  }

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

  function handleConfirmSaveSpeakerVoices() {
    setSpeakerSaveDialogOpen(false)
    void processing.handleSaveSpeakerVoices()
  }

  function handleSpeakerNameBlur(speaker: SpeakerSeparationSpeaker) {
    const nextName = processing.speakerNameAssignments[speaker.id] ?? ""
    const currentName = speaker.assignedName ?? speaker.label
    if (nextName.trim() !== currentName.trim()) {
      void processing.assignSpeakerName(speaker.id, nextName)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3">
      <audio aria-hidden="true" ref={sourceAudioRef} src={processing.speakerSourceUrl ?? undefined} />
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium">Speaker Streams</div>
          <div className="text-xs text-muted-foreground">{speakerResult.speakers.length} Voices Detected</div>
        </div>
        <Dialog open={isSpeakerSaveDialogOpen} onOpenChange={setSpeakerSaveDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={!processing.canSaveSelectedSpeakers} type="button">
              {processing.speakerSaveStatus === "loading" ? <Loading aria-hidden="true" size="sm" /> : <Save aria-hidden="true" className="size-4" />}
              {processing.speakerSaveStatus === "loading" ? "Adding Speakers" : "Add Selected Voices"}
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
                const voiceName = (processing.speakerNameAssignments[speaker.id] ?? "").trim() || speaker.assignedName || speaker.label
                const voicePresetId = processing.speakerVoicePresetIds[speaker.id] ?? voicePresets[0]?.id ?? "standardNarration"
                const voicePresetLabel = voicePresets.find((voicePreset) => voicePreset.id === voicePresetId)?.label ?? voicePresetId
                return (
                  <li className="flex items-start justify-between gap-3 text-sm" key={speaker.id} style={speakerStyle(speakerIndex >= 0 ? speakerIndex : 0)}>
                    <span className="min-w-0 truncate font-medium text-[var(--speaker-color)]">{voiceName}</span>
                    <span className="shrink-0 text-muted-foreground">{voicePresetLabel}</span>
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
              <Button disabled={!processing.canSaveSelectedSpeakers} onClick={handleConfirmSaveSpeakerVoices} type="button">
                <Save aria-hidden="true" className="size-4" />
                Add To Voice Library
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
                onMouseEnter={() => setHoveredSpeakerId(speaker.id)}
                onMouseLeave={() => setHoveredSpeakerId((current) => (current === speaker.id ? null : current))}
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
                      onBlur={() => handleSpeakerNameBlur(speaker)}
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
            <div className="flex flex-wrap gap-2 py-1" onPointerLeave={() => setDragStartItemId(null)}>
              {speakerResult.transcript.items.map((item) => {
                const speakerIndex = speakerIndexForItem(speakerResult, item)
                const speaker = speakerResult.speakers[speakerIndex]
                const isSelected = processing.selectedTranscriptItemIds.includes(item.id)
                const isHoveredSpeaker = hoveredSpeakerId === item.speakerId
                return (
                  <Popover key={item.id}>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "rounded-md border border-transparent bg-transparent px-2 py-1 text-left text-sm leading-6 text-[var(--speaker-color)] outline-none transition hover:border-border hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
                          isHoveredSpeaker && "lg:-translate-y-0.5 lg:border-[var(--speaker-color)] lg:bg-muted/70 lg:shadow-sm",
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
  if (processing.status === "canceled") {
    return "Canceled"
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
  if (processing.status === "canceled") {
    return `Canceled After ${elapsedTime}`
  }
  return null
}

function orderedWorkflowOperations(processing: SampleProcessingController) {
  const operationById = new Map(processing.operations.map((operation) => [operation.id, operation]))
  const ordered = processing.recommendedWorkflowOrder
    .map((operationId) => operationById.get(operationId))
    .filter((operation): operation is SampleProcessingController["operations"][number] => Boolean(operation))
  const remaining = processing.operations.filter((operation) => !processing.recommendedWorkflowOrder.includes(operation.id))
  return [...ordered, ...remaining]
}

function operationIcon(operationId: SampleProcessingOperationId) {
  if (operationId === "isolateVoice") {
    return Mic
  }
  if (operationId === "separateSpeakers") {
    return Users
  }
  return Scissors
}

function stepStatusIcon(status: string) {
  if (status === "success") {
    return CheckCircle2
  }
  if (status === "running") {
    return Loader2
  }
  if (status === "error" || status === "canceled") {
    return CircleAlert
  }
  return Circle
}

function stepStatusLabel(status: string) {
  if (status === "pending") {
    return "Queued"
  }
  if (status === "running") {
    return "Running"
  }
  if (status === "success") {
    return "Complete"
  }
  if (status === "error") {
    return "Error"
  }
  if (status === "canceled") {
    return "Canceled"
  }
  return status
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

function operationCardCopy(operationId: SampleProcessingOperationId) {
  switch (operationId) {
    case "isolateVoice":
      return {
        description: "Pull the spoken voice forward and reduce background audio.",
        title: "Clean Up Voice",
      }
    case "trimSilence":
      return {
        description: "Remove long quiet stretches so the sample starts, ends, and flows cleanly.",
        title: "Tighten Pauses",
      }
    case "separateSpeakers":
      return {
        description: "Find each speaker in a conversation and create separate voice streams.",
        title: "Split Speakers",
      }
    default: {
      const unhandledOperationId: never = operationId
      throw new Error(`Unhandled sample processing operation: ${unhandledOperationId}`)
    }
  }
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
