import {
  GeneratedAudioStorageQuotaError,
  type StoredGeneratedAudio,
} from "@/lib/generated-audio-storage"
import { formatGeneratedAudioTime } from "@/lib/formatters"
import type { GeneratedResult } from "@/types"

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

export function formatGeneratedAudioStorageError(value: unknown) {
  if (value instanceof GeneratedAudioStorageQuotaError) {
    return "Generated audio is playable now, but it is larger than the active browser storage cap and was not saved."
  }
  if (value instanceof Error) {
    return `Generated audio is playable now, but browser storage could not save it: ${value.message}`
  }
  return "Generated audio is playable now, but browser storage could not save it."
}
