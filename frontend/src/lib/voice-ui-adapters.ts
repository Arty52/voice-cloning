import type { SpeakerSeparationResult, VoiceAsset } from "@/types"
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
  { previewUrl }: VoicePickerAdapterOptions
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

export function speakerSeparationToTranscriptDocument(
  result: SpeakerSeparationResult,
  { documentId }: TranscriptDocumentAdapterOptions
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
        left.index - right.index
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
