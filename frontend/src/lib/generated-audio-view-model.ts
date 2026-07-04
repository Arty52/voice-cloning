import {
  GeneratedAudioStorageQuotaError,
  type StoredGeneratedAudio,
} from "@/lib/generated-audio-storage"
import type { ArchivedGeneratedAudio } from "@/lib/generated-audio-archive-api"
import { formatCompactBytes, formatExactBytes, formatGeneratedAudioTime } from "@/lib/formatters"
import {
  buildGeneratedAudioMultiVoiceTuningSummaries,
  type GeneratedAudioMultiVoiceTuningSegment,
} from "@/lib/generated-audio-metadata"
import type { GeneratedAudioTuningMetadata, GeneratedResult, VoiceProvider } from "@/types"

export type GeneratedAudioSizeDisplay = {
  ariaLabel: string
  detailLabel: string
  exactLabel: string
  visibleLabel: string
}

export function storedAudioToResult(record: StoredGeneratedAudio): GeneratedResult {
  return {
    appVoiceId: record.appVoiceId,
    cacheState: record.cacheState,
    characterCount: record.characterCount,
    contentType: record.contentType,
    createdAt: record.createdAt,
    generatedAt: formatGeneratedAudioTime(record.createdAt),
    generationElapsedMs: record.generationElapsedMs ?? null,
    id: record.id,
    modelId: record.modelId,
    multiVoiceMetadata: record.multiVoiceMetadata ?? null,
    requestId: record.requestId,
    scriptSnapshot: record.scriptSnapshot ?? null,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    tuningMetadata: record.tuningMetadata ?? null,
    url: URL.createObjectURL(record.blob),
    voiceId: record.voiceId,
    voiceName: record.voiceName,
  }
}

export function archivedAudioToResult(record: ArchivedGeneratedAudio): GeneratedResult {
  return {
    appVoiceId: record.appVoiceId,
    cacheState: record.cacheState,
    characterCount: record.characterCount,
    contentType: record.contentType,
    createdAt: record.createdAt,
    generatedAt: formatGeneratedAudioTime(record.createdAt),
    generationElapsedMs: record.generationElapsedMs ?? null,
    id: record.id,
    modelId: record.modelId,
    multiVoiceMetadata: record.multiVoiceMetadata ?? null,
    requestId: record.requestId,
    scriptSnapshot: record.scriptSnapshot ?? null,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    tuningMetadata: record.tuningMetadata ?? null,
    url: record.audioUrl,
    voiceId: record.voiceId,
    voiceName: record.voiceName,
  }
}

export function enrichGeneratedAudioResultMetadata(
  item: GeneratedResult,
  provider: VoiceProvider | null | undefined
): GeneratedResult {
  if (!provider || !item.multiVoiceMetadata || item.multiVoiceMetadata.tuningSummaries?.length) {
    return item
  }
  if (item.tuningMetadata && item.tuningMetadata.providerId !== provider.id) {
    return item
  }

  const tuningSummaries = buildGeneratedAudioMultiVoiceTuningSummaries(
    [
      ...item.multiVoiceMetadata.segments,
      ...scriptSnapshotTuningSegments(item),
    ],
    provider
  )
  if (tuningSummaries.length === 0) {
    return item
  }

  return {
    ...item,
    multiVoiceMetadata: {
      ...item.multiVoiceMetadata,
      tuningSummaries,
    },
    tuningMetadata: item.tuningMetadata ?? providerTuningMetadata(provider),
  }
}

function providerTuningMetadata(provider: VoiceProvider): GeneratedAudioTuningMetadata {
  return {
    adjustedSettings: [],
    mode: "custom",
    presetId: null,
    presetLabel: null,
    providerId: provider.id,
    providerLabel: provider.label,
    userPreset: null,
  }
}

function scriptSnapshotTuningSegments(item: GeneratedResult): GeneratedAudioMultiVoiceTuningSegment[] {
  if (item.scriptSnapshot?.mode !== "dialogue") {
    return []
  }

  return item.scriptSnapshot.dialogueBlocks.flatMap((block) =>
    block.voiceId
      ? [
          {
            voiceId: block.voiceId,
            voiceName: block.voiceName ?? block.speakerLabel ?? block.voiceId,
            voiceSettings: block.voiceSettings,
          },
        ]
      : []
  )
}

export function revokeGeneratedAudioUrls(items: GeneratedResult[]) {
  for (const item of items) {
    if (item.url.startsWith("blob:")) {
      URL.revokeObjectURL(item.url)
    }
  }
}

export function createTemporaryGeneratedAudioId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return `unsaved-${window.crypto.randomUUID()}`
  }
  return `unsaved-${Date.now()}`
}

export function isTemporaryGeneratedAudioId(id: string) {
  return id.startsWith("unsaved-")
}

export function buildGeneratedAudioSizeDisplay(sizeBytes: number): GeneratedAudioSizeDisplay {
  const visibleLabel = formatCompactBytes(sizeBytes)
  const exactLabel = formatExactBytes(sizeBytes)
  const detailLabel = "Exact Size"
  return {
    ariaLabel: `Generated Audio Size ${visibleLabel}; ${detailLabel} ${exactLabel}`,
    detailLabel,
    exactLabel,
    visibleLabel,
  }
}

export function formatGeneratedAudioStorageError(value: unknown, storageLabel = "browser storage") {
  if (value instanceof GeneratedAudioStorageQuotaError) {
    return "Generated audio is playable now, but it is larger than the active storage cap and was not saved."
  }
  if (value instanceof Error) {
    return `Generated audio is playable now, but ${storageLabel} could not save it: ${value.message}`
  }
  return `Generated audio is playable now, but ${storageLabel} could not save it.`
}
