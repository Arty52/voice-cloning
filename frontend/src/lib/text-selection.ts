export type TextSelectionRange = {
  end: number
  start: number
  text: string
}

export function readTextareaSelection(textarea: HTMLTextAreaElement | null): TextSelectionRange | null {
  if (!textarea) {
    return null
  }

  const start = Math.min(textarea.selectionStart, textarea.selectionEnd)
  const end = Math.max(textarea.selectionStart, textarea.selectionEnd)
  return {
    end,
    start,
    text: textarea.value.slice(start, end),
  }
}

export function hasSpeakableSelection(selection: TextSelectionRange) {
  return selection.start !== selection.end && selection.text.trim().length > 0
}
