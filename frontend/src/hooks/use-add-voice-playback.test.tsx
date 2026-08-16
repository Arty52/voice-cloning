import type { ReactNode } from "react"

import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PlaybackControllerProvider, usePlaybackController } from "./use-playback-controller"
import { useAddVoicePlayback } from "./use-add-voice-playback"

const wrapper = ({ children }: { children: ReactNode }) => (
  <PlaybackControllerProvider>{children}</PlaybackControllerProvider>
)

function useHarness(options: Parameters<typeof useAddVoicePlayback>[0]) {
  return {
    controller: usePlaybackController(),
    playback: useAddVoicePlayback(options),
  }
}

describe("useAddVoicePlayback", () => {
  const initialOptions: Parameters<typeof useAddVoicePlayback>[0] = {
    isActive: true,
    sourceLabel: "Uploaded Voice Sample Preview",
    sourceUrl: "blob:voice-sample",
  }

  it("owns one shared upload source for the preview and cropper", () => {
    const { result } = renderHook((options) => useHarness(options), { initialProps: initialOptions, wrapper })

    expect(result.current.playback.source).toMatchObject({
      id: "add-voice:sample-preview",
      kind: "voicePreview",
      url: "blob:voice-sample",
    })
    act(() => {
      expect(result.current.playback.activate()).toBe(true)
    })
    expect(result.current.controller.snapshot.source?.id).toBe("add-voice:sample-preview")
  })

  it("clears its playback when Add Voice closes or its selected file is removed", () => {
    const { result, rerender } = renderHook((options) => useHarness(options), { initialProps: initialOptions, wrapper })

    act(() => {
      result.current.playback.activate()
    })
    rerender({ ...initialOptions, isActive: false })
    expect(result.current.controller.snapshot.source).toBeNull()

    rerender(initialOptions)
    act(() => {
      result.current.playback.activate()
    })
    rerender({ ...initialOptions, sourceUrl: null })
    expect(result.current.controller.snapshot.source).toBeNull()
  })

  it("replaces the active media when the selected file changes", () => {
    const { result, rerender } = renderHook((options) => useHarness(options), { initialProps: initialOptions, wrapper })

    act(() => {
      result.current.playback.activate()
    })
    rerender({ ...initialOptions, sourceUrl: "blob:replacement" })
    expect(result.current.controller.snapshot.source?.url).toBe("blob:replacement")
  })
})
