import { describe, expect, it } from "vitest"

import { areVoiceAssignmentsStale, buildSpeechJobSegments, type VoiceTextAssignment } from "./voice-assignments"

const defaultVoice = { id: "narrator", name: "Narrator" }
const characterVoice = { id: "villain", name: "Villain" }

function assignment(overrides: Partial<VoiceTextAssignment> = {}): VoiceTextAssignment {
  const sourceText = "Narrator. Villain speaks. Narrator again."
  const start = sourceText.indexOf("Villain")
  const end = start + "Villain speaks.".length
  return {
    end,
    id: "villain-line",
    sourceText,
    start,
    text: sourceText.slice(start, end),
    voiceId: characterVoice.id,
    voiceName: characterVoice.name,
    ...overrides,
  }
}

describe("voice assignment segment building", () => {
  it("expands assignments and default spans into ordered speech job segments", () => {
    const text = "Narrator. Villain speaks. Narrator again."

    const result = buildSpeechJobSegments(text, [assignment()], defaultVoice)

    expect(result).toMatchObject({ error: null, stale: false })
    expect(result.segments.map((segment) => segment.text).join("")).toBe(text)
    expect(result.segments).toEqual([
      expect.objectContaining({
        assignmentKind: "default",
        text: "Narrator. ",
        voiceId: "narrator",
        voiceName: "Narrator",
      }),
      expect.objectContaining({
        assignmentId: "villain-line",
        assignmentKind: "assigned",
        clientSegmentId: "villain-line",
        text: "Villain speaks.",
        voiceId: "villain",
        voiceName: "Villain",
      }),
      expect.objectContaining({
        assignmentKind: "default",
        text: " Narrator again.",
        voiceId: "narrator",
      }),
    ])
  })

  it("folds whitespace-only gaps into neighboring speakable segments", () => {
    const text = "  Hello\n\nWorld  "
    const helloStart = text.indexOf("Hello")
    const helloEnd = helloStart + "Hello".length
    const worldStart = text.indexOf("World")
    const worldEnd = worldStart + "World".length

    const result = buildSpeechJobSegments(
      text,
      [
        assignment({
          end: helloEnd,
          id: "hello",
          sourceText: text,
          start: helloStart,
          text: "Hello",
        }),
        assignment({
          end: worldEnd,
          id: "world",
          sourceText: text,
          start: worldStart,
          text: "World",
        }),
      ],
      defaultVoice
    )

    expect(result.error).toBeNull()
    expect(result.segments).toHaveLength(2)
    expect(result.segments.map((segment) => segment.text)).toEqual(["  Hello\n\n", "World  "])
    expect(result.segments.map((segment) => segment.text).join("")).toBe(text)
  })

  it("detects stale assignments when the script changes and clears when exact text is restored", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const changedText = "Narrator. Villain whispers. Narrator again."
    const assignments = [assignment()]

    expect(areVoiceAssignmentsStale(changedText, assignments)).toBe(true)
    expect(buildSpeechJobSegments(changedText, assignments, defaultVoice)).toMatchObject({
      error: null,
      segments: [],
      stale: true,
    })
    expect(areVoiceAssignmentsStale(originalText, assignments)).toBe(false)
  })

  it("rejects overlapping assignments", () => {
    const text = "abcdef"

    const result = buildSpeechJobSegments(
      text,
      [
        assignment({ end: 4, id: "first", sourceText: text, start: 0, text: "abcd" }),
        assignment({ end: 6, id: "second", sourceText: text, start: 3, text: "def" }),
      ],
      defaultVoice
    )

    expect(result).toEqual({
      error: "Voice assignments cannot overlap.",
      segments: [],
      stale: false,
    })
  })

  it("rejects assignments outside the current script text", () => {
    const text = "short"

    const result = buildSpeechJobSegments(
      text,
      [assignment({ end: 8, id: "outside", sourceText: text, start: 0, text: "short" })],
      defaultVoice
    )

    expect(result).toEqual({
      error: "Voice assignments must stay within the current script text.",
      segments: [],
      stale: false,
    })
  })
})
