import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { PlaybackControllerProvider, usePlaybackController } from "@/hooks/use-playback-controller"
import type { PlaybackSource } from "@/lib/voice-ui-contracts"
import { AudioPlayer, PlaybackControls } from "./audio-player"

const controlledSource: PlaybackSource = {
  id: "controlled-source",
  kind: "voicePreview",
  label: "Controlled preview",
  url: "blob:controlled-preview",
}

function renderPlayer(player: ReactNode) {
  return render(<PlaybackControllerProvider>{player}</PlaybackControllerProvider>)
}

function getSharedAudio() {
  const audio = document.querySelector("audio")
  if (!audio) {
    throw new Error("Expected the shared media element.")
  }
  return audio
}

function ControlledPlayback({ onBeforeSeek }: { onBeforeSeek: () => void }) {
  const controller = usePlaybackController()
  return (
    <>
      <button onClick={() => controller.dispatch({ source: controlledSource, type: "replaceSource" })} type="button">
        Load Controlled Source
      </button>
      <PlaybackControls
        ariaLabel="Controlled preview"
        controller={controller}
        onActivate={() => controller.dispatch({ source: controlledSource, type: "replaceSource" })}
        onBeforeSeek={onBeforeSeek}
        source={controlledSource}
      />
    </>
  )
}

describe("AudioPlayer", () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => false)
    HTMLElement.prototype.releasePointerCapture ??= vi.fn()
    HTMLElement.prototype.scrollIntoView ??= vi.fn()
    HTMLElement.prototype.setPointerCapture ??= vi.fn()
  })

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders accessible controller-backed playback controls for a legacy source", () => {
    renderPlayer(<AudioPlayer ariaLabel="Selected voice sample preview" src="/api/voices/default/sample" />)

    expect(screen.getByRole("group", { name: /selected voice sample preview/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /play audio/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /rewind 10 seconds/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /forward 10 seconds/i })).toBeDisabled()
    expect(screen.getByRole("slider", { name: /audio position/i })).toHaveAttribute("data-disabled")
    expect(screen.getByRole("combobox", { name: /playback rate/i })).toBeDisabled()
    expect(screen.getByRole("status", { name: /elapsed 0:00 of unknown duration/i })).toBeInTheDocument()
    expect(document.querySelectorAll("audio")).toHaveLength(1)
  })

  it("preserves standalone compatibility when a legacy consumer has no app controller", () => {
    render(<AudioPlayer ariaLabel="Standalone preview" src="blob:standalone" />)

    expect(screen.getByRole("group", { name: "Standalone preview" })).toBeInTheDocument()
    expect(document.querySelectorAll("audio")).toHaveLength(1)
  })

  it("loads a standalone source only once on mount", async () => {
    render(<AudioPlayer ariaLabel="Standalone preview" src="blob:standalone" />)

    await waitFor(() => expect(HTMLMediaElement.prototype.load).toHaveBeenCalled())
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1)
  })

  it("plays and pauses the selected audio through the shared controller", async () => {
    renderPlayer(<AudioPlayer ariaLabel="Generated voice playback" src="blob:generated-audio" />)
    const audio = getSharedAudio()

    fireEvent.click(screen.getByRole("button", { name: /play audio/i }))
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    fireEvent.play(audio)
    expect(screen.getByRole("button", { name: /pause audio/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /pause audio/i }))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  })

  it("runs a surface-specific transition before full-preview seek controls", () => {
    const onBeforeSeek = vi.fn()
    renderPlayer(<ControlledPlayback onBeforeSeek={onBeforeSeek} />)
    const audio = getSharedAudio()
    fireEvent.click(screen.getByRole("button", { name: "Load Controlled Source" }))
    Object.defineProperty(audio, "duration", { configurable: true, value: 30 })
    fireEvent.loadedMetadata(audio)

    fireEvent.click(screen.getByRole("button", { name: "Forward 10 Seconds" }))

    expect(onBeforeSeek).toHaveBeenCalledOnce()
  })

  it("announces controlled loading and errors for the active source", () => {
    renderPlayer(<AudioPlayer ariaLabel="Generated voice playback" src="blob:generated-audio" />)
    const audio = getSharedAudio()

    fireEvent.click(screen.getByRole("button", { name: /play audio/i }))
    expect(screen.getByRole("status", { name: "Loading Audio" })).toBeInTheDocument()

    fireEvent.error(audio)
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load this audio.")
  })

  it("supports keyboard seeking, a selected rate, and elapsed duration output", async () => {
    const user = userEvent.setup()
    renderPlayer(<AudioPlayer ariaLabel="Generated voice playback" src="blob:generated-audio" />)
    const audio = getSharedAudio()
    Object.defineProperty(audio, "duration", { configurable: true, value: 125 })

    fireEvent.click(screen.getByRole("button", { name: /play audio/i }))
    fireEvent.loadedMetadata(audio)
    const slider = screen.getByRole("slider", { name: /audio position/i })
    slider.focus()
    await user.keyboard("{ArrowRight}")

    expect(screen.getByRole("button", { name: /rewind 10 seconds/i })).not.toBeDisabled()
    expect(screen.getByRole("status", { name: /elapsed 0:00 of 2:05/i })).toHaveTextContent("0:00 / 2:05")

    await user.click(screen.getByRole("combobox", { name: /playback rate/i }))
    await user.click(screen.getByRole("option", { name: "1.5x" }))
    expect(audio.playbackRate).toBe(1.5)
  })

  it("labels both the slider root and thumb, while keeping elapsed time out of live announcements", () => {
    const { container } = renderPlayer(<AudioPlayer ariaLabel="Generated voice playback" src="blob:generated-audio" />)

    expect(container.querySelector('[data-slot="slider"]')).toHaveAttribute("aria-label", "Audio Position")
    expect(screen.getByRole("slider", { name: "Audio Position" })).toBeInTheDocument()
    expect(screen.getByRole("status", { name: /elapsed 0:00 of unknown duration/i })).toHaveAttribute("aria-live", "off")
  })

  it("makes two generic controls contend through the single shared media element", async () => {
    renderPlayer(
      <>
        <AudioPlayer ariaLabel="First audio" src="blob:first" />
        <AudioPlayer ariaLabel="Second audio" src="blob:second" />
      </>
    )
    const audio = getSharedAudio()
    const firstPlayer = within(screen.getByRole("group", { name: "First audio" }))
    const secondPlayer = within(screen.getByRole("group", { name: "Second audio" }))

    fireEvent.click(firstPlayer.getByRole("button", { name: /play audio/i }))
    await waitFor(() => expect(audio.src).toContain("blob:first"))
    fireEvent.play(audio)
    expect(firstPlayer.getByRole("button", { name: /pause audio/i })).toBeInTheDocument()

    fireEvent.click(secondPlayer.getByRole("button", { name: /play audio/i }))
    await waitFor(() => expect(audio.src).toContain("blob:second"))
    fireEvent.play(audio)

    expect(firstPlayer.getByRole("button", { name: /play audio/i })).toBeInTheDocument()
    expect(secondPlayer.getByRole("button", { name: /pause audio/i })).toBeInTheDocument()
    expect(document.querySelectorAll("audio")).toHaveLength(1)
  })

  it("replaces an active app-hosted source when its source props change", async () => {
    const { rerender } = render(
      <PlaybackControllerProvider>
        <AudioPlayer ariaLabel="First audio" src="blob:first" />
      </PlaybackControllerProvider>
    )
    const audio = getSharedAudio()

    fireEvent.click(screen.getByRole("button", { name: /play audio/i }))
    await waitFor(() => expect(audio.src).toContain("blob:first"))
    fireEvent.play(audio)
    expect(screen.getByRole("button", { name: /pause audio/i })).toBeInTheDocument()

    rerender(
      <PlaybackControllerProvider>
        <AudioPlayer ariaLabel="Replacement audio" src="blob:replacement" />
      </PlaybackControllerProvider>
    )

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(audio.src).toContain("blob:replacement")
    expect(screen.getByRole("group", { name: "Replacement audio" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /play audio/i })).toBeInTheDocument()
  })
})
