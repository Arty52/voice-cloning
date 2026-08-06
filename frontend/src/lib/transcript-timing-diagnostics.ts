import type { SampleProcessingDurationRange } from "@/types"

export const TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY =
  "voice-cloning.transcriptTimingDiagnostics.v1"
export const ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY =
  "voice-cloning.activeTranscriptTimingDiagnosticId.v1"
export const ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_IDS_STORAGE_KEY =
  "voice-cloning.activeTranscriptTimingDiagnosticIds.v1"
export const TRANSCRIPT_TIMING_DIAGNOSTIC_RECORD_STORAGE_PREFIX =
  "voice-cloning.transcriptTimingDiagnostics.v1.record."
export const TRANSCRIPT_TIMING_DIAGNOSTIC_SCHEMA_VERSION = 1
export const TRANSCRIPT_TIMING_DIAGNOSTIC_MAX_RECORDS = 50
export const TRANSCRIPT_TIMING_DIAGNOSTIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const SAFE_AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "m4b", "mp3", "ogg", "wav"])
const TERMINAL_STATUSES = new Set<TranscriptTimingDiagnosticStatus>([
  "success",
  "canceled",
  "error",
  "incomplete",
])

export type TranscriptTimingDiagnosticStatus =
  | "starting"
  | "processing"
  | "success"
  | "canceled"
  | "error"
  | "incomplete"

export type TranscriptTimingDiagnosticRecord = {
  schemaVersion: typeof TRANSCRIPT_TIMING_DIAGNOSTIC_SCHEMA_VERSION
  id: string
  createdAt: string
  completedAt: string | null
  estimateMinSeconds: number
  estimateMaxSeconds: number
  actualElapsedMs: number | null
  sourceSizeBytes: number
  sourceMediaType: string | null
  sourceExtension: string | null
  workflowStatus: TranscriptTimingDiagnosticStatus
  estimateSettings: {
    cleanVoice: false
    detectSpeakers: true
    trimCandidates: false
  }
}

type StartTranscriptTimingDiagnosticOptions = {
  estimate: SampleProcessingDurationRange
  sourceFile: File
  storage?: Storage
  now?: Date
  createId?: () => string
}

type UpdateTranscriptTimingDiagnostic = {
  workflowStatus: TranscriptTimingDiagnosticStatus
  actualElapsedMs?: number | null
  completedAt?: string | null
}

export function startTranscriptTimingDiagnostic({
  estimate,
  sourceFile,
  storage,
  now = new Date(),
  createId = createDiagnosticId,
}: StartTranscriptTimingDiagnosticOptions): TranscriptTimingDiagnosticRecord {
  const record: TranscriptTimingDiagnosticRecord = {
    schemaVersion: TRANSCRIPT_TIMING_DIAGNOSTIC_SCHEMA_VERSION,
    id: createId(),
    createdAt: now.toISOString(),
    completedAt: null,
    estimateMinSeconds: estimate.minSeconds,
    estimateMaxSeconds: estimate.maxSeconds,
    actualElapsedMs: null,
    sourceSizeBytes: sourceFile.size,
    sourceMediaType: safeAudioMediaType(sourceFile.type),
    sourceExtension: safeAudioExtension(sourceFile.name),
    workflowStatus: "starting",
    estimateSettings: {
      cleanVoice: false,
      detectSpeakers: true,
      trimCandidates: false,
    },
  }

  try {
    const resolvedStorage = resolveStorage(storage)
    if (!resolvedStorage) {
      return record
    }
    writeRecord(record, resolvedStorage, now.getTime())
    resolvedStorage.setItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY, record.id)
  } catch {
    // Timing diagnostics are optional and must never block transcript processing.
  }
  return record
}

export function readTranscriptTimingDiagnostics(
  storage?: Storage,
  nowMs = Date.now()
): TranscriptTimingDiagnosticRecord[] {
  try {
    const resolvedStorage = resolveStorage(storage)
    if (!resolvedStorage) {
      return []
    }
    migrateLegacyRecords(resolvedStorage, nowMs)
    return pruneRecords(readRecordEntries(resolvedStorage), resolvedStorage, nowMs)
  } catch {
    return []
  }
}

export function readActiveTranscriptTimingDiagnostic(
  storage?: Storage,
  nowMs = Date.now()
): TranscriptTimingDiagnosticRecord | null {
  try {
    const resolvedStorage = resolveStorage(storage)
    if (!resolvedStorage) {
      return null
    }
    return readActiveTranscriptTimingDiagnostics(resolvedStorage, nowMs).at(0) ?? null
  } catch {
    return null
  }
}

export function readActiveTranscriptTimingDiagnostics(
  storage?: Storage,
  nowMs = Date.now()
): TranscriptTimingDiagnosticRecord[] {
  try {
    const resolvedStorage = resolveStorage(storage)
    if (!resolvedStorage) {
      return []
    }
    return readTranscriptTimingDiagnostics(resolvedStorage, nowMs).filter(
      (record) => !TERMINAL_STATUSES.has(record.workflowStatus)
    )
  } catch {
    return []
  }
}

export function markUnpairedTranscriptTimingDiagnosticsIncomplete(
  pairedDiagnosticIds: ReadonlySet<string>,
  storage?: Storage,
  nowMs = Date.now()
) {
  return readActiveTranscriptTimingDiagnostics(storage, nowMs)
    .filter(({ id }) => !pairedDiagnosticIds.has(id))
    .map(({ id }) =>
      updateTranscriptTimingDiagnostic(
        id,
        { workflowStatus: "incomplete", actualElapsedMs: null, completedAt: null },
        storage,
        nowMs
      )
    )
    .filter(isPresent)
}

export function updateTranscriptTimingDiagnostic(
  diagnosticId: string,
  update: UpdateTranscriptTimingDiagnostic,
  storage?: Storage,
  nowMs = Date.now()
): TranscriptTimingDiagnosticRecord | null {
  try {
    const resolvedStorage = resolveStorage(storage)
    if (!resolvedStorage) {
      return null
    }
    const activeRecord = readRecord(diagnosticId, resolvedStorage)
    if (!activeRecord) {
      return null
    }
    const isTerminal = TERMINAL_STATUSES.has(update.workflowStatus)
    const updatedRecord: TranscriptTimingDiagnosticRecord = {
      ...activeRecord,
      workflowStatus: update.workflowStatus,
      actualElapsedMs:
        update.actualElapsedMs === undefined ? activeRecord.actualElapsedMs : update.actualElapsedMs,
      completedAt: isTerminal
        ? "completedAt" in update
          ? update.completedAt ?? null
          : new Date(nowMs).toISOString()
        : null,
    }
    writeRecord(updatedRecord, resolvedStorage, nowMs)
    if (
      isTerminal &&
      resolvedStorage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY) === diagnosticId
    ) {
      resolvedStorage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
    }
    if (isTerminal) removeActiveDiagnosticId(diagnosticId, resolvedStorage)
    return updatedRecord
  } catch {
    return null
  }
}

export function updateActiveTranscriptTimingDiagnostic(
  update: UpdateTranscriptTimingDiagnostic,
  storage?: Storage,
  nowMs = Date.now()
) {
  try {
    const resolvedStorage = resolveStorage(storage)
    const activeId = resolvedStorage?.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
    return activeId ? updateTranscriptTimingDiagnostic(activeId, update, resolvedStorage!, nowMs) : null
  } catch {
    return null
  }
}

export function clearTranscriptTimingDiagnostics(storage?: Storage) {
  try {
    const resolvedStorage = resolveStorage(storage)
    if (!resolvedStorage) {
      return
    }
    resolvedStorage.removeItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
    resolvedStorage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
    resolvedStorage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_IDS_STORAGE_KEY)
    recordStorageKeys(resolvedStorage).forEach((key) => resolvedStorage.removeItem(key))
  } catch {
    // Browser storage is optional.
  }
}

function readActiveDiagnosticIds(storage: Storage) {
  try {
    const rawValue = storage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_IDS_STORAGE_KEY)
    if (!rawValue) {
      const legacyActiveId = storage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
      return legacyActiveId ? [legacyActiveId] : []
    }
    const parsed = JSON.parse(rawValue) as unknown
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128))]
      : []
  } catch {
    return []
  }
}

function writeActiveDiagnosticIds(ids: readonly string[], storage: Storage) {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) {
    storage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_IDS_STORAGE_KEY)
    return
  }
  storage.setItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_IDS_STORAGE_KEY, JSON.stringify(uniqueIds))
}

function removeActiveDiagnosticId(diagnosticId: string, storage: Storage) {
  writeActiveDiagnosticIds(
    readActiveDiagnosticIds(storage).filter((id) => id !== diagnosticId),
    storage
  )
  if (storage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY) === diagnosticId) {
    storage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
  }
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) {
    return storage
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function writeRecord(record: TranscriptTimingDiagnosticRecord, storage: Storage, nowMs: number) {
  storage.setItem(recordStorageKey(record.id), JSON.stringify(record))
  pruneRecords(readRecordEntries(storage), storage, nowMs)
}

function readRecord(diagnosticId: string, storage: Storage) {
  const rawValue = storage.getItem(recordStorageKey(diagnosticId))
  if (!rawValue) {
    return null
  }
  try {
    return normalizeRecord(JSON.parse(rawValue) as unknown)
  } catch {
    storage.removeItem(recordStorageKey(diagnosticId))
    return null
  }
}

function readRecordEntries(storage: Storage) {
  return recordStorageKeys(storage)
    .map((key) => {
      const rawValue = storage.getItem(key)
      if (!rawValue) return null
      try {
        const record = normalizeRecord(JSON.parse(rawValue) as unknown)
        if (!record) storage.removeItem(key)
        return record
      } catch {
        storage.removeItem(key)
        return null
      }
    })
    .filter(isPresent)
}

function recordStorageKeys(storage: Storage) {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key?.startsWith(TRANSCRIPT_TIMING_DIAGNOSTIC_RECORD_STORAGE_PREFIX) ?? false)
}

function recordStorageKey(diagnosticId: string) {
  return `${TRANSCRIPT_TIMING_DIAGNOSTIC_RECORD_STORAGE_PREFIX}${diagnosticId}`
}

function migrateLegacyRecords(storage: Storage, nowMs: number) {
  const rawValue = storage.getItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
  if (!rawValue) return
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      storage.removeItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
      return
    }
    retainRecords(parsed.map(normalizeRecord).filter(isPresent), nowMs).forEach((record) => {
      if (!storage.getItem(recordStorageKey(record.id))) {
        storage.setItem(recordStorageKey(record.id), JSON.stringify(record))
      }
    })
  } finally {
    storage.removeItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
  }
}

function pruneRecords(records: TranscriptTimingDiagnosticRecord[], storage: Storage, nowMs: number) {
  const retainedRecords = retainRecords(records, nowMs)
  const retainedIds = new Set(retainedRecords.map(({ id }) => id))
  records.forEach(({ id }) => {
    if (!retainedIds.has(id)) storage.removeItem(recordStorageKey(id))
  })
  return retainedRecords
}

function retainRecords(records: TranscriptTimingDiagnosticRecord[], nowMs: number) {
  const oldestAllowedTimestamp = nowMs - TRANSCRIPT_TIMING_DIAGNOSTIC_RETENTION_MS
  return records
    .filter((record) => Date.parse(record.createdAt) >= oldestAllowedTimestamp)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .slice(0, TRANSCRIPT_TIMING_DIAGNOSTIC_MAX_RECORDS)
}

function normalizeRecord(value: unknown): TranscriptTimingDiagnosticRecord | null {
  if (!isObject(value)) {
    return null
  }
  const estimateSettings = value.estimateSettings
  if (
    value.schemaVersion !== TRANSCRIPT_TIMING_DIAGNOSTIC_SCHEMA_VERSION ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    !isIsoTimestamp(value.createdAt) ||
    !(value.completedAt === null || isIsoTimestamp(value.completedAt)) ||
    !isNonNegativeFiniteNumber(value.estimateMinSeconds) ||
    !isNonNegativeFiniteNumber(value.estimateMaxSeconds) ||
    value.estimateMaxSeconds < value.estimateMinSeconds ||
    !(value.actualElapsedMs === null || isNonNegativeFiniteNumber(value.actualElapsedMs)) ||
    !isNonNegativeFiniteNumber(value.sourceSizeBytes) ||
    !isSafeAudioMediaType(value.sourceMediaType) ||
    !isSafeAudioExtension(value.sourceExtension) ||
    !isTranscriptTimingDiagnosticStatus(value.workflowStatus) ||
    !isObject(estimateSettings) ||
    estimateSettings.cleanVoice !== false ||
    estimateSettings.detectSpeakers !== true ||
    estimateSettings.trimCandidates !== false
  ) {
    return null
  }
  return {
    schemaVersion: TRANSCRIPT_TIMING_DIAGNOSTIC_SCHEMA_VERSION,
    id: value.id,
    createdAt: value.createdAt,
    completedAt: value.completedAt,
    estimateMinSeconds: value.estimateMinSeconds,
    estimateMaxSeconds: value.estimateMaxSeconds,
    actualElapsedMs: value.actualElapsedMs,
    sourceSizeBytes: value.sourceSizeBytes,
    sourceMediaType: value.sourceMediaType,
    sourceExtension: value.sourceExtension,
    workflowStatus: value.workflowStatus,
    estimateSettings: {
      cleanVoice: false,
      detectSpeakers: true,
      trimCandidates: false,
    },
  }
}

function safeAudioMediaType(value: string) {
  const normalized = value.trim().toLowerCase()
  return /^audio\/[a-z0-9][a-z0-9.+-]*$/.test(normalized) ? normalized : null
}

function safeAudioExtension(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? ""
  return SAFE_AUDIO_EXTENSIONS.has(extension) ? extension : null
}

function isSafeAudioMediaType(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && safeAudioMediaType(value) === value)
}

function isSafeAudioExtension(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && SAFE_AUDIO_EXTENSIONS.has(value))
}

function isTranscriptTimingDiagnosticStatus(value: unknown): value is TranscriptTimingDiagnosticStatus {
  return (
    value === "starting" ||
    value === "processing" ||
    value === "success" ||
    value === "canceled" ||
    value === "error" ||
    value === "incomplete"
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}

function createDiagnosticId() {
  return globalThis.crypto?.randomUUID?.() ?? `transcript-timing-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
