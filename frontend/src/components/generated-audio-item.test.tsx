import { fireEvent, render, screen } from "@testing-library/react"
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

    const multiVoiceBadge = screen.getByRole("button", { name: "Show Multi-Voice Generation Details" })
    expect(multiVoiceBadge).toHaveTextContent("Multi-Voice")
    expect(screen.queryByText("Combined Result")).not.toBeInTheDocument()
    expect(screen.queryByText("2 Segments")).not.toBeInTheDocument()
    fireEvent.click(multiVoiceBadge)
    expect(await screen.findByText("2 Segments")).toBeInTheDocument()
    expect(screen.getByText("Narrator x1")).toBeInTheDocument()
    expect(screen.getByText("Villain x1")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /play audio/i })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    const downloadAction = screen.getByRole("menuitem", { name: "Download" })
    expect(downloadAction).toHaveAttribute("href", "blob:generated-1")
    expect(downloadAction).toHaveAttribute("download", "voice-clone-narrator-generated-1.mp3")
  })

  it("shows cache badges for non-multi-voice generated audio", () => {
    const cacheHitItem: GeneratedResult = {
      ...multiVoiceItem,
      cacheState: "hit",
      multiVoiceMetadata: null,
      voiceName: "Narrator",
    }

    const { rerender } = render(
      <TooltipProvider>
        <GeneratedAudioItem item={cacheHitItem} onDelete={vi.fn()} />
      </TooltipProvider>
    )

    expect(screen.getByText("Cache Hit")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Show Multi-Voice Generation Details" })).not.toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <GeneratedAudioItem item={{ ...cacheHitItem, cacheState: "miss" }} onDelete={vi.fn()} />
      </TooltipProvider>
    )

    expect(screen.getByText("Cache Miss")).toBeInTheDocument()
  })

  it("threads multi-voice custom tuning summaries into the metadata popover", async () => {
    render(
      <TooltipProvider>
        <GeneratedAudioItem
          item={{
            ...multiVoiceItem,
            multiVoiceMetadata: {
              ...multiVoiceItem.multiVoiceMetadata!,
              tuningSummaries: [
                {
                  adjustedSettings: [adjustedSetting("stability", "Stability", "0.5", "0.4")],
                  id: "narrator:settings",
                  voiceId: "narrator",
                  voiceName: "voice_a",
                },
              ],
            },
            tuningMetadata: {
              adjustedSettings: [adjustedSetting("stability", "Stability", "0.5", "0.4")],
              mode: "custom",
              presetId: null,
              presetLabel: null,
              providerId: "elevenlabs",
              providerLabel: "ElevenLabs",
            },
          }}
          onDelete={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.getByRole("button", { name: "Show Multi-Voice Generation Details" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Show Multi-Voice Custom Settings" })).toHaveTextContent(
      "Custom Settings"
    )
    expect(screen.queryByText("Stability 0.4")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Show Multi-Voice Custom Settings" }))

    expect(await screen.findByText("voice_a")).toBeInTheDocument()
    expect(screen.getByText("Stability 0.4")).toBeInTheDocument()
  })

  it("shows range text snapshot actions when callbacks are available", async () => {
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
    await user.hover(screen.getByRole("menuitem", { name: "Use Text" }))

    expect(
      await screen.findAllByText("Replace the Generate draft with this saved text and voice assignments.")
    ).not.toHaveLength(0)

    await user.click(screen.getByRole("menuitem", { name: "View Text" }))
    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    await user.click(screen.getByRole("menuitem", { name: "Use Text" }))

    expect(onViewScriptSnapshot).toHaveBeenCalledWith(itemWithSnapshot)
    expect(onRestoreScriptSnapshot).toHaveBeenCalledWith(itemWithSnapshot)
  })

  it("explains generated audio server export actions", async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <GeneratedAudioItem
          item={multiVoiceItem}
          onDelete={vi.fn()}
          onServerExport={vi.fn()}
        />
      </TooltipProvider>
    )

    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    const exportAction = screen.getByRole("menuitem", { name: "Export" })
    await user.hover(exportAction)

    expect(
      await screen.findAllByText("Copy this audio and metadata sidecar to the configured server export folder.")
    ).not.toHaveLength(0)
  })

  it("explains generated audio browser export actions", async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <GeneratedAudioItem
          item={multiVoiceItem}
          onBrowserExport={vi.fn()}
          onDelete={vi.fn()}
        />
      </TooltipProvider>
    )

    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    await user.hover(screen.getByRole("menuitem", { name: "Browser Export" }))

    expect(
      await screen.findAllByText("Copy this audio and metadata sidecar to your selected browser export folder.")
    ).not.toHaveLength(0)
  })

  it("labels dialogue snapshot actions by mode", async () => {
    const user = userEvent.setup()
    const onViewScriptSnapshot = vi.fn()
    const onRestoreScriptSnapshot = vi.fn()
    const itemWithSnapshot = { ...multiVoiceItem, scriptSnapshot: dialogueSnapshot }

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
    await user.click(screen.getByRole("menuitem", { name: "View Dialogue" }))
    await user.click(screen.getByRole("button", { name: /open generated audio actions/i }))
    await user.click(screen.getByRole("menuitem", { name: "Use Dialogue" }))

    expect(onViewScriptSnapshot).toHaveBeenCalledWith(itemWithSnapshot)
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

function adjustedSetting(id: string, label: string, nominalValueLabel: string, valueLabel: string) {
  return {
    id,
    label,
    nominalValue: nominalValueLabel,
    nominalValueLabel,
    value: valueLabel,
    valueLabel,
  }
}
