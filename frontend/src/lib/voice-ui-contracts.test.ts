import { describe, expect, it } from "vitest"

import {
  applyTranscriptCorrection,
  hasBrowserObjectUrl,
  validateTranscriptDocument,
  type TranscriptDocument,
} from "@/lib/voice-ui-contracts"

const document: TranscriptDocument = {
  id: "transcript-1",
  revision: 0,
  speakers: [{ id: "speaker-1", label: "Speaker 1" }],
  segments: [
    {
      endSeconds: 1.2,
      id: "segment-1",
      speakerId: "speaker-1",
      startSeconds: 0,
      text: "Hello there.",
      words: [
        { endSeconds: 0.5, id: "word-1", startSeconds: 0, text: "Hello" },
        { endSeconds: 1.2, id: "word-2", startSeconds: 0.6, text: "there." },
      ],
    },
  ],
}

describe("voice UI contracts", () => {
  it("keeps a corrected transcript presentation provider-neutral and invalidates affected word timing", () => {
    const corrected = applyTranscriptCorrection(document, "segment-1", "Hello, everyone.")

    expect(corrected).toMatchObject({ id: "transcript-1", revision: 1 })
    expect(corrected.segments[0]).toEqual({
      endSeconds: 1.2,
      id: "segment-1",
      speakerId: "speaker-1",
      startSeconds: 0,
      text: "Hello, everyone.",
      words: undefined,
    })
  })

  it("validates ordered segments and provider-neutral speaker references", () => {
    expect(validateTranscriptDocument(document)).toBe(true)
    expect(
      validateTranscriptDocument({
        ...document,
        segments: [{ ...document.segments[0], speakerId: "provider-voice-id" }],
      })
    ).toBe(false)
  })

  it("rejects malformed word alignment so synchronized views can fall back to segment timing", () => {
    const validWords = document.segments[0].words ?? []

    for (const words of [
      [{ ...validWords[0], id: "" }, validWords[1]],
      [{ ...validWords[0] }, { ...validWords[1], id: validWords[0].id }],
      [{ ...validWords[0] }, { ...validWords[1], startSeconds: 0.4 }],
      [{ ...validWords[0], endSeconds: 1.3 }, validWords[1]],
    ]) {
      expect(validateTranscriptDocument({ ...document, segments: [{ ...document.segments[0], words }] })).toBe(false)
    }
  })

  it("identifies only browser-owned object URLs for later cleanup", () => {
    expect(hasBrowserObjectUrl({ id: "preview-1", kind: "voicePreview", label: "Preview", url: "blob:preview" })).toBe(
      true
    )
    expect(hasBrowserObjectUrl({ id: "preview-1", kind: "voicePreview", label: "Preview", url: "/api/voices/1/sample" })).toBe(
      false
    )
  })
})
