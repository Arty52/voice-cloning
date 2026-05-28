export const GENERATED_AUDIO_DB_NAME = "voice-clone-generated-audio"
export const GENERATED_AUDIO_STORE_NAME = "generated-audio"
export const GENERATED_AUDIO_STORAGE_LIMIT_KEY = "voice-clone-generated-audio-limit-bytes"
export const BYTES_PER_MEBIBYTE = 1024 * 1024
export const DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES = 100 * BYTES_PER_MEBIBYTE
export const GENERATED_AUDIO_STORAGE_LIMIT_PRESETS_BYTES = [25, 50, 100, 250].map(
  (value) => value * BYTES_PER_MEBIBYTE
)

const DATABASE_VERSION = 1

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
    sizeBytes: input.blob.size,
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

function openGeneratedAudioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(GENERATED_AUDIO_DB_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(GENERATED_AUDIO_STORE_NAME)) {
        const store = database.createObjectStore(GENERATED_AUDIO_STORE_NAME, { keyPath: "id" })
        store.createIndex("createdAt", "createdAt")
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
    return await idbRequest<StoredGeneratedAudio[]>(request)
  } finally {
    database.close()
  }
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

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Generated audio storage request failed."))
    request.onsuccess = () => resolve(request.result)
  })
}

function idbTransaction(transaction: IDBTransaction): Promise<void> {
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
