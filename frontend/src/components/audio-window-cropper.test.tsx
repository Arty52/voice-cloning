import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PlaybackControllerProvider, usePlaybackController } from "@/hooks/use-playback-controller"
import type { PlaybackController, PlaybackSource } from "@/lib/voice-ui-contracts"
import { AudioWindowCropper } from "./audio-window-cropper"

const source: PlaybackSource = {
  id: "add-voice:sample-preview",
  kind: "voicePreview",
  label: "Uploaded Voice Sample Preview",
  url: "blob:voice-sample",
}

function CropperHarness({ onActivate = vi.fn() }: { onActivate?: () => void }) {
  const controller = usePlaybackController()
  return (
    <Cropper
      controller={controller}
      onActivate={() => {
        onActivate()
        controller.dispatch({ source, type: "replaceSource" })
        return true
      }}
    />
  )
}

function Cropper({ controller, onActivate }: { controller: PlaybackController; onActivate: () => boolean }) {
  return (
    <AudioWindowCropper
      durationSeconds={30}
      maxWindowSeconds={20}
      onActivatePlayback={onActivate}
      onSampleModeChange={vi.fn()}
      onWindowChange={vi.fn()}
      playbackController={controller}
      recommendedMaxSeconds={15}
      recommendedMinSeconds={5}
      sampleMode="excerpt"
      source={source}
      window={{ durationSeconds: 10, startSeconds: 4 }}
    />
  )
}

describe("AudioWindowCropper", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("uses the shared media owner to play only the selected window", () => {
    const onActivate = vi.fn()
    render(
      <PlaybackControllerProvider>
        <CropperHarness onActivate={onActivate} />
      </PlaybackControllerProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Play Selection" }))

    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll("audio")).toHaveLength(1)
  })

  it("switches an active full preview to the selected window", async () => {
    render(
      <PlaybackControllerProvider>
        <CropperHarness />
        <FullPreviewActivator />
      </PlaybackControllerProvider>
    )
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media controller.")
    }
    Object.defineProperty(audio, "duration", { configurable: true, value: 30 })

    fireEvent.click(screen.getByRole("button", { name: "Start Full Preview" }))
    fireEvent.play(audio)
    expect(screen.getByRole("button", { name: "Play Selection" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Play Selection" }))

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2))
    expect(audio.currentTime).toBe(4)
    expect(screen.getByRole("button", { name: "Pause Selection" })).toBeInTheDocument()
  })
})

function FullPreviewActivator() {
  const controller = usePlaybackController()
  return (
    <button
      onClick={() => {
        controller.dispatch({ source, type: "replaceSource" })
        controller.dispatch({ type: "play" })
      }}
      type="button"
    >
      Start Full Preview
    </button>
  )
}
