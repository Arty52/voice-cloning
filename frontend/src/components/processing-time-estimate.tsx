import { Badge } from "@/components/ui/badge"
import { formatCompactBytes } from "@/lib/formatters"
import { formatSampleProcessingDurationRange } from "@/lib/sample-processing-estimate"
import type { SampleProcessingDurationRange } from "@/types"

type ProcessingTimeEstimateProps = {
  range: SampleProcessingDurationRange
  sourceSizeBytes?: number | null
}

export function ProcessingTimeEstimate({ range, sourceSizeBytes = null }: ProcessingTimeEstimateProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="secondary">Estimated Time {formatSampleProcessingDurationRange(range)}</Badge>
      {sourceSizeBytes !== null ? (
        <span>File-size estimate from a {formatCompactBytes(sourceSizeBytes)} source file.</span>
      ) : null}
    </div>
  )
}
