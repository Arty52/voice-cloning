import { AudioLines, ChevronDown, FileAudio, Info, Save, Upload, Wand2 } from "lucide-react"

import { AudioPlayer } from "@/components/audio-player"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/loading"
import { MenuSelect } from "@/components/ui/menu-select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { VoicePresetToggleGroup } from "@/components/voice-preset-toggle-group"
import type { SampleProcessingController } from "@/hooks/use-sample-processing"
import { formatElapsedTime } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import type { SampleProcessingOperationId, SampleProcessingPresetId, VoicePresetId } from "@/types"

type SampleProcessingPanelProps = {
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

export function SampleProcessingPanel({
  isExpanded,
  onToggleExpanded,
  processing,
  voicePresets,
}: SampleProcessingPanelProps) {
  const operationOptions = processing.operations.map((operation) => ({
    label: operation.enabled ? operation.label : `${operation.label} Unavailable`,
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
      </div>

      {isExpanded ? (
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
