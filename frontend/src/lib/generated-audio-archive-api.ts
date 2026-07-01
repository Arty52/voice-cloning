import {
  DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
  GeneratedAudioStorageQuotaError,
  normalizeGeneratedAudioStorageLimitBytes,
  type GeneratedAudioMutationResult,
  type GeneratedAudioUsage,
  type SaveGeneratedAudioInput,
} from "@/lib/generated-audio-storage"
import type { GeneratedAudioMultiVoiceMetadata, GeneratedAudioTuningMetadata } from "@/types"

export type ArchivedGeneratedAudio = {
  id: string
  audioUrl: string
  sizeBytes: number
  contentType: string
  createdAt: string
  cacheState: string
  providerId: string
  voiceId: string
  appVoiceId: string
  voiceName: string
  modelId: string
  characterCount: number | null
  requestId: string | null
  generationElapsedMs: number | null
  multiVoiceMetadata: GeneratedAudioMultiVoiceMetadata | null
  tuningMetadata: GeneratedAudioTuningMetadata | null
  sha256: string
}

export type GeneratedAudioArchiveResponse = {
  items: ArchivedGeneratedAudio[]
  usage: GeneratedAudioUsage
}

export type SaveGeneratedAudioArchiveResult = GeneratedAudioMutationResult & {
  alreadyExisted: boolean
  item: ArchivedGeneratedAudio
}

export class GeneratedAudioArchiveUnavailableError extends Error {
  constructor(message = "Generated audio archive persistence is not configured.") {
    super(message)
    this.name = "GeneratedAudioArchiveUnavailableError"
  }
}

export class GeneratedAudioArchiveConflictError extends Error {
  constructor(message = "Generated audio id already exists with different content.") {
    super(message)
    this.name = "GeneratedAudioArchiveConflictError"
  }
}

export async function listGeneratedAudioArchive(): Promise<GeneratedAudioArchiveResponse> {
  const response = await fetch("/api/generated-audio")
  if (response.status === 503 || response.status === 404) {
    throw new GeneratedAudioArchiveUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as unknown
  if (!isGeneratedAudioArchiveResponsePayload(payload)) {
    throw new GeneratedAudioArchiveUnavailableError("Generated audio archive response was incomplete.")
  }
  return normalizeArchiveResponse(payload)
}

export async function saveGeneratedAudioArchive(
  input: SaveGeneratedAudioInput,
  limitBytes = DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES
): Promise<SaveGeneratedAudioArchiveResult> {
  const id = input.id ?? createGeneratedAudioArchiveId()
  const audioBlob = await multipartBlobFrom(input.blob, input.contentType || input.blob.type || "audio/mpeg")
  const formData = new FormData()
  formData.append("id", id)
  formData.append("audioFile", audioBlob, `${id}${extensionForContentType(audioBlob.type)}`)
  appendOptional(formData, "createdAt", input.createdAt)
  appendOptional(formData, "cacheState", input.cacheState)
  appendOptional(formData, "voiceId", input.voiceId)
  appendOptional(formData, "appVoiceId", input.appVoiceId)
  appendOptional(formData, "voiceName", input.voiceName)
  appendOptional(formData, "modelId", input.modelId)
  appendOptional(formData, "characterCount", input.characterCount)
  appendOptional(formData, "requestId", input.requestId)
  appendOptional(formData, "generationElapsedMs", input.generationElapsedMs)
  appendOptionalJson(formData, "multiVoiceMetadata", input.multiVoiceMetadata)
  appendOptionalJson(formData, "tuningMetadata", input.tuningMetadata)

  const response = await fetch("/api/generated-audio", {
    method: "POST",
    body: formData,
  })
  if (response.status === 413) {
    throw new GeneratedAudioStorageQuotaError(input.blob.size, normalizeGeneratedAudioStorageLimitBytes(limitBytes))
  }
  if (response.status === 409) {
    throw new GeneratedAudioArchiveConflictError(await readError(response))
  }
  if (response.status === 503 || response.status === 404) {
    throw new GeneratedAudioArchiveUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as unknown
  if (!isSaveGeneratedAudioArchiveResultPayload(payload)) {
    throw new Error("Generated audio archive save response was incomplete.")
  }
  return normalizeSaveResponse(payload)
}

export async function deleteGeneratedAudioArchive(id: string): Promise<GeneratedAudioUsage> {
  const response = await fetch(`/api/generated-audio/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  if (response.status === 503 || response.status === 404) {
    throw new GeneratedAudioArchiveUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as GeneratedAudioMutationResult
  return normalizeUsage(payload.usage)
}

export async function clearGeneratedAudioArchive(): Promise<GeneratedAudioMutationResult> {
  const response = await fetch("/api/generated-audio", { method: "DELETE" })
  if (response.status === 503 || response.status === 404) {
    throw new GeneratedAudioArchiveUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as GeneratedAudioMutationResult
  return {
    prunedIds: Array.isArray(payload.prunedIds) ? payload.prunedIds : [],
    usage: normalizeUsage(payload.usage),
  }
}

export async function updateGeneratedAudioArchiveStorageLimitBytes(
  limitBytes: number
): Promise<GeneratedAudioMutationResult> {
  const response = await fetch("/api/generated-audio/storage-limit", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limitBytes, prune: true }),
  })
  if (response.status === 503 || response.status === 404) {
    throw new GeneratedAudioArchiveUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as GeneratedAudioMutationResult
  return {
    prunedIds: Array.isArray(payload.prunedIds) ? payload.prunedIds : [],
    usage: normalizeUsage(payload.usage),
  }
}

function normalizeArchiveResponse(response: GeneratedAudioArchiveResponse): GeneratedAudioArchiveResponse {
  return {
    items: Array.isArray(response.items) ? response.items.map(normalizeArchiveItem) : [],
    usage: normalizeUsage(response.usage),
  }
}

function isGeneratedAudioArchiveResponsePayload(value: unknown): value is GeneratedAudioArchiveResponse {
  return isRecord(value) && Array.isArray(value.items) && isRecord(value.usage)
}

function isSaveGeneratedAudioArchiveResultPayload(value: unknown): value is SaveGeneratedAudioArchiveResult {
  return isRecord(value) && isRecord(value.item) && isRecord(value.usage)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeSaveResponse(response: SaveGeneratedAudioArchiveResult): SaveGeneratedAudioArchiveResult {
  return {
    alreadyExisted: Boolean(response.alreadyExisted),
    item: normalizeArchiveItem(response.item),
    prunedIds: Array.isArray(response.prunedIds) ? response.prunedIds : [],
    usage: normalizeUsage(response.usage),
  }
}

function normalizeArchiveItem(item: ArchivedGeneratedAudio): ArchivedGeneratedAudio {
  return {
    ...item,
    appVoiceId: item.appVoiceId || "unknown",
    audioUrl: item.audioUrl || `/api/generated-audio/${encodeURIComponent(item.id)}/audio`,
    cacheState: item.cacheState || "unknown",
    characterCount: normalizeNullableNumber(item.characterCount),
    contentType: item.contentType || "audio/mpeg",
    generationElapsedMs: normalizeNullableNumber(item.generationElapsedMs),
    modelId: item.modelId || "unknown",
    multiVoiceMetadata: item.multiVoiceMetadata ?? null,
    requestId: item.requestId ?? null,
    tuningMetadata: item.tuningMetadata ?? null,
    voiceId: item.voiceId || "unknown",
    voiceName: item.voiceName || "Generated Voice",
  }
}

function normalizeUsage(usage: GeneratedAudioUsage): GeneratedAudioUsage {
  const limitBytes = normalizeGeneratedAudioStorageLimitBytes(usage?.limitBytes)
  const usedBytes = Math.max(0, Number.isFinite(usage?.usedBytes) ? Math.floor(usage.usedBytes) : 0)
  return {
    itemCount: Math.max(0, Number.isFinite(usage?.itemCount) ? Math.floor(usage.itemCount) : 0),
    limitBytes,
    remainingBytes: Math.max(0, Number.isFinite(usage?.remainingBytes) ? Math.floor(usage.remainingBytes) : limitBytes - usedBytes),
    usedBytes,
  }
}

async function readError(response: Response) {
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === "string") {
      return payload.detail
    }
  }
  return (await response.text()) || `Request failed with status ${response.status}.`
}

function appendOptional(formData: FormData, key: string, value: string | number | null | undefined) {
  if (value !== undefined && value !== null && value !== "") {
    formData.append(key, String(value))
  }
}

function appendOptionalJson(formData: FormData, key: string, value: object | null | undefined) {
  if (value) {
    formData.append(key, JSON.stringify(value))
  }
}

async function multipartBlobFrom(blob: Blob, contentType: string) {
  const BlobConstructor = typeof window !== "undefined" && window.Blob ? window.Blob : Blob
  if (blob instanceof BlobConstructor) {
    return blob
  }
  const blobLike = blob as { arrayBuffer?: () => Promise<ArrayBuffer> }
  if (typeof blobLike.arrayBuffer === "function") {
    return new BlobConstructor([await blobLike.arrayBuffer()], { type: contentType })
  }
  return new BlobConstructor([blob as unknown as BlobPart], { type: contentType })
}

function normalizeNullableNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
}

function extensionForContentType(contentType: string | undefined) {
  if (contentType === "audio/wav" || contentType === "audio/wave" || contentType === "audio/x-wav") {
    return ".wav"
  }
  if (contentType === "audio/mp4" || contentType === "audio/m4a") {
    return ".m4a"
  }
  return ".mp3"
}

function createGeneratedAudioArchiveId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID()
  }
  return `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
