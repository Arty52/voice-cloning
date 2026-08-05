import { afterEach, describe, expect, it, vi } from "vitest"

import type { SpeakerSeparationResult } from "@/types"

import {
  downloadTranscript,
  formatTranscript,
  formatTranscriptTimestamp,
  transcriptExportFilename,
} from "./transcript-export"

const result: SpeakerSeparationResult = {
  kind: "speakerSeparation",
  speakers: [
    {
      id: "speaker-1",
      label: "Speaker 1",
      assignedName: "Morgan",
      transcriptItemIds: ["item-1", "item-3"],
      result: null,
    },
    {
      id: "speaker-2",
      label: "Speaker 2",
      assignedName: null,
      transcriptItemIds: ["item-2"],
      result: null,
    },
  ],
  transcript: {
    items: [
      { id: "item-3", text: "Third line.", startSeconds: 3661.9, endSeconds: 3663, speakerId: "speaker-1" },
      { id: "item-1", text: "First line.", startSeconds: 0.4, endSeconds: 1.2, speakerId: "speaker-1" },
      { id: "item-2", text: "Second line.", startSeconds: 61.2, endSeconds: 62, speakerId: "speaker-2" },
    ],
  },
}

describe("transcript export formatting", () => {
  it("exports every turn chronologically as Markdown with assigned and placeholder names", () => {
    expect(
      formatTranscript({
        format: "markdown",
        includeStartTimes: true,
        result,
        sourceName: "Planning Session.m4a",
      })
    ).toBe(
      "# Planning Session Transcript\n\n" +
        "[00:00:00] **Morgan:** First line.\n" +
        "[00:01:01] **Speaker 2:** Second line.\n" +
        "[01:01:01] **Morgan:** Third line.\n"
    )
  })

  it("exports clean TXT and prefers current speaker-name drafts", () => {
    expect(
      formatTranscript({
        format: "text",
        result,
        sourceName: "Planning Session.m4a",
        speakerNames: { "speaker-2": "Riley" },
      })
    ).toBe(
      "Planning Session Transcript\n\n" +
        "Morgan: First line.\n" +
        "Riley: Second line.\n" +
        "Morgan: Third line.\n"
    )
  })

  it("formats timestamps and safe deterministic filenames", () => {
    expect(formatTranscriptTimestamp(-2)).toBe("00:00:00")
    expect(formatTranscriptTimestamp(3723.8)).toBe("01:02:03")
    expect(transcriptExportFilename("  Café / Planning?.MP3  ", "markdown")).toBe(
      "cafe-planning-transcript.md"
    )
    expect(transcriptExportFilename("...", "text")).toBe("audio-transcript.txt")
  })
})

describe("downloadTranscript", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("clicks a temporary download and cleans up its object URL and anchor", () => {
    const createObjectUrl = vi.fn(() => "blob:transcript")
    const revokeObjectUrl = vi.fn()
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    const append = vi.spyOn(document.body, "append")

    const filename = downloadTranscript({ format: "text", result, sourceName: "Planning Session.m4a" })

    expect(filename).toBe("planning-session-transcript.txt")
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledOnce()
    const anchor = append.mock.calls[0][0] as HTMLAnchorElement
    expect(anchor.download).toBe(filename)
    expect(anchor.isConnected).toBe(false)
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:transcript")
  })
})
