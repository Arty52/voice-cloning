import type { SpeechSegmentAssignmentKind, VoiceAsset, VoiceTuningValues } from "@/types"
import type { TextSelectionRange } from "@/lib/text-selection"

export type VoiceTextAssignment = {
  id: string
  start: number
  end: number
  text: string
  sourceText: string
  voiceId: string
  voiceName: string
}

export type SpeechJobSegmentDraft = {
  assignmentId: string | null
  assignmentKind: SpeechSegmentAssignmentKind
  clientSegmentId: string
  end: number
  start: number
  text: string
  voiceId: string
  voiceName: string
  voiceSettings?: VoiceTuningValues | null
}

export type AssignmentSegmentBuildResult = {
  error: string | null
  segments: SpeechJobSegmentDraft[]
  stale: boolean
}

export type VoiceTextAssignmentInput = {
  id: string
  selection: TextSelectionRange
  sourceText: string
  voice: Pick<VoiceAsset, "id" | "name">
}

type SpanDraft = {
  assignmentId: string | null
  assignmentKind: SpeechSegmentAssignmentKind
  end: number
  start: number
  text: string
  voiceId: string
  voiceName: string
}

export function areVoiceAssignmentsStale(text: string, assignments: VoiceTextAssignment[]) {
  return assignments.some((assignment) => isAssignmentStale(text, assignment))
}

export function createVoiceTextAssignment({
  id,
  selection,
  sourceText,
  voice,
}: VoiceTextAssignmentInput): VoiceTextAssignment | null {
  const start = Math.min(selection.start, selection.end)
  const end = Math.max(selection.start, selection.end)
  if (start < 0 || end > sourceText.length || start === end) {
    return null
  }

  const selectedText = sourceText.slice(start, end)
  if (selectedText.trim().length === 0) {
    return null
  }

  return {
    end,
    id,
    sourceText,
    start,
    text: selectedText,
    voiceId: voice.id,
    voiceName: voice.name,
  }
}

export function reconcileVoiceAssignmentsForTextChange(
  previousText: string,
  nextText: string,
  assignments: VoiceTextAssignment[]
) {
  if (assignments.length === 0 || previousText === nextText) {
    return assignments
  }

  const orderedAssignments = [...assignments].sort(compareAssignments)
  if (validateAssignments(previousText, orderedAssignments) || areVoiceAssignmentsStale(previousText, orderedAssignments)) {
    return assignments
  }

  const edit = detectContiguousEdit(previousText, nextText)
  if (!edit) {
    return assignments
  }

  const affectedAssignments = orderedAssignments.filter((assignment) => editIntersectsAssignment(edit, assignment))
  if (affectedAssignments.length > 1) {
    return assignments
  }
  if (affectedAssignments.length === 1 && !isSafeAssignmentEdit(edit, affectedAssignments[0])) {
    return assignments
  }

  const reconciledAssignments: VoiceTextAssignment[] = []
  for (const assignment of orderedAssignments) {
    const nextRange = reconcileAssignmentRange(edit, assignment)
    if (!nextRange) {
      continue
    }
    reconciledAssignments.push({
      ...assignment,
      end: nextRange.end,
      sourceText: nextText,
      start: nextRange.start,
      text: nextText.slice(nextRange.start, nextRange.end),
    })
  }

  return reconciledAssignments.sort(compareAssignments)
}

export function buildSpeechJobSegments(
  text: string,
  assignments: VoiceTextAssignment[],
  defaultVoice: Pick<VoiceAsset, "id" | "name">
): AssignmentSegmentBuildResult {
  const orderedAssignments = [...assignments].sort(compareAssignments)
  const validationError = validateAssignments(text, orderedAssignments)
  const stale = areVoiceAssignmentsStale(text, orderedAssignments)
  if (validationError || stale) {
    return {
      error: validationError,
      segments: [],
      stale,
    }
  }

  const spans: SpanDraft[] = []
  let cursor = 0
  for (const assignment of orderedAssignments) {
    if (assignment.start > cursor) {
      spans.push(defaultSpan(text, cursor, assignment.start, defaultVoice))
    }
    spans.push({
      assignmentId: assignment.id,
      assignmentKind: "assigned",
      end: assignment.end,
      start: assignment.start,
      text: text.slice(assignment.start, assignment.end),
      voiceId: assignment.voiceId,
      voiceName: assignment.voiceName,
    })
    cursor = assignment.end
  }
  if (cursor < text.length) {
    spans.push(defaultSpan(text, cursor, text.length, defaultVoice))
  }

  return {
    error: null,
    segments: toSpeakableSegments(spans),
    stale: false,
  }
}

function validateAssignments(text: string, assignments: VoiceTextAssignment[]) {
  let previousEnd = 0
  for (const assignment of assignments) {
    if (!Number.isInteger(assignment.start) || !Number.isInteger(assignment.end)) {
      return "Voice assignments must use whole-number text positions."
    }
    if (assignment.start < 0 || assignment.end > text.length || assignment.start >= assignment.end) {
      return "Voice assignments must stay within the current script text."
    }
    if (assignment.start < previousEnd) {
      return "Voice assignments cannot overlap."
    }
    previousEnd = assignment.end
  }
  return null
}

function isAssignmentStale(text: string, assignment: VoiceTextAssignment) {
  return assignment.sourceText !== text || text.slice(assignment.start, assignment.end) !== assignment.text
}

type TextEdit = {
  delta: number
  previousEnd: number
  start: number
}

type AssignmentRange = Pick<VoiceTextAssignment, "end" | "start">

function detectContiguousEdit(previousText: string, nextText: string): TextEdit | null {
  let start = 0
  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start += 1
  }

  let previousSuffixStart = previousText.length
  let nextSuffixStart = nextText.length
  while (
    previousSuffixStart > start &&
    nextSuffixStart > start &&
    previousText[previousSuffixStart - 1] === nextText[nextSuffixStart - 1]
  ) {
    previousSuffixStart -= 1
    nextSuffixStart -= 1
  }

  if (start === previousText.length && start === nextText.length) {
    return null
  }

  return {
    delta: nextSuffixStart - previousSuffixStart,
    previousEnd: previousSuffixStart,
    start,
  }
}

function editIntersectsAssignment(edit: TextEdit, assignment: VoiceTextAssignment) {
  if (edit.previousEnd > edit.start) {
    return edit.start < assignment.end && edit.previousEnd > assignment.start
  }
  return edit.start > assignment.start && edit.start < assignment.end
}

function isSafeAssignmentEdit(edit: TextEdit, assignment: VoiceTextAssignment) {
  if (edit.previousEnd === edit.start) {
    return edit.start > assignment.start && edit.start < assignment.end
  }
  return edit.start >= assignment.start && edit.previousEnd <= assignment.end
}

function reconcileAssignmentRange(edit: TextEdit, assignment: VoiceTextAssignment): AssignmentRange | null {
  if (editIntersectsAssignment(edit, assignment)) {
    const end = assignment.end + edit.delta
    return end > assignment.start ? { end, start: assignment.start } : null
  }
  if (edit.previousEnd <= assignment.start) {
    return {
      end: assignment.end + edit.delta,
      start: assignment.start + edit.delta,
    }
  }
  return {
    end: assignment.end,
    start: assignment.start,
  }
}

function defaultSpan(text: string, start: number, end: number, defaultVoice: Pick<VoiceAsset, "id" | "name">): SpanDraft {
  return {
    assignmentId: null,
    assignmentKind: "default",
    end,
    start,
    text: text.slice(start, end),
    voiceId: defaultVoice.id,
    voiceName: defaultVoice.name,
  }
}

function toSpeakableSegments(spans: SpanDraft[]) {
  const segments: SpeechJobSegmentDraft[] = []
  let leadingWhitespace = ""
  let leadingStart: number | null = null

  for (const span of spans) {
    if (!span.text.trim()) {
      const previous = segments[segments.length - 1]
      if (previous) {
        previous.text += span.text
        previous.end = span.end
      } else {
        leadingWhitespace += span.text
        leadingStart = leadingStart ?? span.start
      }
      continue
    }

    const start = leadingStart ?? span.start
    const text = leadingWhitespace + span.text
    leadingWhitespace = ""
    leadingStart = null
    segments.push({
      assignmentId: span.assignmentId,
      assignmentKind: span.assignmentKind,
      clientSegmentId: segmentId(span, segments.length),
      end: span.end,
      start,
      text,
      voiceId: span.voiceId,
      voiceName: span.voiceName,
    })
  }

  if (leadingWhitespace && segments.length > 0) {
    const previous = segments[segments.length - 1]
    previous.text += leadingWhitespace
    previous.end = spans[spans.length - 1]?.end ?? previous.end
  }

  return segments
}

function segmentId(span: SpanDraft, index: number) {
  return span.assignmentId ?? `default-${index}-${span.start}-${span.end}`
}

export function compareAssignments(first: VoiceTextAssignment, second: VoiceTextAssignment) {
  return first.start - second.start || first.end - second.end || first.id.localeCompare(second.id)
}
