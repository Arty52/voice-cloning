import type { GeneratedResult, SpeakerSeparationResult, VoiceAsset } from "@/types"
import type { PlaybackSource, TranscriptDocument, VoicePickerOption } from "@/lib/voice-ui-contracts"

type VoicePickerAdapterOptions = {
  previewUrl: string | null
}

type TranscriptDocumentAdapterOptions = {
  documentId: string
}

/**
 * The only boundary where current application response shapes become reusable
 * voice UI view models. Provider settings, hashes, paths, and provider ids do
 * not cross this boundary.
 */
export function voiceAssetToPickerOption(
  voice: VoiceAsset,
  { previewUrl }: VoicePickerAdapterOptions,
): VoicePickerOption {
  return {
    description: voice.sampleMode === "sourceWindow" ? "Selected Source Window" : "Voice Sample",
    id: voice.id,
    metadata: voice.processingSteps.length > 0 ? ["Processed"] : [],
    name: voice.name,
    preview: previewUrl
      ? {
          id: `${voice.id}:preview`,
          kind: "voicePreview",
          label: `${voice.name} Preview`,
          url: previewUrl,
        }
      : null,
  }
}

/**
 * Produces the stable local sample endpoint used by Voice Library playback.
 * A malformed or missing voice id has no preview source; callers must not
 * manufacture a browser media request for it.
 */
export function voiceAssetToPreviewSource(voice: Pick<VoiceAsset, "id" | "name">): PlaybackSource | null {
  const id = voice.id.trim()
  if (!id) {
    return null
  }
  const name = voice.name.trim() || "Voice"
  return {
    id: `voice-library:${id}:preview`,
    kind: "voicePreview",
    label: `${name} Preview`,
    url: `/api/voices/${encodeURIComponent(id)}/sample`,
  }
}

/** Maps generated results into stable controller sources without exposing storage details. */
export function generatedAudioToPlaybackSource(
  item: Pick<GeneratedResult, "id" | "url" | "voiceName">,
): PlaybackSource | null {
  const id = item.id.trim()
  const url = item.url.trim()
  if (!id || !url) {
    return null
  }
  return {
    id: `generated-audio:${id}`,
    kind: "generatedAudio",
    label: `${item.voiceName.trim() || "Generated Voice"} Playback`,
    url,
  }
}

export function generatedSegmentToPlaybackSource({
  generatedAudioId,
  label,
  segmentId,
  url,
}: {
  generatedAudioId: string
  label: string
  segmentId: string
  url: string
}): PlaybackSource | null {
  const normalizedGeneratedAudioId = generatedAudioId.trim()
  const normalizedSegmentId = segmentId.trim()
  const normalizedLabel = label.trim()
  const normalizedUrl = url.trim()
  if (!normalizedGeneratedAudioId || !normalizedSegmentId || !normalizedUrl) {
    return null
  }
  return {
    id: `generated-audio:${normalizedGeneratedAudioId}:segment:${normalizedSegmentId}`,
    kind: "generatedAudio",
    label: normalizedLabel || "Generated Segment Playback",
    url: normalizedUrl,
  }
}

export function speakerSeparationToTranscriptDocument(
  result: SpeakerSeparationResult,
  { documentId }: TranscriptDocumentAdapterOptions,
): TranscriptDocument {
  const speakers = result.speakers.map((speaker, index) => ({
    id: speaker.id,
    label: speaker.assignedName?.trim() || speaker.label.trim() || `Speaker ${index + 1}`,
  }))
  const segments = result.transcript.items
    .map((item, index) => ({ index, item }))
    .sort(
      (left, right) =>
        left.item.startSeconds - right.item.startSeconds ||
        left.item.endSeconds - right.item.endSeconds ||
        left.index - right.index,
    )
    .map(({ item }) => ({
      endSeconds: item.endSeconds,
      id: item.id,
      speakerId: item.speakerId,
      startSeconds: item.startSeconds,
      text: item.text,
    }))

  return { id: documentId, revision: 0, segments, speakers }
}

export function transcriptSourceToPlaybackSource({
  documentId,
  label,
  url,
}: {
  documentId: string
  label: string
  url: string
}): PlaybackSource {
  return { id: `${documentId}:source`, kind: "transcriptSource", label, url }
}
