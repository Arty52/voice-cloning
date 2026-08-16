import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react"
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
  Sparkles,
  Upload,
  Users,
  Video,
  Wand2,
} from "lucide-react"

import { MediaFileDropZone } from "@/components/media-file-drop-zone"
import { PlaybackControls } from "@/components/audio-player"
import { ProcessingTimeEstimate } from "@/components/processing-time-estimate"
import { SpeakerTranscriptWorkspace } from "@/components/speaker-transcript-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/loading"
import { MenuSelect } from "@/components/ui/menu-select"
import { PendingWorkStatus } from "@/components/ui/pending-work-status"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { VoicePresetToggleGroup } from "@/components/voice-preset-toggle-group"
import { usePrepareAudioPlayback } from "@/hooks/use-prepare-audio-playback"
import type { SampleProcessingController } from "@/hooks/use-sample-processing"
import { formatCompactBytes, formatElapsedTime, formatMediaDuration } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import { voicePresetLabel } from "@/lib/voice-presets"
import type {
  PreparedSampleCandidate,
  SampleProcessingOperationId,
  SampleProcessingPresetId,
  SampleProcessingSourcePreference,
  VoiceAsset,
  VoicePresetId,
} from "@/types"

type SampleProcessingPanelProps = {
  attentionRef?: RefObject<HTMLDivElement | null>
  isCollapsible?: boolean
  isExpanded: boolean
  onAttentionRequest?: () => void
  onToggleExpanded: () => void
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}

const PROCESS_FROM_DESCRIPTION = "Choose which version of this saved voice to prepare."
const PROCESS_FROM_ORIGINAL_DESCRIPTION =
  "Best for cleanup, splitting speakers, and trimming. Uses the full uploaded source when available."
const PROCESS_FROM_ORIGINAL_UNAVAILABLE_DESCRIPTION = "This saved voice does not have a retained original recording."
const PROCESS_FROM_SAVED_SAMPLE_DESCRIPTION = "Best for quick touch-ups. Uses the current library sample."
const PROCESS_AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.m4b,.aac,.ogg,.flac"
const PROCESS_AUDIO_UPLOAD_HELPER_COPY =
  "Drag an audio file here, or choose one from your computer. Supports MP3, WAV, M4A, M4B, AAC, OGG, and FLAC."
const PROCESS_VIDEO_ACCEPT = ".mp4,.m4v,.mov,video/mp4,video/x-m4v,video/quicktime"
const PROCESS_VIDEO_UPLOAD_HELPER_COPY =
  "Drag a video file here, or choose one from your computer. Supports MP4, M4V, and MOV."
const SPEAKER_COLORS = [
  "oklch(0.74 0.17 36)",
  "oklch(0.72 0.14 184)",
  "oklch(0.76 0.16 143)",
  "oklch(0.77 0.15 302)",
  "oklch(0.78 0.13 84)",
  "oklch(0.74 0.16 247)",
]

function noopAttentionRequest() {
  return undefined
}

export function SampleProcessingPanel({
  attentionRef,
  isCollapsible = true,
  isExpanded,
  onAttentionRequest = noopAttentionRequest,
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
  const playback = usePrepareAudioPlayback({
    candidateResultUrls: processing.candidateResultUrls,
    isActive: isDetailsVisible,
    jobId: processing.job?.id ?? null,
    processedResultUrl: processing.resultUrl,
    sourcePreview: processing.mediaSource.preview,
    voices: processing.sourceVoices,
  })

  function handleStartProcessing(event: FormEvent<HTMLFormElement>) {
    if (processing.canStart) {
      onAttentionRequest()
    }
    processing.handleStartProcessing(event)
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
          <p className="mt-1 text-sm text-muted-foreground">Prepare source media before saving it as a voice.</p>
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
        <div className="mt-4 flex flex-col gap-4">
          {processing.optionsStatus === "loading" ? (
            <PendingWorkStatus
              aria-label="Loading Processing Options"
              description="Checking available local processing operations."
              statusLabel="Loading"
              title="Loading Processing Options"
            />
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

          <form className="flex flex-col gap-3" onSubmit={handleStartProcessing}>
            <FieldGroup>
              <SourceSelection playback={playback} processing={processing} voicePresets={voicePresets} />
              <WorkflowStackSelection processing={processing} />
              <PrepareAdvancedOptions processing={processing} />
            </FieldGroup>

            <div className="flex flex-col gap-4 scroll-mt-4" ref={attentionRef}>
              {processing.job ? <ProcessingProgress processing={processing} /> : null}

              {processing.error ? (
                <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
                  <AlertTitle>Processing Failed</AlertTitle>
                  <AlertDescription>{processing.error}</AlertDescription>
                </Alert>
              ) : null}
            </div>

            <div className={cn("grid gap-2", processing.canCancel && "sm:grid-cols-[minmax(0,1fr)_auto]")}>
              <Button className="w-full" disabled={!processing.canStart} type="submit">
                {processing.isProcessing ? <Loading aria-hidden="true" size="sm" /> : <Wand2 aria-hidden="true" className="size-4" />}
                {processing.status === "starting"
                  ? "Starting Processing"
                  : processing.status === "processing"
                      ? "Processing Sample"
                    : processing.isPrepareVoiceSelected
                      ? "Process Source Media"
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

          <SingleResultSave playback={playback} processing={processing} voicePresets={voicePresets} />
          <PreparedCandidateResultSave playback={playback} processing={processing} voicePresets={voicePresets} />
          <SpeakerTranscriptWorkspace controller={processing} job={processing.job} voicePresets={voicePresets} />
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
        className="grid w-full grid-cols-1 gap-2 md:grid-cols-4"
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

function PrepareAdvancedOptions({ processing }: { processing: SampleProcessingController }) {
  if (!processing.isPrepareVoiceSelected) {
    return null
  }

  return (
    <Field>
      <FieldLabel>Easy Prepare</FieldLabel>
      <FieldDescription>
        Runs selected cleanup first, then detects speech regions, ranks provider-sized windows, and creates mono 16 kHz
        WAV candidates for review. Local source uploads default to a 1 GB cap; speaker detection requires diarization.
      </FieldDescription>
      <div className="grid gap-2 md:grid-cols-3">
        <PrepareToggle
          checked={processing.prepareCleanVoice && processing.canCleanVoice}
          disabled={processing.isProcessing || !processing.canCleanVoice}
          id="prepare-clean-voice"
          label="Clean Voice"
          onCheckedChange={processing.setPrepareCleanVoice}
        />
        <PrepareToggle
          checked={processing.prepareTrimCandidates}
          disabled={processing.isProcessing}
          id="prepare-trim-candidates"
          label="Trim Non-Spoken Audio"
          onCheckedChange={processing.setPrepareTrimCandidates}
        />
        <PrepareToggle
          checked={processing.prepareDetectSpeakers && processing.canDetectSpeakers}
          disabled={processing.isProcessing || !processing.canDetectSpeakers}
          id="prepare-detect-speakers"
          label="Detect Speakers"
          onCheckedChange={processing.setPrepareDetectSpeakers}
        />
      </div>
      <PreparePresetControls processing={processing} />
      {processing.prepareEstimateRangeSeconds ? (
        <ProcessingTimeEstimate
          range={processing.prepareEstimateRangeSeconds}
          sourceSizeBytes={
            processing.sourceMode === "upload" && processing.sourceFile ? processing.sourceFile.size : null
          }
        />
      ) : null}
    </Field>
  )
}

function PreparePresetControls({ processing }: { processing: SampleProcessingController }) {
  const isolationOperation = processing.prepareIsolationOperation
  const trimOperation = processing.prepareTrimOperation
  const canShowIsolationPreset = Boolean(isolationOperation?.processingPresets.length)
  const canShowTrimPreset = Boolean(trimOperation?.processingPresets.length)

  if (!canShowIsolationPreset && !canShowTrimPreset) {
    return null
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {canShowIsolationPreset && isolationOperation ? (
        <PreparePresetSelect
          description={
            isolationOperation.processingPresets.find((preset) => preset.id === processing.prepareIsolationPresetId)
              ?.description ?? "Default vocal isolation quality and runtime."
          }
          disabled={processing.isProcessing || !processing.prepareCleanVoice || !processing.canCleanVoice}
          label="Isolation Strength"
          onChange={(value) => processing.setProcessingPresetIdForOperation("isolateVoice", value)}
          options={isolationOperation.processingPresets.map((preset) => ({ label: preset.label, value: preset.id }))}
          value={processing.prepareIsolationPresetId}
        />
      ) : null}
      {canShowTrimPreset && trimOperation ? (
        <PreparePresetSelect
          description={
            trimOperation.processingPresets.find((preset) => preset.id === processing.prepareTrimPresetId)?.description ??
            "Default silence trimming with a small amount of preserved room tone."
          }
          disabled={processing.isProcessing || !processing.prepareTrimCandidates}
          label="Trim Aggressiveness"
          onChange={(value) => processing.setProcessingPresetIdForOperation("trimSilence", value)}
          options={trimOperation.processingPresets.map((preset) => ({ label: preset.label, value: preset.id }))}
          value={processing.prepareTrimPresetId}
        />
      ) : null}
    </div>
  )
}

function PreparePresetSelect({
  description,
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  description: string
  disabled: boolean
  label: string
  onChange: (value: SampleProcessingPresetId) => void
  options: { label: string; value: SampleProcessingPresetId }[]
  value: SampleProcessingPresetId
}) {
  return (
    <Field data-disabled={disabled ? true : undefined}>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <MenuSelect
        ariaLabel={label}
        buttonClassName="w-full"
        className="w-full"
        disabled={disabled}
        onChange={(nextValue) => {
          if (isSampleProcessingPresetId(nextValue)) {
            onChange(nextValue)
          }
        }}
        options={options}
        value={value}
      />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}

function PrepareToggle({
  checked,
  disabled,
  id,
  label,
  onCheckedChange,
}: {
  checked: boolean
  disabled: boolean
  id: string
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-md border border-border bg-background/60 p-3 text-sm font-medium",
        checked && "border-primary/60 bg-primary/10",
        disabled && "cursor-not-allowed opacity-60"
      )}
      htmlFor={id}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span>{label}</span>
    </label>
  )
}

function SourceSelection({
  playback,
  processing,
  voicePresets,
}: {
  playback: ReturnType<typeof usePrepareAudioPlayback>
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}) {
  const sourceSelectionValue = processing.sourceMode === "voice" ? "voice" : processing.sourceUploadKind
  const uploadCopy = sourceUploadCopy(processing.sourceUploadKind)

  return (
    <>
      <Field>
        <FieldLabel>Source</FieldLabel>
        <ToggleGroup
          aria-label="Sample Source"
          className="grid w-full grid-cols-1 gap-1 rounded-md border border-border bg-background/60 p-1 sm:grid-cols-3"
          onValueChange={(value) => {
            if (value === "voice") {
              processing.handleSourceModeChange("voice")
            }
            if (value === "audio" || value === "video") {
              processing.setSourceUploadKind(value)
            }
          }}
          type="single"
          value={sourceSelectionValue}
        >
          <ToggleGroupItem
            className="h-9 justify-center gap-2"
            disabled={processing.isProcessing}
            value="voice"
          >
            <FileAudio aria-hidden="true" data-icon="inline-start" />
            Saved Voice
          </ToggleGroupItem>
          <ToggleGroupItem
            className="h-9 justify-center gap-2"
            disabled={processing.isProcessing}
            value="audio"
          >
            <Upload aria-hidden="true" data-icon="inline-start" />
            Audio File
          </ToggleGroupItem>
          <ToggleGroupItem
            className="h-9 justify-center gap-2"
            disabled={processing.isProcessing}
            value="video"
          >
            <Video aria-hidden="true" data-icon="inline-start" />
            Video File
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>

      {processing.sourceMode === "voice" ? (
        <>
          <Field>
            <FieldLabel id="sample-processing-voice-label">Select Voice</FieldLabel>
            <SavedVoiceCarousel
              disabled={processing.isProcessing}
              onSelectVoice={processing.setSourceVoiceId}
              onUseAudioFile={() => processing.handleSourceModeChange("upload")}
              playback={playback}
              selectedVoiceId={processing.sourceVoiceId}
              voicePresets={voicePresets}
              voices={processing.sourceVoices}
            />
          </Field>
          <ProcessFromSelection processing={processing} />
        </>
      ) : (
        <>
          <MediaFileDropZone
            accept={uploadCopy.accept}
            ariaLabel={uploadCopy.dropZoneLabel}
            chooseLabel={uploadCopy.chooseLabel}
            disabled={processing.isProcessing}
            emptyLabel={uploadCopy.emptyLabel}
            helperCopy={uploadCopy.helperCopy}
            id="sample-processing-file"
            label={uploadCopy.label}
            onFileSelect={processing.handleSourceFileSelect}
            selectedFileName={processing.sourceFile?.name ?? processing.mediaSource.source?.filename ?? null}
            selectedLabel={uploadCopy.selectedLabel}
          />
          <MediaSourceSelection playback={playback} processing={processing} />
        </>
      )}
    </>
  )
}

function sourceUploadCopy(kind: "audio" | "video") {
  if (kind === "video") {
    return {
      accept: PROCESS_VIDEO_ACCEPT,
      chooseLabel: "Choose Video",
      dropZoneLabel: "Video Drop Zone",
      emptyLabel: "Drop Video Here",
      helperCopy: PROCESS_VIDEO_UPLOAD_HELPER_COPY,
      label: "Video File",
      selectedLabel: "Video Selected",
    }
  }
  return {
    accept: PROCESS_AUDIO_ACCEPT,
    chooseLabel: "Choose Audio",
    dropZoneLabel: "Audio Drop Zone",
    emptyLabel: "Drop Audio Here",
    helperCopy: PROCESS_AUDIO_UPLOAD_HELPER_COPY,
    label: "Audio File",
    selectedLabel: "Audio Selected",
  }
}

function MediaSourceSelection({
  playback,
  processing,
}: {
  playback: ReturnType<typeof usePrepareAudioPlayback>
  processing: SampleProcessingController
}) {
  const media = processing.mediaSource
  const source = media.source
  const [failedVideoSourceId, setFailedVideoSourceId] = useState<string | null>(null)

  if (media.status === "idle" && source === null && !processing.sourceFile) {
    return null
  }

  return (
    <Field>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <FieldLabel>Source Selection</FieldLabel>
          <FieldDescription>
            Select only the media portion to pre-process. Preview clips are capped for responsiveness.
          </FieldDescription>
        </div>
        {source ? (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Badge variant="secondary">{source.mediaKind === "video" ? "Video" : "Audio"}</Badge>
            <Badge variant="secondary">{formatCompactBytes(source.sizeBytes)}</Badge>
            {source.durationSeconds !== null ? (
              <Badge variant="secondary">{formatMediaDuration(source.durationSeconds)}</Badge>
            ) : null}
            {source.mediaKind === "video" && source.selectedAudioStreamIndex !== null ? (
              <Badge variant="secondary">Audio Stream {source.selectedAudioStreamIndex}</Badge>
            ) : null}
            {source.chapters.length > 0 ? (
              <Badge variant="secondary">{source.chapters.length} Chapters</Badge>
            ) : null}
          </div>
        ) : null}
      </div>

      {media.status === "loading" ? (
        <PendingWorkStatus
          aria-label="Inspecting Source"
          description="Reading duration, chapters, audio streams, and preview details."
          statusLabel="Inspecting"
          title="Inspecting Source"
        />
      ) : null}

      {media.error ? (
        <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
          <AlertTitle>Source Inspection Failed</AlertTitle>
          <AlertDescription>{media.error}</AlertDescription>
        </Alert>
      ) : null}

      {source ? (
        <>
          {source.warnings.length > 0 ? (
            <Alert>
              <AlertTitle>Source Warnings</AlertTitle>
              <AlertDescription>{source.warnings.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          {source.mediaKind === "video" ? (
            <VideoSourcePreview
              failed={failedVideoSourceId === source.id}
              onError={() => setFailedVideoSourceId(source.id)}
              sourceLabel={source.filename}
              src={media.sourceMediaUrl}
            />
          ) : null}

          {media.hasChapters ? (
            <ChapterSourceSelection processing={processing} />
          ) : (
            <ManualSourceRangeSelection processing={processing} />
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Selected {formatMediaDuration(media.selectedDurationSeconds)}</Badge>
            <span className="min-w-0 truncate">{source.filename}</span>
          </div>

          {media.preview ? (
            <div className="rounded-md border border-border bg-background/60 p-3">
              <div className="mb-2 text-sm font-medium">{media.preview.label} Preview</div>
              {playback.sources.get("source-preview") ? (
                <PlaybackControls
                  ariaLabel={`${media.preview.label} preview`}
                  controller={playback.controller}
                  onActivate={() => playback.activate("source-preview")}
                  source={playback.sources.get("source-preview")!}
                />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </Field>
  )
}

function VideoSourcePreview({
  failed,
  onError,
  sourceLabel,
  src,
}: {
  failed: boolean
  onError: () => void
  sourceLabel: string
  src: string | null
}) {
  if (!src || failed) {
    return (
      <Alert>
        <AlertTitle>Video Preview Unavailable</AlertTitle>
        <AlertDescription>The staged video is still available for range selection and background extraction.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Video Preview</div>
        <Badge variant="secondary">Browser Playback</Badge>
      </div>
      <video
        aria-label={`${sourceLabel} Video Preview`}
        className="aspect-video w-full rounded-md border border-border bg-background object-contain"
        controls
        onError={onError}
        preload="metadata"
        src={src}
      />
    </div>
  )
}

function ChapterSourceSelection({ processing }: { processing: SampleProcessingController }) {
  const media = processing.mediaSource
  const source = media.source
  if (!source) {
    return null
  }
  const selectedIds = new Set(media.selectedChapterIds)
  const hasScrollableChapterList = source.chapters.length > 4

  return (
    <div className="rounded-md border border-border bg-background/60">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="text-sm font-medium">Chapters</div>
        <Badge variant="secondary">{media.selectedChapterIds.length} Selected</Badge>
      </div>
      <ScrollArea
        aria-label="Chapter List"
        className={cn(hasScrollableChapterList ? "h-72" : "max-h-72")}
        role="region"
      >
        <div className="flex flex-col gap-2 p-2">
          {source.chapters.map((chapter) => {
            const checkboxId = `media-source-chapter-${chapter.id}`
            const isSelected = selectedIds.has(chapter.id)
            return (
              <div
                className={cn(
                  "grid gap-3 rounded-md border border-border bg-card/70 p-3 sm:grid-cols-[minmax(0,1fr)_auto]",
                  isSelected && "border-primary/60 bg-primary/10"
                )}
                key={chapter.id}
              >
                <label className="flex min-w-0 items-start gap-3" htmlFor={checkboxId}>
                  <Checkbox
                    checked={isSelected}
                    disabled={processing.isProcessing}
                    id={checkboxId}
                    onCheckedChange={(checked) => media.setChapterSelected(chapter.id, checked === true)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{chapter.title}</span>
                    <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>Starts {formatMediaDuration(chapter.startSeconds)}</span>
                      <span>Ends {formatMediaDuration(chapter.endSeconds)}</span>
                      <span>Duration {formatMediaDuration(chapter.durationSeconds)}</span>
                    </span>
                  </span>
                </label>
                <Button
                  disabled={processing.isProcessing}
                  onClick={() => media.showPreview(chapter, chapter.title)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Play aria-hidden="true" data-icon="inline-start" />
                  Play Preview
                </Button>
              </div>
            )
          })}
        </div>
      </ScrollArea>
      {media.selectedChapterIds.length === 0 ? (
        <div className="flex items-start gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Select at least one chapter before starting.
        </div>
      ) : null}
    </div>
  )
}

function ManualSourceRangeSelection({ processing }: { processing: SampleProcessingController }) {
  const media = processing.mediaSource
  const source = media.source
  if (!source) {
    return null
  }
  const range = media.manualRange

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium">Manual Range</div>
        <Badge variant="secondary">
          {formatMediaDuration(range.startSeconds)} to {formatMediaDuration(range.endSeconds)}
        </Badge>
      </div>
      {source.durationSeconds === null ? (
        <Alert>
          <AlertTitle>Duration Unavailable</AlertTitle>
          <AlertDescription>
            Metadata did not include a duration, so the range selector uses the first five minutes.
          </AlertDescription>
        </Alert>
      ) : null}
      <Slider
        aria-label="Manual source range"
        disabled={processing.isProcessing}
        max={media.manualDurationSeconds}
        min={0}
        onValueChange={(value) => {
          const [startSeconds = 0, endSeconds = media.manualDurationSeconds] = value
          media.setManualRangeSeconds({ startSeconds, endSeconds })
        }}
        step={1}
        value={[range.startSeconds, range.endSeconds]}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <Badge variant="secondary">Start {formatMediaDuration(range.startSeconds)}</Badge>
          <Badge variant="secondary">End {formatMediaDuration(range.endSeconds)}</Badge>
          <Badge variant="secondary">
            Duration {formatMediaDuration(Math.max(0, range.endSeconds - range.startSeconds))}
          </Badge>
        </div>
        <Button
          disabled={processing.isProcessing}
          onClick={() => media.showPreview({ ...range, label: "Selected Range" }, "Selected Range")}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Play aria-hidden="true" data-icon="inline-start" />
          Play Preview
        </Button>
      </div>
    </div>
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
  playback,
  selectedVoiceId,
  voicePresets,
  voices,
}: {
  disabled: boolean
  onSelectVoice: (voiceId: string) => void
  onUseAudioFile: () => void
  playback: ReturnType<typeof usePrepareAudioPlayback>
  selectedVoiceId: string
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
  voices: VoiceAsset[]
}) {
  const carouselRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const carousel = carouselRef.current
    if (!carousel) {
      return undefined
    }

    carousel.addEventListener("wheel", containSavedVoiceCarouselWheel, { passive: false })
    return () => {
      carousel.removeEventListener("wheel", containSavedVoiceCarouselWheel)
    }
  }, [])

  return (
    <div
      aria-labelledby="sample-processing-voice-label"
      className="flex gap-2 overflow-x-auto overscroll-x-contain rounded-md border border-border bg-background/60 p-2"
      ref={carouselRef}
      role="group"
    >
      {voices.length === 0 ? <SavedVoiceEmptyCard /> : null}
      {voices.map((voice) => (
        <SavedVoiceSourceCard
          disabled={disabled}
          isSelected={voice.id === selectedVoiceId}
          key={voice.id}
          onSelectVoice={onSelectVoice}
          playback={playback}
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

function containSavedVoiceCarouselWheel(event: WheelEvent) {
  const carousel = event.currentTarget as HTMLElement | null
  if (!carousel) {
    return
  }

  const horizontalDelta = horizontalCarouselWheelDelta(event, carousel)
  if (horizontalDelta === 0) {
    return
  }

  const maxScrollLeft = Math.max(0, carousel.scrollWidth - carousel.clientWidth)
  if (maxScrollLeft === 0) {
    return
  }

  event.preventDefault()
  carousel.scrollLeft = Math.min(maxScrollLeft, Math.max(0, carousel.scrollLeft + horizontalDelta))
}

function horizontalCarouselWheelDelta(event: WheelEvent, carousel: HTMLElement) {
  const absoluteDeltaX = Math.abs(event.deltaX)
  const absoluteDeltaY = Math.abs(event.deltaY)

  if (!event.shiftKey && absoluteDeltaX <= absoluteDeltaY) {
    return 0
  }

  const horizontalDelta = event.shiftKey && absoluteDeltaY > absoluteDeltaX ? event.deltaY : event.deltaX
  if (horizontalDelta === 0) {
    return 0
  }

  if (event.deltaMode === 1) {
    return horizontalDelta * 16
  }

  if (event.deltaMode === 2) {
    return horizontalDelta * carousel.clientWidth
  }

  return horizontalDelta
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
  disabled,
  isSelected,
  onSelectVoice,
  playback,
  voice,
  voicePreset,
}: {
  disabled: boolean
  isSelected: boolean
  onSelectVoice: (voiceId: string) => void
  playback: ReturnType<typeof usePrepareAudioPlayback>
  voice: VoiceAsset
  voicePreset: string
}) {
  const descriptionId = `sample-processing-source-voice-${voice.id}-description`
  const includedVoiceDescriptionId = `sample-processing-source-voice-${voice.id}-included-description`
  const isIncludedVoice = voice.source === "default"
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
        aria-describedby={isIncludedVoice ? `${descriptionId} ${includedVoiceDescriptionId}` : descriptionId}
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
            {isIncludedVoice ? <IncludedVoiceIndicator /> : null}
          </span>
        </span>
        <span className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground" id={descriptionId}>
          Source: {fileLabel}
        </span>
        {isIncludedVoice ? (
          <span className="sr-only" id={includedVoiceDescriptionId}>
            Included default voice
          </span>
        ) : null}
        {isSelected ? <Check aria-label="Selected voice" className="absolute right-3 top-3 size-4 text-primary" /> : null}
      </button>
      <CompactVoicePreviewButton disabled={disabled} playback={playback} voice={voice} />
    </div>
  )
}

function IncludedVoiceIndicator() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label="Included default voice"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground"
        >
          <Sparkles aria-hidden="true" className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <p>Included Voice</p>
      </TooltipContent>
    </Tooltip>
  )
}

function CompactVoicePreviewButton({
  disabled,
  playback,
  voice,
}: {
  disabled: boolean
  playback: ReturnType<typeof usePrepareAudioPlayback>
  voice: VoiceAsset
}) {
  const source = playback.sources.get(`voice:${voice.id}`)
  const isCurrentSource =
    source !== undefined &&
    source.id === playback.controller.snapshot.source?.id &&
    source.url === playback.controller.snapshot.source?.url
  const isPlaying = isCurrentSource && playback.controller.snapshot.status === "playing"

  function handlePreviewToggle() {
    if (!source || disabled) {
      return
    }
    if (!isCurrentSource) {
      playback.activate(`voice:${voice.id}`)
      playback.controller.dispatch({ type: "play" })
      return
    }
    playback.controller.dispatch({ type: isPlaying ? "pause" : "play" })
  }

  return (
    <div className="absolute bottom-3 right-3">
      <Button
        aria-label={`${isPlaying ? "Pause" : "Play"} ${voice.name} Preview`}
        className="size-8"
        disabled={disabled || !source}
        onClick={handlePreviewToggle}
        size="icon"
        type="button"
        variant="secondary"
      >
        {isPlaying ? <Pause aria-hidden="true" data-icon="inline-start" /> : <Play aria-hidden="true" data-icon="inline-start" />}
      </Button>
      {isCurrentSource && playback.controller.snapshot.error ? (
        <span className="sr-only" role="alert">{playback.controller.snapshot.error}</span>
      ) : null}
    </div>
  )
}

function ProcessingProgress({ processing }: { processing: SampleProcessingController }) {
  const phases = processing.progressPhases ?? []
  if (phases.length > 0) {
    const activeLabel = processing.activeProgressPhase ? `Active Phase: ${processing.activeProgressPhase.label}` : null

    return (
      <ProcessingProgressSurface activeLabel={activeLabel} processing={processing}>
        <ol className="mt-3 grid gap-2">
          {phases.map((phase, index) => {
            const PhaseIcon = stepStatusIcon(phase.status)
            const phaseTimeLabel = progressPhaseTimeLabel(phase)
            return (
              <li
                className={cn(
                  "flex items-start gap-3 rounded-md border border-border bg-card/70 p-3",
                  phase.id === processing.job?.activeProgressPhaseId && "border-primary/60 bg-primary/10"
                )}
                key={phase.id}
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-medium">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{phase.label}</span>
                    <Badge
                      className={cn(
                        "gap-1.5",
                        phase.status === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
                        phase.status === "canceled" && "border-destructive/40 bg-destructive/10 text-destructive"
                      )}
                      variant={phase.status === "success" ? "accent" : "secondary"}
                    >
                      <PhaseIcon aria-hidden="true" className={cn("size-3", phase.status === "running" && "animate-spin")} />
                      {stepStatusLabel(phase.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {phase.detail ? <span>{phase.detail}</span> : null}
                    {phaseTimeLabel ? <span>{phaseTimeLabel}</span> : null}
                    {phase.error ? <span className="text-destructive">{phase.error}</span> : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </ProcessingProgressSurface>
    )
  }

  const steps = processing.job?.steps ?? []
  if (steps.length === 0) {
    return null
  }

  const activeLabel = processing.activeStep ? `Active Step: ${processing.activeStep.operationLabel}` : null

  return (
    <ProcessingProgressSurface activeLabel={activeLabel} processing={processing}>
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
                      "gap-1.5",
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
    </ProcessingProgressSurface>
  )
}

function ProcessingProgressSurface({
  activeLabel,
  children,
  processing,
}: {
  activeLabel: string | null
  children: ReactNode
  processing: SampleProcessingController
}) {
  if (processing.isProcessing) {
    return (
      <PendingWorkStatus
        aria-label="Workflow Progress"
        description="Running the selected sample processing workflow."
        meta={activeLabel ? <Badge variant="secondary">{activeLabel}</Badge> : null}
        statusLabel={panelStatusLabel(processing)}
        title="Workflow Progress"
      >
        {children}
      </PendingWorkStatus>
    )
  }

  return (
    <section aria-label="Workflow Progress" className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium">Workflow Progress</div>
        {activeLabel ? <Badge variant="secondary">{activeLabel}</Badge> : null}
      </div>
      {children}
    </section>
  )
}

function SingleResultSave({
  playback,
  processing,
  voicePresets,
}: {
  playback: ReturnType<typeof usePrepareAudioPlayback>
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}) {
  if (!processing.resultUrl || !processing.job) {
    return null
  }

  return (
    <form className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3" onSubmit={processing.handleSaveProcessedVoice}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">Processed Preview</div>
        <AudioLines aria-hidden="true" className="size-4 text-primary" />
      </div>
      {playback.sources.get("processed-result") ? (
        <PlaybackControls
          ariaLabel="Processed sample preview"
          controller={playback.controller}
          onActivate={() => playback.activate("processed-result")}
          source={playback.sources.get("processed-result")!}
        />
      ) : null}
      <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="processed-voice-name">
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

function PreparedCandidateResultSave({
  playback,
  processing,
  voicePresets,
}: {
  playback: ReturnType<typeof usePrepareAudioPlayback>
  processing: SampleProcessingController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}) {
  const result = processing.preparedSamplesResult
  if (!result || !processing.job) {
    return null
  }
  const groupedCandidates = groupCandidatesBySpeaker(result.candidates)

  return (
    <form className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3" onSubmit={processing.handleSaveCandidateVoices}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium">Ranked Candidates</div>
          <div className="text-xs text-muted-foreground">{result.candidates.length} Candidates Ready</div>
        </div>
        <Button disabled={!processing.canSaveSelectedCandidates} type="submit">
          {processing.candidateSaveStatus === "loading" ? <Loading aria-hidden="true" size="sm" /> : <Save aria-hidden="true" className="size-4" />}
          {processing.candidateSaveStatus === "loading" ? "Adding Candidates" : "Add Selected Voices"}
        </Button>
      </div>

      {result.warnings.length > 0 ? (
        <Alert>
          <AlertTitle>Prepare Warnings</AlertTitle>
          <AlertDescription>{result.warnings.join(" ")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3">
        {groupedCandidates.map((group, groupIndex) => (
          <section className="rounded-md border border-border bg-card/70 p-3" key={group.speakerId} style={speakerStyle(groupIndex)}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0 text-sm font-medium text-[var(--speaker-color)]">{group.speakerLabel}</div>
              <Badge variant="secondary">{group.candidates.length} Ranked</Badge>
            </div>
            <div className="grid gap-3">
              {group.candidates.map((candidate) => {
                const checkboxId = `candidate-save-${candidate.candidateId}`
                const nameInputId = `candidate-name-${candidate.candidateId}`
                const isSelected = processing.selectedCandidateIds.includes(candidate.candidateId)
                return (
                  <article className="grid gap-3 rounded-md border border-border bg-background/70 p-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(16rem,1fr)]" key={candidate.candidateId}>
                    <div className="flex min-w-0 flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <label className="flex min-w-0 items-center gap-2 text-sm font-medium" htmlFor={checkboxId}>
                          <Checkbox
                            checked={isSelected}
                            id={checkboxId}
                            onCheckedChange={(checked) => processing.handleCandidateSaveSelectionChange(candidate.candidateId, checked === true)}
                          />
                          <span className="truncate">Rank {candidate.rank}</span>
                        </label>
                        <CandidateQualityBadges candidate={candidate} />
                      </div>
                      {playback.sources.get(`candidate:${candidate.candidateId}`) ? (
                        <PlaybackControls
                          ariaLabel={`${candidate.speakerLabel} candidate ${candidate.rank} preview`}
                          controller={playback.controller}
                          onActivate={() => playback.activate(`candidate:${candidate.candidateId}`)}
                          source={playback.sources.get(`candidate:${candidate.candidateId}`)!}
                        />
                      ) : null}
                      {candidate.warnings.length > 0 ? (
                        <Alert>
                          <AlertTitle>Candidate Warning</AlertTitle>
                          <AlertDescription>{candidate.warnings.join(" ")}</AlertDescription>
                        </Alert>
                      ) : null}
                    </div>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={nameInputId}>Voice Name</FieldLabel>
                        <Input
                          id={nameInputId}
                          onChange={(event) => processing.handleCandidateNameChange(candidate.candidateId, event.target.value)}
                          value={processing.candidateNameAssignments[candidate.candidateId] ?? ""}
                        />
                      </Field>
                      <VoicePresetToggleGroup
                        id={`candidate-preset-${candidate.candidateId}`}
                        label="Voice Preset"
                        onChange={(voicePresetId) => processing.handleCandidateVoicePresetChange(candidate.candidateId, voicePresetId)}
                        value={processing.candidateVoicePresetIds[candidate.candidateId] ?? voicePresets[0]?.id ?? "standardNarration"}
                        voicePresets={voicePresets}
                      />
                    </FieldGroup>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {processing.candidateSaveError ? (
        <Alert className="border-destructive/40 bg-destructive/10 text-destructive" role="alert">
          <AlertTitle>Save Failed</AlertTitle>
          <AlertDescription>{processing.candidateSaveError}</AlertDescription>
        </Alert>
      ) : null}
      {processing.candidateSaveStatus === "success" ? (
        <Alert>
          <AlertTitle>Added To Voice Library</AlertTitle>
          <AlertDescription>Selected candidates are now available.</AlertDescription>
        </Alert>
      ) : null}
    </form>
  )
}

function CandidateQualityBadges({ candidate }: { candidate: PreparedSampleCandidate }) {
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1">
      <Badge variant="accent">Score {Math.round(candidate.score)}</Badge>
      <Badge variant="secondary">{formatCandidateDuration(candidate.durationSeconds)}</Badge>
      <Badge variant="secondary">{candidate.sampleRateHz / 1000} kHz</Badge>
    </span>
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

function progressPhaseTimeLabel(phase: { startedAt: string | null; completedAt: string | null; status: string }) {
  if (!phase.startedAt) {
    return null
  }
  const startedAt = Date.parse(phase.startedAt)
  if (!Number.isFinite(startedAt)) {
    return null
  }
  if (phase.status === "running") {
    return `Elapsed ${formatElapsedTime(Date.now() - startedAt)}`
  }
  if (!phase.completedAt) {
    return null
  }
  const completedAt = Date.parse(phase.completedAt)
  if (!Number.isFinite(completedAt)) {
    return null
  }
  return `Finished In ${formatElapsedTime(completedAt - startedAt)}`
}

function orderedWorkflowOperations(processing: SampleProcessingController) {
  const operationById = new Map(processing.operations.map((operation) => [operation.id, operation]))
  const preferredOrder = Array.from(
    new Set<SampleProcessingOperationId>(["prepareVoice", ...processing.recommendedWorkflowOrder])
  )
  const ordered = preferredOrder
    .map((operationId) => operationById.get(operationId))
    .filter((operation): operation is SampleProcessingController["operations"][number] => Boolean(operation))
  const orderedIds = new Set(ordered.map((operation) => operation.id))
  const remaining = processing.operations.filter((operation) => !orderedIds.has(operation.id))
  return [...ordered, ...remaining]
}

function operationIcon(operationId: SampleProcessingOperationId) {
  if (operationId === "prepareVoice") {
    return Wand2
  }
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
    case "prepareVoice":
      return {
        description: "Find the best provider-sized voice samples from long audio.",
        title: "Easy Prepare",
      }
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

function groupCandidatesBySpeaker(candidates: PreparedSampleCandidate[]) {
  const groups: { speakerId: string; speakerLabel: string; candidates: PreparedSampleCandidate[] }[] = []
  for (const candidate of candidates) {
    let group = groups.find((item) => item.speakerId === candidate.speakerId)
    if (!group) {
      group = { speakerId: candidate.speakerId, speakerLabel: candidate.speakerLabel, candidates: [] }
      groups.push(group)
    }
    group.candidates.push(candidate)
  }
  return groups.map((group) => ({
    ...group,
    candidates: [...group.candidates].sort((left, right) => left.rank - right.rank),
  }))
}

function formatCandidateDuration(durationSeconds: number) {
  const roundedSeconds = Math.round(durationSeconds)
  if (roundedSeconds >= 60) {
    const minutes = Math.floor(roundedSeconds / 60)
    const seconds = roundedSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  }
  return `${roundedSeconds}s`
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

function speakerStyle(index: number): CSSProperties {
  return {
    "--speaker-color": SPEAKER_COLORS[index % SPEAKER_COLORS.length],
  } as CSSProperties
}
