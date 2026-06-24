import { describe, expect, it } from "vitest"

import {
  areVoiceAssignmentsStale,
  buildSpeechJobSegments,
  createVoiceTextAssignment,
  reconcileVoiceAssignmentsForTextChange,
  type VoiceTextAssignment,
} from "./voice-assignments"

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
  it("creates assignments from multi-line selections", () => {
    const sourceText = "Narrator starts.\nVillain speaks.\nNarrator ends."
    const start = sourceText.indexOf("Villain")
    const end = sourceText.indexOf("Narrator ends.")

    expect(
      createVoiceTextAssignment({
        id: "multi-line-selection",
        selection: {
          end,
          start,
          text: sourceText.slice(start, end),
        },
        sourceText,
        voice: characterVoice,
      })
    ).toEqual({
      end,
      id: "multi-line-selection",
      sourceText,
      start,
      text: "Villain speaks.\n",
      voiceId: "villain",
      voiceName: "Villain",
    })
  })

  it("ignores whitespace-only selections", () => {
    expect(
      createVoiceTextAssignment({
        id: "empty",
        selection: { end: 2, start: 0, text: "\n " },
        sourceText: "\n ",
        voice: characterVoice,
      })
    ).toBeNull()
  })

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

describe("voice assignment text edit reconciliation", () => {
  it("shifts assignments after text inserted before an assigned span", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const nextText = `Intro. ${originalText}`

    const [reconciled] = reconcileVoiceAssignmentsForTextChange(originalText, nextText, [assignment()])

    expect(reconciled).toMatchObject({
      end: assignment().end + "Intro. ".length,
      sourceText: nextText,
      start: assignment().start + "Intro. ".length,
      text: "Villain speaks.",
    })
    expect(areVoiceAssignmentsStale(nextText, [reconciled])).toBe(false)
  })

  it("updates source snapshots after text inserted after an assigned span", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const nextText = `${originalText} Closing narration.`

    const [reconciled] = reconcileVoiceAssignmentsForTextChange(originalText, nextText, [assignment()])

    expect(reconciled).toMatchObject({
      end: assignment().end,
      sourceText: nextText,
      start: assignment().start,
      text: "Villain speaks.",
    })
    expect(areVoiceAssignmentsStale(nextText, [reconciled])).toBe(false)
  })

  it("shrinks assignments after text is deleted inside an assigned span", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const nextText = originalText.replace("speaks", "speak")

    const [reconciled] = reconcileVoiceAssignmentsForTextChange(originalText, nextText, [assignment()])

    expect(reconciled).toMatchObject({
      end: assignment().end - 1,
      sourceText: nextText,
      start: assignment().start,
      text: "Villain speak.",
    })
    expect(buildSpeechJobSegments(nextText, [reconciled], defaultVoice)).toMatchObject({
      error: null,
      stale: false,
    })
  })

  it("expands assignments after text is inserted inside an assigned span", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const nextText = originalText.replace("Villain speaks.", "Villain loudly speaks.")

    const [reconciled] = reconcileVoiceAssignmentsForTextChange(originalText, nextText, [assignment()])

    expect(reconciled).toMatchObject({
      end: assignment().end + "loudly ".length,
      sourceText: nextText,
      start: assignment().start,
      text: "Villain loudly speaks.",
    })
    expect(areVoiceAssignmentsStale(nextText, [reconciled])).toBe(false)
  })

  it("treats inserted text at an assignment end boundary as unassigned", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const assigned = assignment()
    const nextText = `${originalText.slice(0, assigned.end)} loudly${originalText.slice(assigned.end)}`

    const [reconciled] = reconcileVoiceAssignmentsForTextChange(originalText, nextText, [assigned])

    expect(reconciled).toMatchObject({
      end: assigned.end,
      sourceText: nextText,
      start: assigned.start,
      text: "Villain speaks.",
    })
    expect(areVoiceAssignmentsStale(nextText, [reconciled])).toBe(false)
  })

  it("treats inserted text at an assignment start boundary as unassigned before the assignment", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const assigned = assignment()
    const nextText = `${originalText.slice(0, assigned.start)}Angry ${originalText.slice(assigned.start)}`

    const [reconciled] = reconcileVoiceAssignmentsForTextChange(originalText, nextText, [assigned])

    expect(reconciled).toMatchObject({
      end: assigned.end + "Angry ".length,
      sourceText: nextText,
      start: assigned.start + "Angry ".length,
      text: "Villain speaks.",
    })
    expect(areVoiceAssignmentsStale(nextText, [reconciled])).toBe(false)
  })

  it("replaces text inside an assigned span", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const nextText = originalText.replace("speaks", "whispers")

    const [reconciled] = reconcileVoiceAssignmentsForTextChange(originalText, nextText, [assignment()])

    expect(reconciled).toMatchObject({
      end: assignment().end + "whispers".length - "speaks".length,
      sourceText: nextText,
      start: assignment().start,
      text: "Villain whispers.",
    })
    expect(areVoiceAssignmentsStale(nextText, [reconciled])).toBe(false)
  })

  it("removes assignments when their assigned text is deleted", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const nextText = originalText.replace("Villain speaks.", "")

    const reconciled = reconcileVoiceAssignmentsForTextChange(originalText, nextText, [assignment()])

    expect(reconciled).toEqual([])
  })

  it("keeps assignments stale when an edit crosses an assignment boundary", () => {
    const originalText = "Narrator. Villain speaks. Narrator again."
    const nextText = originalText.replace("ator. Villain ", "")
    const assignments = [assignment()]

    const reconciled = reconcileVoiceAssignmentsForTextChange(originalText, nextText, assignments)

    expect(reconciled).toBe(assignments)
    expect(areVoiceAssignmentsStale(nextText, reconciled)).toBe(true)
  })
})
