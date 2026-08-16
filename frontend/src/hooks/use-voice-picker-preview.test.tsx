import type { ReactNode } from "react"

import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PlaybackControllerProvider, usePlaybackController } from "./use-playback-controller"
import { useVoicePickerPreview } from "./use-voice-picker-preview"
import type { VoiceAsset } from "@/types"

const wrapper = ({ children }: { children: ReactNode }) => (
  <PlaybackControllerProvider>{children}</PlaybackControllerProvider>
)

const narrator = voice("narrator", "Narrator")
const villain = voice("villain", "Villain")

function useHarness(options: Parameters<typeof useVoicePickerPreview>[0]) {
  return {
    controller: usePlaybackController(),
    preview: useVoicePickerPreview(options),
  }
}

describe("useVoicePickerPreview", () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.pause = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  })

  it("keeps voice-picker previews mutually exclusive through the shared controller", () => {
    const { result } = renderHook((options) => useHarness(options), {
      initialProps: { isActive: true, voices: [narrator, villain] },
      wrapper,
    })

    act(() => {
      expect(result.current.preview.togglePreview(narrator.id)).toBe(true)
    })
    expect(result.current.controller.snapshot.source).toMatchObject({
      id: "voice-picker:narrator:preview",
      kind: "voicePreview",
    })

    act(() => {
      expect(result.current.preview.togglePreview(villain.id)).toBe(true)
    })
    expect(result.current.controller.snapshot.source).toMatchObject({
      id: "voice-picker:villain:preview",
      kind: "voicePreview",
    })
  })

  it("clears a preview when Speech Input becomes inactive or removes that voice", () => {
    const { result, rerender } = renderHook((options) => useHarness(options), {
      initialProps: { isActive: true, voices: [narrator, villain] },
      wrapper,
    })

    act(() => {
      result.current.preview.togglePreview(narrator.id)
    })
    rerender({ isActive: false, voices: [narrator, villain] })
    expect(result.current.controller.snapshot.source).toBeNull()

    rerender({ isActive: true, voices: [narrator, villain] })
    act(() => {
      result.current.preview.togglePreview(narrator.id)
    })
    rerender({ isActive: true, voices: [villain] })
    expect(result.current.controller.snapshot.source).toBeNull()
  })
})

function voice(id: string, name: string): VoiceAsset {
  return {
    contentType: "audio/mpeg",
    createdAt: "2026-08-16T00:00:00.000Z",
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
    voiceSettingsByProvider: {},
    windowDurationSeconds: null,
    windowStartSeconds: null,
  }
}
