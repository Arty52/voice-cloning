import { describe, expect, it } from "vitest"

import { hasSpeakableSelection, readTextareaSelection } from "./text-selection"

describe("textarea selection helpers", () => {
  it("reads forward multi-line selections", () => {
    const textarea = document.createElement("textarea")
    textarea.value = "First line\nSecond line\nThird line"
    textarea.selectionStart = 6
    textarea.selectionEnd = 22

    expect(readTextareaSelection(textarea)).toEqual({
      end: 22,
      start: 6,
      text: "line\nSecond line",
    })
  })

  it("normalizes reversed selections", () => {
    const textarea = {
      selectionEnd: 0,
      selectionStart: 18,
      value: "First line\nSecond line",
    } as HTMLTextAreaElement

    expect(readTextareaSelection(textarea)).toEqual({
      end: 18,
      start: 0,
      text: "First line\nSecond ",
    })
  })

  it("detects speakable selected text", () => {
    expect(hasSpeakableSelection({ end: 5, start: 0, text: "Hello" })).toBe(true)
    expect(hasSpeakableSelection({ end: 2, start: 0, text: "\n " })).toBe(false)
    expect(hasSpeakableSelection({ end: 4, start: 4, text: "" })).toBe(false)
  })
})
