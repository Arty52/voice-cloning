import { Badge } from "@/components/ui/badge"
import { formatElapsedTime } from "@/lib/formatters"
import { formatSampleProcessingDurationRange } from "@/lib/sample-processing-estimate"
import type { SampleProcessingDurationRange } from "@/types"

type TranscriptProcessingTimingProps = {
  elapsedMs: number | null
  estimateRange: SampleProcessingDurationRange | null
  isProcessing: boolean
}

export function TranscriptProcessingTiming({
  elapsedMs,
  estimateRange,
  isProcessing,
}: TranscriptProcessingTimingProps) {
  if (elapsedMs === null) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        aria-label="Transcript Processing Elapsed Time"
        className="text-xs tabular-nums text-muted-foreground"
      >
        {isProcessing ? "Elapsed" : "Finished In"} {formatElapsedTime(elapsedMs)}
      </span>
      {isProcessing && estimateRange ? (
        <Badge aria-label="Transcript Processing Estimated Time" variant="secondary">
          Estimated {formatSampleProcessingDurationRange(estimateRange)}
        </Badge>
      ) : null}
    </div>
  )
}
