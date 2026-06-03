import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AudioPlayer } from "./audio-player"

describe("AudioPlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders accessible playback controls for an audio source", () => {
    render(<AudioPlayer ariaLabel="Selected voice sample preview" src="/api/voices/default/sample" />)

    expect(screen.getByRole("group", { name: /selected voice sample preview/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /play audio/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /rewind 10 seconds/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /forward 10 seconds/i })).toBeDisabled()
    expect(screen.getByRole("slider", { name: /audio position/i })).toBeDisabled()
  })

  it("plays and pauses the current audio", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    render(<AudioPlayer ariaLabel="Generated voice playback" src="blob:generated-audio" />)

    fireEvent.click(screen.getByRole("button", { name: /play audio/i }))

    await waitFor(() => expect(play).toHaveBeenCalled())
    expect(await screen.findByRole("button", { name: /pause audio/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /pause audio/i }))

    expect(pause).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /play audio/i })).toBeInTheDocument()
  })

  it("enables scrubbing after metadata loads", () => {
    const { container } = render(<AudioPlayer ariaLabel="Generated voice playback" src="blob:generated-audio" />)
    const audio = container.querySelector("audio")
    if (!audio) {
      throw new Error("Expected audio element to render.")
    }
    Object.defineProperty(audio, "duration", { configurable: true, value: 125 })

    fireEvent.loadedMetadata(audio)
    fireEvent.change(screen.getByRole("slider", { name: /audio position/i }), { target: { value: "30" } })

    expect(audio.currentTime).toBe(30)
    expect(screen.getByRole("button", { name: /rewind 10 seconds/i })).not.toBeDisabled()
    expect(screen.getByText("0:30 / 2:05")).toBeInTheDocument()
  })
})
