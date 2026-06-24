import type { SpeechSegmentAssignmentKind, VoiceAsset } from "@/types"

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
}

export type AssignmentSegmentBuildResult = {
  error: string | null
  segments: SpeechJobSegmentDraft[]
  stale: boolean
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

export function buildSpeechJobSegments(
  text: string,
  assignments: VoiceTextAssignment[],
  defaultVoice: Pick<VoiceAsset, "id" | "name">
): AssignmentSegmentBuildResult {
  const orderedAssignments = [...assignments].sort((first, second) => first.start - second.start || first.end - second.end)
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
