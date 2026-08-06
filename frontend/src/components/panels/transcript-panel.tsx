import { Ban, FileAudio, MessageSquareText, Sparkles } from "lucide-react"

import { MediaFileDropZone } from "@/components/media-file-drop-zone"
import { ProcessingTimeEstimate } from "@/components/processing-time-estimate"
import { SpeakerTranscriptWorkspace } from "@/components/speaker-transcript-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { Loading } from "@/components/ui/loading"
import type { TranscriptWorkflowController } from "@/hooks/use-transcript-workflow"
import { TRANSCRIPT_AUDIO_ACCEPT } from "@/hooks/use-transcript-workflow"
import { formatElapsedTime } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import type { VoicePresetId } from "@/types"

type TranscriptPanelProps = {
  transcript: TranscriptWorkflowController
  voicePresets: { id: VoicePresetId; label: string; description: string }[]
}

const TRANSCRIPT_UPLOAD_HELPER_COPY =
  "Choose a complete MP3, WAV, M4A, M4B, AAC, OGG, or FLAC file. The full audio is processed without a source-range limit."

export function TranscriptPanel({ transcript, voicePresets }: TranscriptPanelProps) {
  const statusLabel = transcriptStatusLabel(transcript.status)
  const activePhase = transcript.job?.progressPhases?.find(
    (phase) => phase.id === transcript.job?.activeProgressPhaseId
  )

  return (
    <div className="flex flex-col gap-4">
      <Card aria-busy={transcript.isProcessing}>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Optional</Badge>
            <Badge
              className={cn(
                transcript.status === "error" && "border-destructive/40 bg-destructive/10 text-destructive"
              )}
            >
              {statusLabel}
            </Badge>
            {transcript.processingElapsedMs !== null ? (
              <span
                aria-label="Transcript Processing Elapsed Time"
                className="text-xs tabular-nums text-muted-foreground"
              >
                {transcript.isProcessing ? "Elapsed" : "Finished In"} {formatElapsedTime(transcript.processingElapsedMs)}
              </span>
            ) : null}
          </div>
          <CardTitle>Transcript Workspace</CardTitle>
          <CardDescription>
            Detect speakers and transcribe an entire audio file locally, then name voices, correct dialogue, export the
            transcript, or save selected speakers to the Voice Library.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transcript.unavailableReason ? (
            <Alert role="alert">
              <AlertTitle>Transcript Processing Unavailable</AlertTitle>
              <AlertDescription>{transcript.unavailableReason}</AlertDescription>
            </Alert>
          ) : null}

          <form className="flex flex-col gap-4" onSubmit={transcript.handleStartTranscription}>
            <FieldGroup>
              <MediaFileDropZone
                accept={TRANSCRIPT_AUDIO_ACCEPT}
                ariaLabel="Transcript Audio Drop Zone"
                disabled={transcript.isProcessing}
                helperCopy={TRANSCRIPT_UPLOAD_HELPER_COPY}
                id="transcript-source-audio"
                label="Audio File"
                onFileSelect={transcript.handleSourceFileSelect}
                selectedFileName={transcript.sourceFile?.name ?? null}
                selectedLabel="Audio Ready"
              />
              <FieldDescription>
                Language and speaker count are detected automatically by the local FFmpeg, pyannote, and faster-whisper
                pipeline.
              </FieldDescription>
              {transcript.preStartEstimateRangeSeconds && transcript.sourceFile && !transcript.isProcessing ? (
                <ProcessingTimeEstimate
                  range={transcript.preStartEstimateRangeSeconds}
                  sourceSizeBytes={transcript.sourceFile.size}
                />
              ) : null}
            </FieldGroup>

            {transcript.validationError ? (
              <Alert role="alert">
                <AlertTitle>Unsupported Audio File</AlertTitle>
                <AlertDescription>{transcript.validationError}</AlertDescription>
              </Alert>
            ) : null}

            {transcript.job ? (
              <Card className="bg-background/60 shadow-none">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">
                      {transcript.job.sourceFilename || transcript.job.sourceName}
                    </CardTitle>
                    <CardDescription>
                      {activePhase?.detail || activePhase?.label || transcript.job.operationLabel}
                    </CardDescription>
                  </div>
                  <FileAudio aria-hidden="true" className="size-5 shrink-0 text-primary" />
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{transcript.job.engine || "Local Processor"}</Badge>
                  {activePhase ? <Badge variant="accent">{activePhase.label}</Badge> : null}
                  {transcript.job.result && "kind" in transcript.job.result && transcript.job.result.kind === "speakerSeparation" ? (
                    <Badge variant="secondary">{transcript.job.result.speakers.length} Speakers</Badge>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {transcript.error ? (
              <Alert
                className={cn(
                  transcript.status === "error" && "border-destructive/40 bg-destructive/10 text-destructive"
                )}
                role="alert"
              >
                <AlertTitle>
                  {transcript.status === "error" ? "Transcript Processing Failed" : "Transcript Processing Notice"}
                </AlertTitle>
                <AlertDescription>{transcript.error}</AlertDescription>
              </Alert>
            ) : null}

            <div className={cn("grid gap-2", transcript.canCancel && "sm:grid-cols-[minmax(0,1fr)_auto]")}>
              <Button className="w-full" disabled={!transcript.canStart} type="submit">
                {transcript.isProcessing ? (
                  <Loading aria-hidden="true" size="sm" />
                ) : (
                  <Sparkles aria-hidden="true" className="size-4" />
                )}
                {transcriptActionLabel(transcript.status)}
              </Button>
              {transcript.canCancel ? (
                <Button
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void transcript.handleCancelTranscription()}
                  type="button"
                  variant="secondary"
                >
                  <Ban aria-hidden="true" className="size-4" />
                  Abort Transcript
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {transcript.job?.status === "success" ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquareText aria-hidden="true" className="size-5 text-primary" />
              <CardTitle>Dialogue Transcript</CardTitle>
            </div>
            <CardDescription>
              Names, turn assignments, and dialogue corrections are persisted with this transcript job.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpeakerTranscriptWorkspace
              controller={transcript.speakerTranscript}
              job={transcript.job}
              voicePresets={voicePresets}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function transcriptStatusLabel(status: TranscriptWorkflowController["status"]) {
  switch (status) {
    case "restoring":
      return "Restoring"
    case "starting":
      return "Starting"
    case "processing":
      return "Processing"
    case "success":
      return "Ready"
    case "error":
      return "Error"
    case "canceled":
      return "Canceled"
    default:
      return "Ready To Start"
  }
}

function transcriptActionLabel(status: TranscriptWorkflowController["status"]) {
  switch (status) {
    case "restoring":
      return "Restoring Transcript"
    case "starting":
      return "Starting Transcript"
    case "processing":
      return "Creating Transcript"
    default:
      return "Create Transcript"
  }
}
