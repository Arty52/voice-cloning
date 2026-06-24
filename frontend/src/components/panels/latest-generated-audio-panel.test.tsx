import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import type { GeneratedResult, VoiceAsset } from "@/types"
import { TooltipProvider } from "@/components/ui/tooltip"

import { LatestGeneratedAudioPanel } from "./latest-generated-audio-panel"

const narrator = voice("narrator", "Narrator")
const villain = voice("villain", "Villain")

const item: GeneratedResult = {
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
        text: "Hello narrator.",
        voiceId: "narrator",
        voiceName: "Narrator",
      },
      {
        assignmentKind: "default",
        characterCount: 12,
        generationCount: 2,
        id: "segment-two",
        index: 1,
        resultSha256: "segment-two-hash",
        text: "Villain replies.",
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
  sizeBytes: 12,
  tuningMetadata: null,
  url: "blob:generated-1",
  voiceId: "narrator",
  voiceName: "Multi-Voice",
}

function voice(id: string, name: string): VoiceAsset {
  return {
    contentType: "audio/mpeg",
    createdAt: "2026-06-23T00:00:00.000Z",
    filePath: `${id}.mp3`,
    id,
    name,
    processingSteps: [],
    sampleMode: "excerpt",
    sha256: `${id}-hash`,
    source: "upload",
    sourceContentType: null,
    sourceFilePath: null,
    sourceSha256: null,
    voicePresetId: "standardNarration",
    windowDurationSeconds: null,
    windowStartSeconds: null,
  }
}

function renderLatestPanel(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe("LatestGeneratedAudioPanel multi-voice results", () => {
  it("keeps segment controls collapsed until opened", async () => {
    const user = userEvent.setup()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        error={null}
        isDeleteDisabled={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        segmentResultUrls={{
          "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result",
          "segment-two": "/api/speech/jobs/job-1/segments/segment-two/result",
        }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )

    expect(screen.getByRole("region", { name: /multi-voice segment controls/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /show segments/i })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getAllByRole("button", { name: /play audio/i })).toHaveLength(1)
    expect(screen.queryByRole("group", { name: /generated segment 1 playback/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /show segments/i }))

    expect(screen.getByRole("button", { name: /hide segments/i })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Hello narrator.")).toBeInTheDocument()
    expect(screen.getByText("Villain replies.")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /play audio/i })).toHaveLength(3)

    await user.click(screen.getByRole("button", { name: /hide segments/i }))

    expect(screen.getByRole("button", { name: /show segments/i })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getAllByRole("button", { name: /play audio/i })).toHaveLength(1)
    expect(screen.queryByRole("group", { name: /generated segment 1 playback/i })).not.toBeInTheDocument()
  })

  it("plays segments and regenerates with an optional changed voice", async () => {
    const user = userEvent.setup()
    const onRegenerateSegment = vi.fn()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        error={null}
        isDeleteDisabled={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={onRegenerateSegment}
        segmentResultUrls={{
          "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result",
          "segment-two": "/api/speech/jobs/job-1/segments/segment-two/result",
        }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))

    expect(screen.getByRole("region", { name: /multi-voice segment controls/i })).toBeInTheDocument()
    expect(screen.getByText("Hello narrator.")).toBeInTheDocument()
    expect(screen.getByText("Villain replies.")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /play audio/i })).toHaveLength(3)

    await user.click(screen.getByRole("button", { name: /voice for segment 1: narrator/i }))
    await user.click(screen.getByRole("menuitemradio", { name: "Villain" }))
    await user.click(screen.getAllByRole("button", { name: /^Regenerate$/i })[0])

    expect(onRegenerateSegment).toHaveBeenCalledWith("segment-one", "villain")
  })

  it("resets segment voice choices when the latest job changes", async () => {
    const user = userEvent.setup()
    const onRegenerateSegment = vi.fn()
    const renderPanel = (panelItem: GeneratedResult) => (
      <LatestGeneratedAudioPanel
        error={null}
        isDeleteDisabled={false}
        item={panelItem}
        onDelete={vi.fn()}
        onRegenerateSegment={onRegenerateSegment}
        segmentResultUrls={{
          "segment-one": `/api/speech/jobs/${panelItem.multiVoiceMetadata?.jobId}/segments/segment-one/result`,
        }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )
    const { rerender } = renderLatestPanel(renderPanel(item))

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    await user.click(screen.getByRole("button", { name: /voice for segment 1: narrator/i }))
    await user.click(screen.getByRole("menuitemradio", { name: "Villain" }))
    expect(screen.getByRole("button", { name: /voice for segment 1: villain/i })).toBeInTheDocument()

    const nextItem: GeneratedResult = {
      ...item,
      id: "generated-2",
      multiVoiceMetadata: {
        ...item.multiVoiceMetadata!,
        jobId: "job-2",
        resultSha256: "combined-hash-2",
        segments: item.multiVoiceMetadata!.segments.map((segment) =>
          segment.id === "segment-one" ? { ...segment, generationCount: 2, resultSha256: "segment-one-hash-2" } : segment
        ),
      },
    }
    rerender(<TooltipProvider>{renderPanel(nextItem)}</TooltipProvider>)

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    expect(screen.getByRole("button", { name: /voice for segment 1: narrator/i })).toBeInTheDocument()

    await user.click(screen.getAllByRole("button", { name: /^Regenerate$/i })[0])

    expect(onRegenerateSegment).toHaveBeenLastCalledWith("segment-one", null)
  })

  it("regenerates with the current voice when no override is selected", async () => {
    const user = userEvent.setup()
    const onRegenerateSegment = vi.fn()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        error={null}
        isDeleteDisabled={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={onRegenerateSegment}
        segmentResultUrls={{ "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result" }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    await user.click(screen.getAllByRole("button", { name: /^Regenerate$/i })[0])

    expect(onRegenerateSegment).toHaveBeenCalledWith("segment-one", null)
  })
})
