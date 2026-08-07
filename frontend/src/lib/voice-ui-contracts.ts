/**
 * Provider-neutral view models for future Voice Studio media components.
 * Feature hooks own browser media, API calls, persistence, and mutations; these
 * contracts only describe controlled state and user intent.
 */

export type PlaybackSourceKind =
  | "generatedAudio"
  | "preparedAudio"
  | "speakerExcerpt"
  | "transcriptSource"
  | "voicePreview"

export type PlaybackLoadState = "idle" | "loading" | "ready" | "error"
export type PlaybackStatus = "idle" | "paused" | "playing" | "ended" | "error"

export type PlaybackSource = {
  id: string
  kind: PlaybackSourceKind
  label: string
  url: string
}

export type PlaybackSnapshot = {
  currentTimeSeconds: number
  durationSeconds: number | null
  error: string | null
  loadState: PlaybackLoadState
  source: PlaybackSource | null
  status: PlaybackStatus
}

export type PlaybackIntent =
  | { type: "pause" }
  | { type: "play" }
  | { source: PlaybackSource | null; type: "replaceSource" }
  | { positionSeconds: number; type: "seek" }
  | { endSeconds: number; startSeconds: number; type: "playRange" }

export type PlaybackController = {
  dispatch: (intent: PlaybackIntent) => void
  snapshot: PlaybackSnapshot
}

export type TranscriptWord = {
  endSeconds: number
  id: string
  startSeconds: number
  text: string
}

export type TranscriptSpeaker = {
  id: string
  label: string
}

export type TranscriptSegment = {
  endSeconds: number
  id: string
  speakerId: string
  startSeconds: number
  text: string
  words?: TranscriptWord[]
}

export type TranscriptDocument = {
  id: string
  revision: number
  segments: TranscriptSegment[]
  speakers: TranscriptSpeaker[]
}

export type TranscriptPresentation = {
  currentSegmentId: string | null
  document: TranscriptDocument
  selectedSegmentIds: string[]
}

export type TranscriptIntent =
  | { segmentId: string; type: "seekSegment" }
  | { segmentIds: string[]; type: "selectSegments" }
  | { segmentId: string; text: string; type: "correctSegment" }

export type VoicePickerOption = {
  description: string | null
  id: string
  metadata: string[]
  name: string
  preview: PlaybackSource | null
}

export type VoicePickerPresentation = {
  options: VoicePickerOption[]
  selectedVoiceId: string | null
}

export function applyTranscriptCorrection(
  document: TranscriptDocument,
  segmentId: string,
  text: string
): TranscriptDocument {
  const nextText = text.trim()
  if (!nextText) {
    throw new Error("Transcript text is required.")
  }
  let found = false
  const segments = document.segments.map((segment) => {
    if (segment.id !== segmentId) {
      return segment
    }
    found = true
    // Existing word timing cannot be assumed to match edited text.
    return { ...segment, text: nextText, words: undefined }
  })
  if (!found) {
    throw new Error("Transcript segment was not found.")
  }
  return { ...document, revision: document.revision + 1, segments }
}

export function hasBrowserObjectUrl(source: PlaybackSource | null) {
  return source?.url.startsWith("blob:") ?? false
}

export function validateTranscriptDocument(document: TranscriptDocument) {
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) {
    return false
  }
  const speakerIds = new Set<string>()
  const segmentIds = new Set<string>()
  const wordIds = new Set<string>()
  let previousStartSeconds = -1
  for (const speaker of document.speakers) {
    if (!speaker.id || !speaker.label.trim() || speakerIds.has(speaker.id)) {
      return false
    }
    speakerIds.add(speaker.id)
  }
  for (const segment of document.segments) {
    if (
      !segment.id ||
      segmentIds.has(segment.id) ||
      !speakerIds.has(segment.speakerId) ||
      !isValidRange(segment.startSeconds, segment.endSeconds) ||
      segment.startSeconds < previousStartSeconds
    ) {
      return false
    }
    segmentIds.add(segment.id)
    previousStartSeconds = segment.startSeconds
    if (!hasValidWordAlignment(segment, wordIds)) {
      return false
    }
  }
  return true
}

function hasValidWordAlignment(segment: TranscriptSegment, wordIds: Set<string>) {
  let previousEndSeconds = segment.startSeconds
  for (const word of segment.words ?? []) {
    if (
      !word.id.trim() ||
      wordIds.has(word.id) ||
      !isValidRange(word.startSeconds, word.endSeconds) ||
      word.startSeconds < previousEndSeconds ||
      word.endSeconds > segment.endSeconds
    ) {
      return false
    }
    wordIds.add(word.id)
    previousEndSeconds = word.endSeconds
  }
  return true
}

function isValidRange(startSeconds: number, endSeconds: number) {
  return (
    Number.isFinite(startSeconds) &&
    Number.isFinite(endSeconds) &&
    startSeconds >= 0 &&
    endSeconds >= startSeconds
  )
}
