import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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
})
