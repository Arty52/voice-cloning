import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import type { SampleProcessingJob } from "@/types"

const STAGE_LABELS: Record<string, string> = { normalization: "Audio Preparation", transcription: "Transcription", diarization: "Speaker Detection", speakerAudio: "Speaker Audio" }
const STATUS_LABELS = { running: "Running", success: "Complete", error: "Failed" }

export function TranscriptionExecution({ job }: { job: SampleProcessingJob }) {
  const result = job.result && "kind" in job.result && (job.result.kind === "transcript" || job.result.kind === "speakerSeparation") ? job.result : null
  const metadata = result?.metadata
  const stages = job.transcriptionProgress ?? metadata?.stages ?? {}
  return (
    <div className="flex basis-full flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {metadata?.device ? <Badge>ASR: {deviceLabel(metadata.device)}</Badge> : null}
        {metadata?.diarizationDevice ? <Badge>Speaker Detection: {deviceLabel(metadata.diarizationDevice)}</Badge> : null}
        {result ? <Badge variant="secondary">{result.speakers.length ? `${result.speakers.length} Speakers` : "Unassigned Speakers"}</Badge> : null}
      </div>
      <ul aria-label="Measured Processing Stages" className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        {Object.entries(stages).map(([key, stage]) => <li key={key}>{STAGE_LABELS[key] ?? key}: {STATUS_LABELS[stage.status]}{stage.elapsedSeconds !== undefined ? ` · ${stage.elapsedSeconds.toFixed(1)}s` : ""}</li>)}
      </ul>
      {metadata?.warnings?.map((warning, index) => <Alert key={index}><AlertTitle>Transcript Notice</AlertTitle><AlertDescription>{warning}</AlertDescription></Alert>)}
    </div>
  )
}

function deviceLabel(device: string) {
  return device === "apple-gpu" ? "Apple GPU" : device === "cpu" ? "CPU" : device
}
