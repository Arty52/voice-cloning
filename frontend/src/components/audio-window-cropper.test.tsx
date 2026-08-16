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

function Cropper({
  controller,
  onActivate,
  window = { durationSeconds: 10, startSeconds: 4 },
}: {
  controller: PlaybackController
  onActivate: () => boolean
  window?: { durationSeconds: number; startSeconds: number }
}) {
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
      window={window}
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

  it("pauses a stale selection preview when its window changes", async () => {
    const { rerender } = render(
      <PlaybackControllerProvider>
        <CropperWithWindow window={{ durationSeconds: 10, startSeconds: 4 }} />
        <SourceActivator />
        <SelectionPreviewActivator />
      </PlaybackControllerProvider>
    )
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media controller.")
    }

    fireEvent.click(screen.getByRole("button", { name: "Load Preview Source" }))
    fireEvent.click(screen.getByRole("button", { name: "Start Selection Preview" }))
    fireEvent.play(audio)
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear()

    rerender(
      <PlaybackControllerProvider>
        <CropperWithWindow window={{ durationSeconds: 10, startSeconds: 5 }} />
        <SelectionPreviewActivator />
      </PlaybackControllerProvider>
    )

    await waitFor(() => expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce())
    expect(screen.getByRole("button", { name: "Play Selection" })).toBeInTheDocument()
  })

  it("keeps a selection active when browser metadata clamps its end", async () => {
    render(
      <PlaybackControllerProvider>
        <CropperHarness />
        <SourceActivator />
        <SelectionPreviewActivator />
      </PlaybackControllerProvider>
    )
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media controller.")
    }
    fireEvent.click(screen.getByRole("button", { name: "Load Preview Source" }))
    Object.defineProperty(audio, "duration", { configurable: true, value: 9.995 })
    fireEvent.loadedMetadata(audio)
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear()

    fireEvent.click(screen.getByRole("button", { name: "Start Selection Preview" }))
    fireEvent.play(audio)

    await waitFor(() => expect(screen.getByRole("button", { name: "Pause Selection" })).toBeInTheDocument())
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled()
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

function SelectionPreviewActivator() {
  const controller = usePlaybackController()
  return (
    <button
      onClick={() => {
        controller.dispatch({ endSeconds: 14, startSeconds: 4, type: "playRange" })
      }}
      type="button"
    >
      Start Selection Preview
    </button>
  )
}

function SourceActivator() {
  const controller = usePlaybackController()
  return (
    <button onClick={() => controller.dispatch({ source, type: "replaceSource" })} type="button">
      Load Preview Source
    </button>
  )
}

function CropperWithWindow({ window }: { window: { durationSeconds: number; startSeconds: number } }) {
  const controller = usePlaybackController()
  return <Cropper controller={controller} onActivate={() => true} window={window} />
}
