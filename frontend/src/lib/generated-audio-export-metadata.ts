import type { GeneratedAudioMultiVoiceMetadata, GeneratedAudioTuningMetadata } from "@/types"

export const BROWSER_ARCHIVE_ROOT_NAME = "Voice Clone Lab Archive"
export const BROWSER_GENERATED_AUDIO_EXPORT_DIR = "generated-audio"
export const BROWSER_GENERATED_AUDIO_INDEX_DIR = "index"
export const BROWSER_GENERATED_AUDIO_INDEX_FILENAME = "generated-audio.jsonl"
export const BROWSER_EXPORT_SCHEMA_VERSION = 1

export type GeneratedAudioExportable = {
  id: string
  sizeBytes: number
  contentType: string
  createdAt: string
  sha256: string | null
  providerId?: string | null
  cacheState: string | null
  voiceId: string | null
  appVoiceId: string | null
  voiceName: string | null
  modelId: string | null
  characterCount: number | null
  requestId: string | null
  generationElapsedMs: number | null
  tuningMetadata: GeneratedAudioTuningMetadata | null
  multiVoiceMetadata: GeneratedAudioMultiVoiceMetadata | null
}

export type GeneratedAudioExportDescriptor = {
  compactCreatedAt: string
  extension: string
  idSlug: string
  modelSlug: string
  month: string
  sha8: string
  voiceSlug: string
  year: string
}

export function buildGeneratedAudioExportDescriptor(item: GeneratedAudioExportable): GeneratedAudioExportDescriptor {
  const createdAt = new Date(item.createdAt)
  const resolvedCreatedAt = Number.isNaN(createdAt.valueOf()) ? new Date(0) : createdAt
  return {
    compactCreatedAt: compactUtcTimestamp(resolvedCreatedAt),
    extension: extensionForContentType(item.contentType),
    idSlug: slug(item.id, "audio"),
    modelSlug: slug(item.modelId, "model"),
    month: String(resolvedCreatedAt.getUTCMonth() + 1).padStart(2, "0"),
    sha8: (item.sha256 || item.id).slice(0, 8),
    voiceSlug: slug(item.voiceName || item.appVoiceId || item.voiceId, "voice"),
    year: String(resolvedCreatedAt.getUTCFullYear()),
  }
}

export function buildGeneratedAudioExportFilename(item: GeneratedAudioExportable): string {
  const descriptor = buildGeneratedAudioExportDescriptor(item)
  return `${descriptor.compactCreatedAt}--${descriptor.voiceSlug}--${descriptor.modelSlug}--${descriptor.sha8}${descriptor.extension}`
}

export function buildGeneratedAudioExportRelativePath(item: GeneratedAudioExportable): string {
  const descriptor = buildGeneratedAudioExportDescriptor(item)
  return `${BROWSER_GENERATED_AUDIO_EXPORT_DIR}/${descriptor.year}/${descriptor.month}/${buildGeneratedAudioExportFilename(item)}`
}

export function buildGeneratedAudioExportSidecar(
  item: GeneratedAudioExportable,
  filename: string,
  exportedAt: string
): Record<string, unknown> {
  return {
    schemaVersion: BROWSER_EXPORT_SCHEMA_VERSION,
    id: item.id,
    createdAt: item.createdAt,
    exportedAt,
    filename,
    sha256: item.sha256,
    sizeBytes: item.sizeBytes,
    contentType: item.contentType,
    providerId: item.providerId ?? null,
    modelId: item.modelId,
    voiceId: item.voiceId,
    appVoiceId: item.appVoiceId,
    voiceName: item.voiceName,
    cacheState: item.cacheState,
    requestId: item.requestId,
    characterCount: item.characterCount,
    generationElapsedMs: item.generationElapsedMs,
    tuningMetadata: item.tuningMetadata,
    multiVoiceMetadata: item.multiVoiceMetadata,
  }
}

function compactUtcTimestamp(value: Date) {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, "0")
  const day = String(value.getUTCDate()).padStart(2, "0")
  const hour = String(value.getUTCHours()).padStart(2, "0")
  const minute = String(value.getUTCMinutes()).padStart(2, "0")
  const second = String(value.getUTCSeconds()).padStart(2, "0")
  return `${year}${month}${day}T${hour}${minute}${second}Z`
}

function extensionForContentType(contentType: string) {
  const normalized = contentType.split(";", 1)[0].trim().toLowerCase()
  if (normalized === "audio/wav" || normalized === "audio/wave" || normalized === "audio/x-wav") {
    return ".wav"
  }
  if (normalized === "audio/mp4" || normalized === "audio/m4a") {
    return ".m4a"
  }
  if (normalized === "audio/aac") {
    return ".aac"
  }
  if (normalized === "audio/ogg") {
    return ".ogg"
  }
  if (normalized === "audio/flac") {
    return ".flac"
  }
  return ".mp3"
}

function slug(value: string | null | undefined, fallback: string) {
  const normalized = (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized.slice(0, 64).replace(/-+$/g, "") || fallback
}
