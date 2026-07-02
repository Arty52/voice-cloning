import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { GeneratedResult } from "@/types"
import { TooltipProvider } from "@/components/ui/tooltip"

import { GeneratedAudioItem } from "./generated-audio-item"

const multiVoiceItem: GeneratedResult = {
  appVoiceId: "narrator",
  cacheState: "multi-voice",
  characterCount: 24,
  contentType: "audio/mpeg",
  createdAt: "2026-06-23T00:00:00.000Z",
  generatedAt: "Jun 23, 2026",
  generationElapsedMs: 1200,
  id: "generated-1",
  modelId: "eleven_flash_v2_5",
  multiVoiceMetadata: {
    jobId: "job-1",
    resultSha256: "combined-hash",
    segmentCount: 2,
    segments: [
      {
        assignmentKind: "assigned",
        characterCount: 12,
        generationCount: 1,
        id: "segment-one",
        index: 0,
        resultSha256: "segment-one-hash",
        text: "Hello.",
        voiceId: "narrator",
        voiceName: "Narrator",
      },
      {
        assignmentKind: "default",
        characterCount: 12,
        generationCount: 1,
        id: "segment-two",
        index: 1,
        resultSha256: "segment-two-hash",
        text: "There.",
        voiceId: "villain",
        voiceName: "Villain",
      },
    ],
    voices: [
      { segmentCount: 1, voiceId: "narrator", voiceName: "Narrator" },
      { segmentCount: 1, voiceId: "villain", voiceName: "Villain" },
    ],
  },
  requestId: null,
  sha256: "combined-hash",
  sizeBytes: 12,
  tuningMetadata: null,
  url: "blob:generated-1",
  voiceId: "narrator",
  voiceName: "Multi-Voice",
}

describe("GeneratedAudioItem", () => {
  it("shows multi-voice archive metadata while preserving playback actions", () => {
    render(
      <TooltipProvider>
        <GeneratedAudioItem item={multiVoiceItem} onDelete={vi.fn()} />
      </TooltipProvider>
    )

    expect(screen.getAllByText("Multi-Voice")).toHaveLength(2)
    expect(screen.getByText("Combined Result")).toBeInTheDocument()
    expect(screen.getByText("2 Segments")).toBeInTheDocument()
    expect(screen.getByText("Narrator x1")).toBeInTheDocument()
    expect(screen.getByText("Villain x1")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /play audio/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument()
  })
})
