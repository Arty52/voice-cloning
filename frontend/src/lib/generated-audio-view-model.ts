import {
  GeneratedAudioStorageQuotaError,
  type StoredGeneratedAudio,
} from "@/lib/generated-audio-storage"
import { formatCompactBytes, formatExactBytes, formatGeneratedAudioTime } from "@/lib/formatters"
import type { GeneratedResult } from "@/types"

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
    sizeBytes: record.sizeBytes,
    tuningMetadata: record.tuningMetadata ?? null,
    url: URL.createObjectURL(record.blob),
    voiceId: record.voiceId,
    voiceName: record.voiceName,
  }
}

export function revokeGeneratedAudioUrls(items: GeneratedResult[]) {
  for (const item of items) {
    URL.revokeObjectURL(item.url)
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

export function formatGeneratedAudioStorageError(value: unknown) {
  if (value instanceof GeneratedAudioStorageQuotaError) {
    return "Generated audio is playable now, but it is larger than the active browser storage cap and was not saved."
  }
  if (value instanceof Error) {
    return `Generated audio is playable now, but browser storage could not save it: ${value.message}`
  }
  return "Generated audio is playable now, but browser storage could not save it."
}
