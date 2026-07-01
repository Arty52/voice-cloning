import type { GeneratedAudioMultiVoiceMetadata, GeneratedAudioTuningMetadata } from "@/types"
import { sha256Blob } from "@/lib/generated-audio-hash"

export const GENERATED_AUDIO_DB_NAME = "voice-clone-generated-audio"
export const GENERATED_AUDIO_STORE_NAME = "generated-audio"
export const GENERATED_AUDIO_ARCHIVE_STATE_STORE_NAME = "archive-migration-state"
export const GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME = "archive-export-targets"
export const GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME = "archive-export-ledger"
export const GENERATED_AUDIO_STORAGE_LIMIT_KEY = "voice-clone-generated-audio-limit-bytes"
export const BYTES_PER_MEBIBYTE = 1024 * 1024
export const DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES = 100 * BYTES_PER_MEBIBYTE
export const GENERATED_AUDIO_STORAGE_LIMIT_PRESETS_BYTES = [25, 50, 100, 250].map(
  (value) => value * BYTES_PER_MEBIBYTE
)

export const GENERATED_AUDIO_DATABASE_VERSION = 2

export type StoredGeneratedAudio = {
  id: string
  blob: Blob
  sizeBytes: number
  contentType: string
  createdAt: string
  cacheState: string
  voiceId: string
  appVoiceId: string
  voiceName: string
  modelId: string
  characterCount: number | null
  requestId: string | null
  generationElapsedMs: number | null
  sha256: string | null
  multiVoiceMetadata?: GeneratedAudioMultiVoiceMetadata | null
  tuningMetadata?: GeneratedAudioTuningMetadata | null
}

export type SaveGeneratedAudioInput = {
  blob: Blob
  id?: string
  createdAt?: string
  contentType?: string
  cacheState: string
  voiceId: string
  appVoiceId: string
  voiceName: string
  modelId: string
  characterCount: number | null
  requestId: string | null
  generationElapsedMs?: number | null
  sha256?: string | null
  multiVoiceMetadata?: GeneratedAudioMultiVoiceMetadata | null
  tuningMetadata?: GeneratedAudioTuningMetadata | null
}

export type GeneratedAudioUsage = {
  itemCount: number
  limitBytes: number
  remainingBytes: number
  usedBytes: number
}

export type GeneratedAudioMutationResult = {
  prunedIds: string[]
  usage: GeneratedAudioUsage
}

export type SaveGeneratedAudioResult = GeneratedAudioMutationResult & {
  item: StoredGeneratedAudio
}

export class GeneratedAudioStorageQuotaError extends Error {
  constructor(sizeBytes: number, limitBytes: number) {
    super(`Generated audio is ${sizeBytes} bytes, which exceeds the ${limitBytes} byte storage cap.`)
    this.name = "GeneratedAudioStorageQuotaError"
  }
}

export async function listGeneratedAudio(): Promise<StoredGeneratedAudio[]> {
  const records = await getAllGeneratedAudioRecords()
  return [...records].sort(compareNewestFirst)
}

export async function saveGeneratedAudio(
  input: SaveGeneratedAudioInput,
  limitBytes = getGeneratedAudioStorageLimitBytes()
): Promise<SaveGeneratedAudioResult> {
  const resolvedLimitBytes = normalizeGeneratedAudioStorageLimitBytes(limitBytes)
  const item: StoredGeneratedAudio = {
    ...input,
    id: input.id ?? createGeneratedAudioId(),
    contentType: input.contentType || input.blob.type || "audio/mpeg",
    createdAt: input.createdAt ?? new Date().toISOString(),
    generationElapsedMs: normalizeGenerationElapsedMs(input.generationElapsedMs),
    multiVoiceMetadata: input.multiVoiceMetadata ?? null,
    sha256: input.sha256 ?? (await sha256Blob(input.blob)),
    sizeBytes: input.blob.size,
    tuningMetadata: input.tuningMetadata ?? null,
  }

  if (item.sizeBytes > resolvedLimitBytes) {
    throw new GeneratedAudioStorageQuotaError(item.sizeBytes, resolvedLimitBytes)
  }

  await putGeneratedAudioRecord(item)
  const prunedIds = await pruneGeneratedAudioToLimit(resolvedLimitBytes, [item.id])
  const usage = await getGeneratedAudioUsage(resolvedLimitBytes)
  return { item, prunedIds, usage }
}

export async function deleteGeneratedAudio(id: string): Promise<GeneratedAudioUsage> {
  await deleteGeneratedAudioRecord(id)
  return getGeneratedAudioUsage()
}

export async function clearGeneratedAudio(): Promise<GeneratedAudioUsage> {
  await clearGeneratedAudioRecords()
  return getGeneratedAudioUsage()
}

export async function getGeneratedAudioUsage(
  limitBytes = getGeneratedAudioStorageLimitBytes()
): Promise<GeneratedAudioUsage> {
  const resolvedLimitBytes = normalizeGeneratedAudioStorageLimitBytes(limitBytes)
  const records = await getAllGeneratedAudioRecords()
  const usedBytes = sumBytes(records)
  return {
    itemCount: records.length,
    limitBytes: resolvedLimitBytes,
    remainingBytes: Math.max(0, resolvedLimitBytes - usedBytes),
    usedBytes,
  }
}

export async function pruneGeneratedAudioToLimit(
  limitBytes = getGeneratedAudioStorageLimitBytes(),
  protectedIds: string[] = []
): Promise<string[]> {
  const resolvedLimitBytes = normalizeGeneratedAudioStorageLimitBytes(limitBytes)
  const protectedIdSet = new Set(protectedIds)
  const records = await getAllGeneratedAudioRecords()
  let usedBytes = sumBytes(records)

  if (usedBytes <= resolvedLimitBytes) {
    return []
  }

  const prunedIds: string[] = []
  for (const record of [...records].sort(compareOldestFirst)) {
    if (usedBytes <= resolvedLimitBytes) {
      break
    }
    if (protectedIdSet.has(record.id)) {
      continue
    }
    await deleteGeneratedAudioRecord(record.id)
    usedBytes -= record.sizeBytes
    prunedIds.push(record.id)
  }

  return prunedIds
}

export async function updateGeneratedAudioStorageLimitBytes(
  limitBytes: number,
  options: { prune: boolean } = { prune: true }
): Promise<GeneratedAudioMutationResult> {
  const resolvedLimitBytes = setGeneratedAudioStorageLimitBytes(limitBytes)
  const prunedIds = options.prune ? await pruneGeneratedAudioToLimit(resolvedLimitBytes) : []
  const usage = await getGeneratedAudioUsage(resolvedLimitBytes)
  return { prunedIds, usage }
}

export function getGeneratedAudioStorageLimitBytes(): number {
  const storedValue = window.localStorage.getItem(GENERATED_AUDIO_STORAGE_LIMIT_KEY)
  if (storedValue === null) {
    return DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES
  }
  return normalizeGeneratedAudioStorageLimitBytes(Number(storedValue))
}

export function setGeneratedAudioStorageLimitBytes(limitBytes: number): number {
  const resolvedLimitBytes = normalizeGeneratedAudioStorageLimitBytes(limitBytes)
  window.localStorage.setItem(GENERATED_AUDIO_STORAGE_LIMIT_KEY, String(resolvedLimitBytes))
  return resolvedLimitBytes
}

export function normalizeGeneratedAudioStorageLimitBytes(limitBytes: number): number {
  if (!Number.isFinite(limitBytes)) {
    return DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES
  }
  const normalizedLimitBytes = Math.floor(limitBytes)
  if (normalizedLimitBytes <= 0) {
    return DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES
  }
  return normalizedLimitBytes
}

export function openGeneratedAudioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(GENERATED_AUDIO_DB_NAME, GENERATED_AUDIO_DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(GENERATED_AUDIO_STORE_NAME)) {
        const store = database.createObjectStore(GENERATED_AUDIO_STORE_NAME, { keyPath: "id" })
        store.createIndex("createdAt", "createdAt")
      }
      if (!database.objectStoreNames.contains(GENERATED_AUDIO_ARCHIVE_STATE_STORE_NAME)) {
        database.createObjectStore(GENERATED_AUDIO_ARCHIVE_STATE_STORE_NAME, { keyPath: "key" })
      }
      if (!database.objectStoreNames.contains(GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME)) {
        database.createObjectStore(GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME, { keyPath: "id" })
      }
      if (!database.objectStoreNames.contains(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME)) {
        const store = database.createObjectStore(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME, { keyPath: "key" })
        store.createIndex("targetHandleId", "targetHandleId")
        store.createIndex("audioId", "audioId")
      }
    }
    request.onerror = () => reject(request.error ?? new Error("Unable to open generated audio storage."))
    request.onsuccess = () => resolve(request.result)
  })
}

async function getAllGeneratedAudioRecords(): Promise<StoredGeneratedAudio[]> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_STORE_NAME, "readonly")
    const request = transaction.objectStore(GENERATED_AUDIO_STORE_NAME).getAll()
    const records = await idbRequest<Array<StoredGeneratedAudio | LegacyStoredGeneratedAudio>>(request)
    return records.map(normalizeStoredGeneratedAudio)
  } finally {
    database.close()
  }
}

type LegacyStoredGeneratedAudio = Omit<StoredGeneratedAudio, "generationElapsedMs"> & {
  generationElapsedMs?: number | null
  multiVoiceMetadata?: GeneratedAudioMultiVoiceMetadata | null
  sha256?: string | null
}

function normalizeStoredGeneratedAudio(record: StoredGeneratedAudio | LegacyStoredGeneratedAudio): StoredGeneratedAudio {
  return {
    ...record,
    generationElapsedMs: normalizeGenerationElapsedMs(record.generationElapsedMs),
    multiVoiceMetadata: record.multiVoiceMetadata ?? null,
    sha256: record.sha256 ?? null,
    tuningMetadata: record.tuningMetadata ?? null,
  }
}

function normalizeGenerationElapsedMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.round(value))
}

async function putGeneratedAudioRecord(record: StoredGeneratedAudio): Promise<void> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_STORE_NAME, "readwrite")
    transaction.objectStore(GENERATED_AUDIO_STORE_NAME).put(record)
    await idbTransaction(transaction)
  } finally {
    database.close()
  }
}

async function deleteGeneratedAudioRecord(id: string): Promise<void> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_STORE_NAME, "readwrite")
    transaction.objectStore(GENERATED_AUDIO_STORE_NAME).delete(id)
    await idbTransaction(transaction)
  } finally {
    database.close()
  }
}

async function clearGeneratedAudioRecords(): Promise<void> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_STORE_NAME, "readwrite")
    transaction.objectStore(GENERATED_AUDIO_STORE_NAME).clear()
    await idbTransaction(transaction)
  } finally {
    database.close()
  }
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Generated audio storage request failed."))
    request.onsuccess = () => resolve(request.result)
  })
}

export function idbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error ?? new Error("Generated audio storage transaction aborted."))
    transaction.onerror = () => reject(transaction.error ?? new Error("Generated audio storage transaction failed."))
    transaction.oncomplete = () => resolve()
  })
}

function createGeneratedAudioId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID()
  }
  return `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function compareNewestFirst(first: StoredGeneratedAudio, second: StoredGeneratedAudio) {
  return compareCreatedAt(second, first)
}

function compareOldestFirst(first: StoredGeneratedAudio, second: StoredGeneratedAudio) {
  return compareCreatedAt(first, second)
}

function compareCreatedAt(first: StoredGeneratedAudio, second: StoredGeneratedAudio) {
  const timestampDelta = Date.parse(first.createdAt) - Date.parse(second.createdAt)
  if (timestampDelta !== 0) {
    return timestampDelta
  }
  return first.id.localeCompare(second.id)
}

function sumBytes(records: StoredGeneratedAudio[]) {
  return records.reduce((total, record) => total + record.sizeBytes, 0)
}
