import type { SampleProcessingDurationRange } from "@/types"

export const TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY =
  "voice-cloning.transcriptTimingDiagnostics.v1"
export const ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY =
  "voice-cloning.activeTranscriptTimingDiagnosticId.v1"
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
  storage = window.localStorage,
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
    const records = readTranscriptTimingDiagnostics(storage, now.getTime())
    writeRecords([record, ...records], storage, now.getTime())
    storage.setItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY, record.id)
  } catch {
    // Timing diagnostics are optional and must never block transcript processing.
  }
  return record
}

export function readTranscriptTimingDiagnostics(
  storage: Storage = window.localStorage,
  nowMs = Date.now()
): TranscriptTimingDiagnosticRecord[] {
  try {
    const rawValue = storage.getItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
    if (!rawValue) {
      return []
    }
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      storage.removeItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
      return []
    }
    const retainedRecords = retainRecords(parsed.map(normalizeRecord).filter(isPresent), nowMs)
    const retainedValue = JSON.stringify(retainedRecords)
    if (retainedRecords.length === 0) {
      storage.removeItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
    } else if (retainedValue !== rawValue) {
      storage.setItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY, retainedValue)
    }
    return retainedRecords
  } catch {
    return []
  }
}

export function readActiveTranscriptTimingDiagnostic(
  storage: Storage = window.localStorage,
  nowMs = Date.now()
): TranscriptTimingDiagnosticRecord | null {
  try {
    const activeId = storage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
    if (!activeId) {
      return null
    }
    const record = readTranscriptTimingDiagnostics(storage, nowMs).find(({ id }) => id === activeId) ?? null
    if (!record || TERMINAL_STATUSES.has(record.workflowStatus)) {
      storage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
      return null
    }
    return record
  } catch {
    return null
  }
}

export function updateActiveTranscriptTimingDiagnostic(
  update: UpdateTranscriptTimingDiagnostic,
  storage: Storage = window.localStorage,
  nowMs = Date.now()
): TranscriptTimingDiagnosticRecord | null {
  try {
    const activeId = storage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
    if (!activeId) {
      return null
    }
    const records = readTranscriptTimingDiagnostics(storage, nowMs)
    const activeRecord = records.find(({ id }) => id === activeId)
    if (!activeRecord) {
      storage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
      return null
    }
    const isTerminal = TERMINAL_STATUSES.has(update.workflowStatus)
    const updatedRecord: TranscriptTimingDiagnosticRecord = {
      ...activeRecord,
      workflowStatus: update.workflowStatus,
      actualElapsedMs: update.actualElapsedMs ?? activeRecord.actualElapsedMs,
      completedAt: isTerminal
        ? update.completedAt ?? new Date(nowMs).toISOString()
        : null,
    }
    writeRecords(
      records.map((record) => (record.id === activeId ? updatedRecord : record)),
      storage,
      nowMs
    )
    if (isTerminal) {
      storage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
    }
    return updatedRecord
  } catch {
    return null
  }
}

export function clearTranscriptTimingDiagnostics(storage: Storage = window.localStorage) {
  try {
    storage.removeItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
    storage.removeItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)
  } catch {
    // Browser storage is optional.
  }
}

function writeRecords(records: TranscriptTimingDiagnosticRecord[], storage: Storage, nowMs: number) {
  const retainedRecords = retainRecords(records, nowMs)
  if (retainedRecords.length === 0) {
    storage.removeItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)
    return
  }
  storage.setItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(retainedRecords))
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
