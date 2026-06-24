import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AudioFileDropZone } from "@/components/audio-file-drop-zone"

describe("AudioFileDropZone", () => {
  it("shows supported audio formats in the helper copy", () => {
    render(<AudioFileDropZone id="sample-file" label="Sample File" onFileSelect={vi.fn()} />)

    expect(
      screen.getByText("Drag an audio file here, or choose one from your computer. Supports MP3, WAV, M4A, AAC, OGG, and FLAC.")
    ).toBeInTheDocument()
  })

  it("clears the hidden file input after selection so the same file can be selected again", async () => {
    const user = userEvent.setup()
    const onFileSelect = vi.fn()
    const file = new File(["sample"], "voice.wav", { type: "audio/wav" })

    render(<AudioFileDropZone id="sample-file" label="Sample File" onFileSelect={onFileSelect} />)

    const input = screen.getByLabelText("Sample File") as HTMLInputElement
    await user.upload(input, file)

    expect(onFileSelect).toHaveBeenCalledWith(file)
    expect(input.value).toBe("")

    await user.upload(input, file)

    expect(onFileSelect).toHaveBeenCalledTimes(2)
    expect(onFileSelect).toHaveBeenLastCalledWith(file)
    expect(input.value).toBe("")
  })
})
