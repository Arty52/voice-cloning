import {
  GENERATED_AUDIO_ARCHIVE_STATE_STORE_NAME,
  openGeneratedAudioDatabase,
} from "@/lib/generated-audio-storage"

export const GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY = "voice-clone-generated-audio-archive-imported-ids"
export const GENERATED_AUDIO_ARCHIVE_CLEARED_IDS_KEY = "voice-clone-generated-audio-archive-cleared-ids"
export const GENERATED_AUDIO_ARCHIVE_CONFLICT_IDS_KEY = "voice-clone-generated-audio-archive-conflict-ids"
const LOCAL_STORAGE_MIGRATED_KEY = "voice-clone-generated-audio-archive-state-migrated"

export type GeneratedAudioArchiveMigrationState = {
  clearedIds: Set<string>
  conflictIds: Set<string>
  importedIds: Set<string>
}

type StoredIdSet = {
  ids: string[]
  key: string
}

export async function readGeneratedAudioArchiveMigrationState(): Promise<GeneratedAudioArchiveMigrationState> {
  await importLegacyLocalStorageState()
  const [clearedIds, conflictIds, importedIds] = await Promise.all([
    readIdSet(GENERATED_AUDIO_ARCHIVE_CLEARED_IDS_KEY),
    readIdSet(GENERATED_AUDIO_ARCHIVE_CONFLICT_IDS_KEY),
    readIdSet(GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY),
  ])
  return { clearedIds, conflictIds, importedIds }
}

export async function markGeneratedAudioArchiveImported(ids: Iterable<string>): Promise<void> {
  await appendIds(GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY, ids)
}

export async function markGeneratedAudioArchiveCleared(ids: Iterable<string>): Promise<void> {
  await appendIds(GENERATED_AUDIO_ARCHIVE_CLEARED_IDS_KEY, ids)
}

export async function markGeneratedAudioArchiveConflicted(ids: Iterable<string>): Promise<void> {
  await appendIds(GENERATED_AUDIO_ARCHIVE_CONFLICT_IDS_KEY, ids)
}

async function importLegacyLocalStorageState(): Promise<void> {
  try {
    if (window.localStorage.getItem(LOCAL_STORAGE_MIGRATED_KEY) === "true") {
      return
    }
  } catch {
    return
  }
  await Promise.all(
    [
      GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY,
      GENERATED_AUDIO_ARCHIVE_CLEARED_IDS_KEY,
      GENERATED_AUDIO_ARCHIVE_CONFLICT_IDS_KEY,
    ].map(async (key) => {
      const legacyIds = readLegacyIdSet(key)
      if (legacyIds.size > 0) {
        await appendIds(key, legacyIds)
      }
    })
  )
  try {
    window.localStorage.setItem(LOCAL_STORAGE_MIGRATED_KEY, "true")
  } catch {
    // Migration bookkeeping is best-effort; server archive state remains canonical.
  }
}

async function appendIds(key: string, ids: Iterable<string>): Promise<void> {
  const nextIds = await readIdSet(key)
  for (const id of ids) {
    if (id) {
      nextIds.add(id)
    }
  }
  await putIdSet(key, nextIds)
}

async function readIdSet(key: string): Promise<Set<string>> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_ARCHIVE_STATE_STORE_NAME, "readonly")
    const request = transaction.objectStore(GENERATED_AUDIO_ARCHIVE_STATE_STORE_NAME).get(key)
    const record = await idbRequest<StoredIdSet | undefined>(request)
    return new Set((record?.ids ?? []).filter((value): value is string => typeof value === "string" && value.length > 0))
  } finally {
    database.close()
  }
}

async function putIdSet(key: string, ids: Set<string>): Promise<void> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_ARCHIVE_STATE_STORE_NAME, "readwrite")
    transaction.objectStore(GENERATED_AUDIO_ARCHIVE_STATE_STORE_NAME).put({
      ids: [...ids].sort(),
      key,
    } satisfies StoredIdSet)
    await idbTransaction(transaction)
  } finally {
    database.close()
  }
}

function readLegacyIdSet(key: string): Set<string> {
  let rawValue: string | null
  try {
    rawValue = window.localStorage.getItem(key)
  } catch {
    return new Set<string>()
  }
  if (!rawValue) {
    return new Set<string>()
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      return new Set<string>()
    }
    return new Set(parsed.filter((value): value is string => typeof value === "string" && value.length > 0))
  } catch {
    return new Set<string>()
  }
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Generated audio archive state request failed."))
    request.onsuccess = () => resolve(request.result)
  })
}

function idbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error ?? new Error("Generated audio archive state transaction aborted."))
    transaction.onerror = () => reject(transaction.error ?? new Error("Generated audio archive state transaction failed."))
    transaction.oncomplete = () => resolve()
  })
}
