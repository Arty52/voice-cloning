import type { ReactNode } from "react"

import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PlaybackControllerProvider, usePlaybackController } from "./use-playback-controller"
import { usePrepareAudioPlayback } from "./use-prepare-audio-playback"

const wrapper = ({ children }: { children: ReactNode }) => (
  <PlaybackControllerProvider>{children}</PlaybackControllerProvider>
)

const voice = {
  id: " saved-voice ",
  name: "Saved voice",
  filePath: "saved-voice.mp3",
  contentType: "audio/mpeg",
  sha256: "saved-voice-hash",
  source: "upload" as const,
  createdAt: "2026-01-01T00:00:00Z",
  sampleMode: "excerpt" as const,
  windowStartSeconds: null,
  windowDurationSeconds: null,
  sourceFilePath: null,
  sourceContentType: null,
  sourceSha256: null,
  voicePresetId: "standardNarration" as const,
  voiceSettingsByProvider: {},
  processingSteps: [],
}

function useHarness(options: Parameters<typeof usePrepareAudioPlayback>[0]) {
  return {
    controller: usePlaybackController(),
    playback: usePrepareAudioPlayback(options),
  }
}

describe("usePrepareAudioPlayback", () => {
  it("normalizes saved voice identifiers for lookup and activation", () => {
    const { result } = renderHook(
      () =>
        useHarness({
          candidateResultUrls: {},
          isActive: true,
          isEnabled: true,
          jobId: null,
          processedResultUrl: null,
          sourcePreview: null,
          voices: [voice],
        }),
      { wrapper }
    )

    expect(result.current.playback.sources.get("voice:saved-voice")?.url).toBe("/api/voices/saved-voice/sample")
    act(() => {
      expect(result.current.playback.activate("voice:saved-voice")).toBe(true)
    })
    expect(result.current.controller.snapshot.source?.id).toBe("prepare-audio:pending:voice:saved-voice")
  })

  it("clears active playback when Prepare Audio becomes inactive or disabled", () => {
    const initialOptions = {
      candidateResultUrls: {},
      isActive: true,
      isEnabled: true,
      jobId: null,
      processedResultUrl: null,
      sourcePreview: null,
      voices: [voice],
    }
    const { result, rerender } = renderHook((options) => useHarness(options), {
      initialProps: initialOptions,
      wrapper,
    })

    act(() => {
      result.current.playback.activate("voice:saved-voice")
    })
    expect(result.current.controller.snapshot.source).not.toBeNull()

    rerender({ ...initialOptions, isEnabled: false })
    expect(result.current.controller.snapshot.source).toBeNull()

    act(() => {
      result.current.playback.activate("voice:saved-voice")
    })
    rerender({ ...initialOptions, isActive: false })
    expect(result.current.controller.snapshot.source).toBeNull()
  })
})
