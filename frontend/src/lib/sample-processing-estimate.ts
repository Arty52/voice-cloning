import { formatElapsedTime } from "@/lib/formatters"
import type { SampleProcessingDurationRange } from "@/types"

const BYTES_PER_MEBIBYTE = 1024 * 1024

export function estimateSampleProcessingDurationRangeSeconds({
  cleanVoice,
  detectSpeakers,
  sourceSizeBytes,
  trimCandidates,
}: {
  cleanVoice: boolean
  detectSpeakers: boolean
  sourceSizeBytes: number | null
  trimCandidates: boolean
}): SampleProcessingDurationRange | null {
  if (sourceSizeBytes === null) {
    return null
  }
  const sourceMib = Math.max(0.1, sourceSizeBytes / BYTES_PER_MEBIBYTE)
  let minSeconds = 10 + sourceMib * 0.08
  let maxSeconds = 25 + sourceMib * 0.18
  if (cleanVoice) {
    minSeconds += 20 + sourceMib * 0.18
    maxSeconds += 60 + sourceMib * 0.35
  }
  if (detectSpeakers) {
    minSeconds += 30 + sourceMib * 0.18
    maxSeconds += 90 + sourceMib * 0.45
  }
  if (trimCandidates) {
    minSeconds += 15 + sourceMib * 0.08
    maxSeconds += 45 + sourceMib * 0.18
  }
  const roundedMin = Math.max(10, Math.round(minSeconds))
  return {
    minSeconds: roundedMin,
    maxSeconds: Math.max(roundedMin + 30, Math.round(maxSeconds)),
  }
}

export function formatSampleProcessingDurationRange(range: SampleProcessingDurationRange) {
  return `${formatElapsedTime(range.minSeconds * 1000)} to ${formatElapsedTime(range.maxSeconds * 1000)}`
}
