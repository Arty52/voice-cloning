import { describe, expect, it } from "vitest"

import {
  estimateSampleProcessingDurationRangeSeconds,
  formatSampleProcessingDurationRange,
} from "./sample-processing-estimate"

describe("sample processing estimates", () => {
  it("returns no estimate without a source file size", () => {
    expect(
      estimateSampleProcessingDurationRangeSeconds({
        cleanVoice: false,
        detectSpeakers: true,
        sourceSizeBytes: null,
        trimCandidates: false,
      })
    ).toBeNull()
  })

  it("estimates the speaker-separation pipeline without cleanup or trimming costs", () => {
    const range = estimateSampleProcessingDurationRangeSeconds({
      cleanVoice: false,
      detectSpeakers: true,
      sourceSizeBytes: 1024 * 1024,
      trimCandidates: false,
    })

    expect(range).toEqual({ minSeconds: 40, maxSeconds: 116 })
    expect(formatSampleProcessingDurationRange(range!)).toBe("40s to 1m 56s")
  })

  it("retains the full Easy Prepare cost model for existing callers", () => {
    expect(
      estimateSampleProcessingDurationRangeSeconds({
        cleanVoice: true,
        detectSpeakers: true,
        sourceSizeBytes: 1024 * 1024,
        trimCandidates: true,
      })
    ).toEqual({ minSeconds: 76, maxSeconds: 221 })
  })
})
