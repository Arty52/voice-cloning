import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MediaFileDropZone } from "@/components/media-file-drop-zone"

describe("MediaFileDropZone", () => {
  it("shows supported audio formats in the helper copy", () => {
    render(<MediaFileDropZone id="sample-file" label="Sample File" onFileSelect={vi.fn()} />)

    expect(
      screen.getByText("Drag an audio file here, or choose one from your computer. Supports MP3, WAV, M4A, AAC, OGG, and FLAC.")
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Sample File")).toHaveAttribute(
      "accept",
      ".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/mpeg,audio/wav,audio/x-wav,audio/aac,audio/ogg,audio/flac"
    )
  })

  it("allows upload flows to provide broader accepted formats and helper copy", () => {
    render(
      <MediaFileDropZone
        accept="audio/*,.m4b"
        helperCopy="Supports MP3, WAV, M4A, M4B, AAC, OGG, and FLAC."
        id="sample-file"
        label="Sample File"
        onFileSelect={vi.fn()}
      />
    )

    expect(screen.getByText("Supports MP3, WAV, M4A, M4B, AAC, OGG, and FLAC.")).toBeInTheDocument()
    expect(screen.getByLabelText("Sample File")).toHaveAttribute("accept", "audio/*,.m4b")
  })

  it("allows source media flows to provide video labels and accepted formats", () => {
    render(
      <MediaFileDropZone
        accept=".mp4,.m4v,.mov,video/mp4,video/x-m4v,video/quicktime"
        ariaLabel="Video Drop Zone"
        chooseLabel="Choose Video"
        emptyLabel="Drop Video Here"
        helperCopy="Supports MP4, M4V, and MOV."
        id="source-video"
        label="Video File"
        onFileSelect={vi.fn()}
        selectedLabel="Video Selected"
      />
    )

    expect(screen.getByRole("group", { name: "Video Drop Zone" })).toBeInTheDocument()
    expect(screen.getByText("Drop Video Here")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /choose video/i })).toBeInTheDocument()
    expect(screen.getByLabelText("Video File")).toHaveAttribute(
      "accept",
      ".mp4,.m4v,.mov,video/mp4,video/x-m4v,video/quicktime"
    )
  })

  it("clears the hidden file input after selection so the same file can be selected again", async () => {
    const user = userEvent.setup()
    const onFileSelect = vi.fn()
    const file = new File(["sample"], "voice.wav", { type: "audio/wav" })

    render(<MediaFileDropZone id="sample-file" label="Sample File" onFileSelect={onFileSelect} />)

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
