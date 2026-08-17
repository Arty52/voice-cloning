import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TranscriptDocument } from "@/lib/voice-ui-contracts"

import { SynchronizedTranscriptViewer } from "./synchronized-transcript-viewer"

const document: TranscriptDocument = {
  id: "transcript:job-1",
  revision: 0,
  speakers: [
    { id: "speaker-1", label: "Morgan" },
    { id: "speaker-2", label: "Speaker 2" },
  ],
  segments: [
    {
      id: "segment-1",
      speakerId: "speaker-1",
      startSeconds: 0,
      endSeconds: 2,
      text: "Hello there.",
      words: [
        { id: "word-1", text: "Hello", startSeconds: 0, endSeconds: 0.8 },
        { id: "word-2", text: "there.", startSeconds: 0.9, endSeconds: 2 },
      ],
    },
    {
      id: "segment-2",
      speakerId: "speaker-2",
      startSeconds: 3,
      endSeconds: 5,
      text: "Segment timing fallback.",
    },
  ],
}

describe("SynchronizedTranscriptViewer", () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
  })

  it("shows deterministic past, current, and future word states from playback time", () => {
    render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />,
    )

    expect(screen.getByRole("button", { name: "Seek to Hello at 0:00" })).toHaveAttribute(
      "data-playback-state",
      "past",
    )
    expect(screen.getByRole("button", { name: "Seek to there. at 0:00" })).toHaveAttribute(
      "aria-current",
      "true",
    )
    expect(screen.getByRole("button", { name: "Seek to transcript segment: Segment timing fallback." })).toBeVisible()
    expect(screen.getByText("Speaker 2").closest("article")).toHaveAttribute("data-playback-state", "future")
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" })
  })

  it("emits semantic click and keyboard seek intent for words and fallback segments", async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    render(<SynchronizedTranscriptViewer currentTimeSeconds={null} document={document} onSeek={onSeek} />)

    await user.click(screen.getByRole("button", { name: "Seek to there. at 0:00" }))
    screen.getByRole("button", { name: "Seek to transcript segment: Segment timing fallback." }).focus()
    await user.keyboard("{Enter}")

    expect(onSeek).toHaveBeenNthCalledWith(1, 0.9)
    expect(onSeek).toHaveBeenNthCalledWith(2, 3)
  })

  it("pauses auto-follow after manual reading and returns without moving focus", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />,
    )
    scrollIntoView.mockClear()

    fireEvent.wheel(screen.getByRole("region", { name: "Synchronized Transcript" }).querySelector("[data-radix-scroll-area-viewport]")!)
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={3.5} document={document} onSeek={vi.fn()} />)

    const returnButton = screen.getByRole("button", { name: "Return To Current" })
    expect(scrollIntoView).not.toHaveBeenCalled()
    returnButton.focus()
    await user.click(returnButton)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" })
    expect(returnButton).toHaveFocus()
  })

  it("keeps following for keyboard seek controls and pauses for viewport scroll keys", () => {
    const { rerender } = render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />,
    )
    scrollIntoView.mockClear()
    const word = screen.getByRole("button", { name: "Seek to there. at 0:00" })

    fireEvent.keyDown(word, { key: "Tab" })
    fireEvent.keyDown(word, { key: "Enter" })
    fireEvent.keyDown(word, { key: " " })
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={3.5} document={document} onSeek={vi.fn()} />)
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Following Current" })).toBeDisabled()

    scrollIntoView.mockClear()
    const viewport = screen
      .getByRole("region", { name: "Synchronized Transcript" })
      .querySelector("[data-radix-scroll-area-viewport]")!
    fireEvent.keyDown(viewport, { key: "PageUp" })
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Return To Current" })).toBeEnabled()
  })

  it("renders an explicit empty state", () => {
    render(
      <SynchronizedTranscriptViewer
        currentTimeSeconds={null}
        document={{ ...document, segments: [] }}
        onSeek={vi.fn()}
      />,
    )

    expect(screen.getByText("No transcript dialogue is available.")).toBeVisible()
  })
})
