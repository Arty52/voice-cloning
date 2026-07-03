import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { GeneratedAudioScriptSnapshot, GeneratedResult } from "@/types"
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
  scriptSnapshot: null,
  url: "blob:generated-1",
  voiceId: "narrator",
  voiceName: "Multi-Voice",
}

describe("GeneratedAudioItem", () => {
  it("shows multi-voice archive metadata while preserving playback actions", async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    const downloadAction = screen.getByRole("menuitem", { name: "Download" })
    expect(downloadAction).toHaveAttribute("href", "blob:generated-1")
    expect(downloadAction).toHaveAttribute("download", "voice-clone-narrator-generated-1.mp3")
  })

  it("shows range script snapshot actions when callbacks are available", async () => {
    const user = userEvent.setup()
    const onViewScriptSnapshot = vi.fn()
    const onRestoreScriptSnapshot = vi.fn()
    const itemWithSnapshot = { ...multiVoiceItem, scriptSnapshot: rangeSnapshot }

    render(
      <TooltipProvider>
        <GeneratedAudioItem
          item={itemWithSnapshot}
          onDelete={vi.fn()}
          onRestoreScriptSnapshot={onRestoreScriptSnapshot}
          onViewScriptSnapshot={onViewScriptSnapshot}
        />
      </TooltipProvider>
    )

    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    await user.click(screen.getByRole("menuitem", { name: "View Script" }))
    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    await user.click(screen.getByRole("menuitem", { name: "Use Text" }))

    expect(onViewScriptSnapshot).toHaveBeenCalledWith(itemWithSnapshot)
    expect(onRestoreScriptSnapshot).toHaveBeenCalledWith(itemWithSnapshot)
  })

  it("labels dialogue script recall actions by mode", async () => {
    const user = userEvent.setup()
    const onRestoreScriptSnapshot = vi.fn()
    const itemWithSnapshot = { ...multiVoiceItem, scriptSnapshot: dialogueSnapshot }

    render(
      <TooltipProvider>
        <GeneratedAudioItem
          item={itemWithSnapshot}
          onDelete={vi.fn()}
          onRestoreScriptSnapshot={onRestoreScriptSnapshot}
        />
      </TooltipProvider>
    )

    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    await user.click(screen.getByRole("menuitem", { name: "Use Dialogue" }))

    expect(onRestoreScriptSnapshot).toHaveBeenCalledWith(itemWithSnapshot)
  })
})

const rangeSnapshot: GeneratedAudioScriptSnapshot = {
  version: 1,
  mode: "range",
  text: "Narrator starts. Villain replies.",
  sourceVoiceId: "narrator",
  assignments: [],
  dialogueBlocks: [],
  speakerMappings: [],
  segmentGapMs: null,
}

const dialogueSnapshot: GeneratedAudioScriptSnapshot = {
  ...rangeSnapshot,
  mode: "dialogue",
  dialogueBlocks: [
    {
      id: "dialogue-block-1",
      speakerLabel: "Narrator",
      text: "Narrator starts.",
      voiceId: "narrator",
      voiceName: "Narrator",
      voiceSettings: null,
    },
  ],
}
