import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PlaybackControllerProvider } from "@/hooks/use-playback-controller"
import { useGeneratedAudioPlayback } from "./use-generated-audio-playback"
import type { GeneratedResult } from "@/types"

const item = {
  appVoiceId: "narrator",
  cacheState: "miss",
  characterCount: 10,
  contentType: "audio/mpeg",
  createdAt: "2026-08-08T00:00:00.000Z",
  generatedAt: "Aug 8, 2026",
  generationElapsedMs: 100,
  id: "generated-1",
  modelId: "eleven_flash_v2_5",
  multiVoiceMetadata: null,
  requestId: null,
  sha256: "hash",
  sizeBytes: 12,
  scriptSnapshot: null,
  tuningMetadata: null,
  url: "blob:generated-1",
  voiceId: "narrator",
  voiceName: "Narrator",
} satisfies GeneratedResult

function wrapper({ children }: { children: ReactNode }) {
  return <PlaybackControllerProvider>{children}</PlaybackControllerProvider>
}

describe("useGeneratedAudioPlayback", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it("shares one owner between archive and latest rows, then clears removed audio", async () => {
    const initialProps: { items: GeneratedResult[]; latestItem: GeneratedResult | null } = {
      items: [item],
      latestItem: item,
    }
    const { result, rerender } = renderHook(
      ({ items, latestItem }: { items: GeneratedResult[]; latestItem: GeneratedResult | null }) =>
        useGeneratedAudioPlayback({ items, latestItem, segmentResultUrls: {} }),
      {
        initialProps,
        wrapper,
      },
    )

    act(() => expect(result.current.activateItem(item.id)).toBe(true))
    expect(result.current.controller.snapshot.source).toMatchObject({
      id: "generated-audio:generated-1",
      url: item.url,
    })
    expect(result.current.itemSources.get(item.id)).toBe(result.current.itemSources.get(item.id))

    rerender({ items: [], latestItem: null })
    await waitFor(() => expect(result.current.controller.snapshot.source).toBeNull())
  })

  it("uses a distinct stable source for the latest dialogue segment", () => {
    const dialogueItem = {
      ...item,
      multiVoiceMetadata: {
        jobId: "job-1",
        resultSha256: "hash",
        segmentCount: 1,
        segments: [
          {
            assignmentKind: "default" as const,
            characterCount: 10,
            generationCount: 1,
            id: "segment-1",
            index: 0,
            resultSha256: "segment-hash",
            text: "Hello.",
            voiceId: "narrator",
            voiceName: "Narrator",
          },
        ],
        voices: [{ segmentCount: 1, voiceId: "narrator", voiceName: "Narrator" }],
      },
    } satisfies GeneratedResult
    const { result } = renderHook(
      () =>
        useGeneratedAudioPlayback({
          items: [],
          latestItem: dialogueItem,
          segmentResultUrls: { "segment-1": "blob:segment-1" },
        }),
      { wrapper },
    )

    act(() => expect(result.current.activateSegment("segment-1")).toBe(true))
    expect(result.current.controller.snapshot.source).toMatchObject({
      id: "generated-audio:generated-1:segment:segment-1",
      url: "blob:segment-1",
    })
  })
})
