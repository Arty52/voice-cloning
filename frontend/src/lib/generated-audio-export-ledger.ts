import {
  GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME,
  idbRequest,
  idbTransaction,
  openGeneratedAudioDatabase,
} from "@/lib/generated-audio-storage"

export type BrowserArchiveExportLedgerStatus = "exported" | "failed"

export type BrowserArchiveExportLedgerEntry = {
  key: string
  targetHandleId: string
  audioId: string
  sha256: string | null
  filename: string
  status: BrowserArchiveExportLedgerStatus
  exportedAt: string | null
  lastError: string | null
  updatedAt: string
}

export function browserArchiveExportLedgerKey(targetHandleId: string, audioId: string, sha256: string | null) {
  return `${targetHandleId}:${audioId}:${sha256 ?? "legacy-null"}`
}

export async function listBrowserArchiveExportLedger(
  targetHandleId?: string | null
): Promise<BrowserArchiveExportLedgerEntry[]> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME, "readonly")
    const request = transaction.objectStore(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME).getAll()
    const entries = await idbRequest<BrowserArchiveExportLedgerEntry[]>(request)
    return entries
      .filter((entry) => !targetHandleId || entry.targetHandleId === targetHandleId)
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
  } finally {
    database.close()
  }
}

export async function getBrowserArchiveExportLedgerEntry(
  targetHandleId: string,
  audioId: string,
  sha256: string | null
): Promise<BrowserArchiveExportLedgerEntry | null> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME, "readonly")
    const key = browserArchiveExportLedgerKey(targetHandleId, audioId, sha256)
    const request = transaction.objectStore(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME).get(key)
    return (await idbRequest<BrowserArchiveExportLedgerEntry | undefined>(request)) ?? null
  } finally {
    database.close()
  }
}

export async function saveBrowserArchiveExportLedgerEntry(
  entry: Omit<BrowserArchiveExportLedgerEntry, "key">
): Promise<BrowserArchiveExportLedgerEntry> {
  const record: BrowserArchiveExportLedgerEntry = {
    ...entry,
    key: browserArchiveExportLedgerKey(entry.targetHandleId, entry.audioId, entry.sha256),
  }
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME, "readwrite")
    transaction.objectStore(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME).put(record)
    await idbTransaction(transaction)
    return record
  } finally {
    database.close()
  }
}

export async function clearBrowserArchiveExportLedgerForTarget(targetHandleId: string): Promise<void> {
  const entries = await listBrowserArchiveExportLedger(targetHandleId)
  if (entries.length === 0) {
    return
  }
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME, "readwrite")
    const store = transaction.objectStore(GENERATED_AUDIO_EXPORT_LEDGER_STORE_NAME)
    entries.forEach((entry) => store.delete(entry.key))
    await idbTransaction(transaction)
  } finally {
    database.close()
  }
}
