import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { SampleProcessingJob } from "@/types"

type TranscriptPipelineActivityProps = {
  className?: string
  engine: string
  isProcessing: boolean
  jobStatus: SampleProcessingJob["status"] | undefined
}

/**
 * An intentionally indeterminate activity treatment for a running Transcript job.
 * Backend job progress is not yet granular enough to represent completion honestly.
 */
export function TranscriptPipelineActivity({
  className,
  engine,
  isProcessing,
  jobStatus,
}: TranscriptPipelineActivityProps) {
  const isActiveJob = isProcessing && (jobStatus === "pending" || jobStatus === "running")

  if (!isActiveJob) {
    return <Badge variant="secondary">{engine}</Badge>
  }

  return (
    <div
      aria-label={`Transcript is processing with ${engine}. Progress percentage is unavailable.`}
      className={cn("transcript-pipeline-activity relative min-w-0 overflow-hidden rounded-md border border-border bg-muted/40", className)}
      role="status"
    >
      {/* Activity-only until backend transcript phase/progress instrumentation supplies truthful progress. */}
      <span aria-hidden="true" className="transcript-pipeline-activity__sweep" />
      <span className="relative block truncate px-2.5 py-1 text-xs text-muted-foreground">{engine}</span>
    </div>
  )
}
