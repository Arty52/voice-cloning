import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  const scrollTo = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockReset()
    scrollTo.mockReset()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 0 })
    expect(scrollIntoView).not.toHaveBeenCalled()
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

  it("falls back to the complete segment when alignment covers only part of its text", () => {
    const partialDocument: TranscriptDocument = {
      ...document,
      segments: [
        {
          ...document.segments[0],
          words: [{ id: "word-1", text: "Hello", startSeconds: 0, endSeconds: 0.8 }],
        },
      ],
    }

    render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={partialDocument} onSeek={vi.fn()} />,
    )

    expect(screen.getByRole("button", { name: "Seek to transcript segment: Hello there." })).toHaveTextContent(
      "Hello there.",
    )
    expect(screen.queryByRole("button", { name: "Seek to Hello at 0:00" })).not.toBeInTheDocument()
  })

  it("pauses auto-follow after manual reading and returns without moving focus", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />,
    )
    scrollTo.mockClear()

    fireEvent.wheel(screen.getByRole("region", { name: "Synchronized Transcript" }).querySelector("[data-radix-scroll-area-viewport]")!)
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={3.5} document={document} onSeek={vi.fn()} />)

    const returnButton = screen.getByRole("button", { name: "Return To Current" })
    expect(scrollTo).not.toHaveBeenCalled()
    returnButton.focus()
    await user.click(returnButton)
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 0 })
    expect(returnButton).toHaveFocus()
  })

  it("keeps following for keyboard seek controls and pauses for viewport scroll keys", () => {
    const { rerender } = render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />,
    )
    scrollTo.mockClear()
    const word = screen.getByRole("button", { name: "Seek to there. at 0:00" })

    fireEvent.keyDown(word, { key: "Tab" })
    fireEvent.keyDown(word, { key: "Enter" })
    fireEvent.keyDown(word, { key: " " })
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={3.5} document={document} onSeek={vi.fn()} />)
    expect(scrollTo).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Following Current" })).toBeDisabled()

    scrollTo.mockClear()
    const viewport = screen
      .getByRole("region", { name: "Synchronized Transcript" })
      .querySelector("[data-radix-scroll-area-viewport]")!
    fireEvent.keyDown(viewport, { key: "PageUp" })
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Return To Current" })).toBeEnabled()
  })

  it("pauses following when a focused seek control receives a manual scroll key", () => {
    const { rerender } = render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />,
    )
    scrollTo.mockClear()
    const word = screen.getByRole("button", { name: "Seek to there. at 0:00" })

    word.focus()
    fireEvent.keyDown(word, { key: "PageDown" })
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={3.5} document={document} onSeek={vi.fn()} />)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Return To Current" })).toBeEnabled()
    expect(word).toHaveFocus()
  })

  it("pauses following when the scrollbar receives pointer input", () => {
    const { rerender } = render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />,
    )
    scrollTo.mockClear()
    const viewport = screen
      .getByRole("region", { name: "Synchronized Transcript" })
      .querySelector("[data-radix-scroll-area-viewport]")
    const scrollbar = window.document.createElement("div")
    scrollbar.dataset.slot = "scroll-area-scrollbar"
    viewport?.parentElement?.append(scrollbar)

    fireEvent.pointerDown(scrollbar)
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={3.5} document={document} onSeek={vi.fn()} />)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Return To Current" })).toBeEnabled()
  })

  it("does not reconstruct stable transcript rows for playback ticks within one word", () => {
    let textReads = 0
    const segments = Array.from({ length: 100 }, (_, index) => {
      const text = `Word${index}`
      return {
        endSeconds: index + 0.9,
        get text() {
          textReads += 1
          return text
        },
        id: `segment-${index}`,
        speakerId: "speaker-1",
        startSeconds: index,
        words: [
          {
            endSeconds: index + 0.9,
            id: `word-${index}`,
            startSeconds: index,
            text,
          },
        ],
      }
    })
    const longDocument: TranscriptDocument = { ...document, segments }
    const { rerender } = render(
      <SynchronizedTranscriptViewer currentTimeSeconds={0.1} document={longDocument} onSeek={vi.fn()} />,
    )
    const readsAfterInitialRender = textReads

    rerender(
      <SynchronizedTranscriptViewer currentTimeSeconds={0.2} document={longDocument} onSeek={vi.fn()} />,
    )

    expect(textReads).toBe(readsAfterInitialRender)
    expect(screen.getAllByRole("button", { name: /^Seek to Word/ })).toHaveLength(100)
  })

  it("follows the canonical segment when transcript timings overlap", async () => {
    const user = userEvent.setup()
    const overlappingDocument: TranscriptDocument = {
      ...document,
      segments: [
        {
          endSeconds: 3,
          id: "overlap-first",
          speakerId: "speaker-1",
          startSeconds: 0,
          text: "First overlapping segment.",
        },
        {
          endSeconds: 4,
          id: "overlap-second",
          speakerId: "speaker-2",
          startSeconds: 1,
          text: "Second overlapping segment.",
        },
      ],
    }
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.tagName === "ARTICLE" && this.textContent?.includes("First overlapping segment.")) {
        return { bottom: 10, height: 20, left: 0, right: 100, top: -10, width: 100, x: 0, y: -10, toJSON: vi.fn() }
      }
      return { bottom: 80, height: 80, left: 0, right: 100, top: 0, width: 100, x: 0, y: 0, toJSON: vi.fn() }
    })

    render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1.5} document={overlappingDocument} onSeek={vi.fn()} />,
    )

    const currentRows = screen.getByRole("region", { name: "Synchronized Transcript" }).querySelectorAll(
      "article[aria-current='true']",
    )
    expect(currentRows).toHaveLength(1)
    expect(currentRows[0]).toHaveTextContent("First overlapping segment.")
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: -10 })

    fireEvent.wheel(currentRows[0])
    await user.click(screen.getByRole("button", { name: "Return To Current" }))
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", top: -10 })
  })

  it("disables automatic scrolling for reduced motion while keeping manual return available", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        removeEventListener: vi.fn(),
      })),
    )
    const { rerender } = render(
      <SynchronizedTranscriptViewer currentTimeSeconds={1} document={document} onSeek={vi.fn()} />,
    )

    expect(scrollTo).not.toHaveBeenCalled()
    const returnButton = screen.getByRole("button", { name: "Return To Current" })
    expect(returnButton).toBeEnabled()
    await user.click(returnButton)
    expect(scrollTo).toHaveBeenCalledOnce()
    expect(returnButton).toHaveFocus()

    scrollTo.mockClear()
    rerender(<SynchronizedTranscriptViewer currentTimeSeconds={3.5} document={document} onSeek={vi.fn()} />)
    expect(scrollTo).not.toHaveBeenCalled()
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
