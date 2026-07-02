import { useEffect, useRef, useState } from "react"

import {
  DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
  clearGeneratedAudio,
  deleteGeneratedAudio,
  getGeneratedAudioStorageLimitBytes,
  getGeneratedAudioUsage,
  listGeneratedAudio,
  saveGeneratedAudio,
  updateGeneratedAudioStorageLimitBytes,
  type GeneratedAudioUsage,
  type SaveGeneratedAudioInput,
  type StoredGeneratedAudio,
} from "@/lib/generated-audio-storage"
import {
  GeneratedAudioArchiveConflictError,
  GeneratedAudioArchiveUnavailableError,
  clearGeneratedAudioArchive,
  deleteGeneratedAudioArchive,
  listGeneratedAudioArchive,
  saveGeneratedAudioArchive,
  updateGeneratedAudioArchiveStorageLimitBytes,
  type ArchivedGeneratedAudio,
} from "@/lib/generated-audio-archive-api"
import {
  markGeneratedAudioArchiveCleared,
  markGeneratedAudioArchiveConflicted,
  markGeneratedAudioArchiveImported,
  readGeneratedAudioArchiveMigrationState,
} from "@/lib/generated-audio-archive-migration"
import {
  GeneratedAudioServerExportUnavailableError,
  exportAllGeneratedAudioToServer,
  exportGeneratedAudioToServer,
  loadGeneratedAudioServerExportStatus,
  type GeneratedAudioServerExportStatus,
} from "@/lib/generated-audio-export-api"
import {
  archivedAudioToResult,
  createTemporaryGeneratedAudioId,
  formatGeneratedAudioStorageError,
  isTemporaryGeneratedAudioId,
  revokeGeneratedAudioUrls,
  storedAudioToResult,
} from "@/lib/generated-audio-view-model"
import type { AsyncStatus, GeneratedResult } from "@/types"

export type GeneratedAudioMutation = "clear" | "delete" | "storage-limit"
export type GeneratedAudioPersistenceMode = "browser" | "server"
export type GeneratedAudioServerExportMutation = "export" | "export-all" | "refresh"

type GeneratedAudioMutationState = {
  id: number
  type: GeneratedAudioMutation
}

type GeneratedAudioArchiveMigrationResult = {
  conflictIds: string[]
  failedCount: number
  importedCount: number
}

type ServerExportStatusLoadResult = {
  error: string | null
  status: GeneratedAudioServerExportStatus | null
}

export function useGeneratedAudioLibrary() {
  const [generatedAudioItems, setGeneratedAudioItems] = useState<GeneratedResult[]>([])
  const [generatedAudioUsage, setGeneratedAudioUsage] = useState<GeneratedAudioUsage | null>(null)
  const [generatedAudioStorageError, setGeneratedAudioStorageError] = useState<string | null>(null)
  const [generatedAudioStatus, setGeneratedAudioStatus] = useState<AsyncStatus>("idle")
  const [generatedAudioMutationState, setGeneratedAudioMutationState] = useState<GeneratedAudioMutationState | null>(null)
  const [generatedAudioPersistenceMode, setGeneratedAudioPersistenceMode] = useState<GeneratedAudioPersistenceMode>("browser")
  const [serverExportStatus, setServerExportStatus] = useState<GeneratedAudioServerExportStatus | null>(null)
  const [serverExportError, setServerExportError] = useState<string | null>(null)
  const [serverExportMutation, setServerExportMutation] = useState<GeneratedAudioServerExportMutation | null>(null)
  const [storageLimitBytes, setStorageLimitBytes] = useState(() => getGeneratedAudioStorageLimitBytes())
  const generatedAudioItemsRef = useRef<GeneratedResult[]>([])
  const generatedAudioMutationIdRef = useRef(0)
  const serverExportMutationIdRef = useRef(0)
  const persistenceModeRef = useRef<GeneratedAudioPersistenceMode>("browser")

  useEffect(() => {
    let isMounted = true

    async function loadGeneratedAudioLibrary() {
      setGeneratedAudioStatus("loading")
      try {
        try {
          const archive = await listGeneratedAudioArchive()
          const migration = await importBrowserGeneratedAudioToArchive(archive.usage.limitBytes)
          const resolvedArchive = migration.importedCount > 0 ? await listGeneratedAudioArchive() : archive
          if (!isMounted) {
            return
          }
          const exportStatus = await resolveServerExportStatus()
          if (!isMounted) {
            return
          }
          setPersistenceMode("server")
          replaceArchivedGeneratedAudioItems(resolvedArchive.items)
          setGeneratedAudioUsage(resolvedArchive.usage)
          setStorageLimitBytes(resolvedArchive.usage.limitBytes)
          setGeneratedAudioStorageError(formatGeneratedAudioArchiveMigrationMessage(migration))
          setServerExportStatus(exportStatus.status)
          setServerExportError(exportStatus.error)
          setGeneratedAudioStatus("success")
          return
        } catch (caught) {
          if (!shouldFallBackToBrowserGeneratedAudio(caught)) {
            throw caught
          }
        }

        const { limitBytes, records, usage } = await loadBrowserGeneratedAudioLibrary()
        if (!isMounted) {
          return
        }
        setPersistenceMode("browser")
        setStorageLimitBytes(limitBytes)
        replaceStoredGeneratedAudioItems(records)
        setGeneratedAudioUsage(usage)
        setGeneratedAudioStorageError(null)
        setGeneratedAudioStatus("success")
      } catch (caught) {
        if (!isMounted) {
          return
        }
        setGeneratedAudioStorageError(caught instanceof Error ? caught.message : "Unable to load generated audio.")
        setGeneratedAudioStatus("error")
      }
    }

    void loadGeneratedAudioLibrary()
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    generatedAudioItemsRef.current = generatedAudioItems
  }, [generatedAudioItems])

  useEffect(() => {
    return () => {
      revokeGeneratedAudioUrls(generatedAudioItemsRef.current)
    }
  }, [])

  function replaceStoredGeneratedAudioItems(records: StoredGeneratedAudio[]) {
    const nextItems = records.map(storedAudioToResult)
    setGeneratedAudioItems((previous) => {
      revokeGeneratedAudioUrls(previous)
      return nextItems
    })
    return nextItems
  }

  function replaceArchivedGeneratedAudioItems(records: ArchivedGeneratedAudio[]) {
    const nextItems = records.map(archivedAudioToResult)
    setGeneratedAudioItems((previous) => {
      revokeGeneratedAudioUrls(previous)
      return nextItems
    })
    return nextItems
  }

  function showTemporaryGeneratedAudio(record: StoredGeneratedAudio) {
    const temporaryItem = storedAudioToResult(record)
    setGeneratedAudioItems((previous) => [temporaryItem, ...previous])
    return temporaryItem
  }

  function startGeneratedAudioMutation(type: GeneratedAudioMutation) {
    const id = generatedAudioMutationIdRef.current + 1
    generatedAudioMutationIdRef.current = id
    setGeneratedAudioMutationState({ id, type })
    return id
  }

  function clearGeneratedAudioMutation(id: number) {
    setGeneratedAudioMutationState((current) => (current?.id === id ? null : current))
  }

  function setPersistenceMode(mode: GeneratedAudioPersistenceMode) {
    persistenceModeRef.current = mode
    setGeneratedAudioPersistenceMode(mode)
    if (mode === "browser") {
      setServerExportStatus(null)
      setServerExportError(null)
      setServerExportMutation(null)
    }
  }

  function startServerExportMutation(type: GeneratedAudioServerExportMutation) {
    const id = serverExportMutationIdRef.current + 1
    serverExportMutationIdRef.current = id
    setServerExportMutation(type)
    return id
  }

  function clearServerExportMutation(id: number) {
    setServerExportMutation((current) => (serverExportMutationIdRef.current === id ? null : current))
  }

  async function refreshServerExportStatus(options: { silent?: boolean } = {}) {
    if (persistenceModeRef.current !== "server") {
      setServerExportStatus(null)
      setServerExportError("Server export requires the server archive.")
      return null
    }
    const mutationId = options.silent ? null : startServerExportMutation("refresh")
    try {
      const result = await resolveServerExportStatus()
      setServerExportStatus(result.status)
      setServerExportError(result.error)
      return result.status
    } finally {
      if (mutationId !== null) {
        clearServerExportMutation(mutationId)
      }
    }
  }

  async function handleExportGeneratedAudioToServer(id: string) {
    if (persistenceModeRef.current !== "server") {
      setServerExportError("Server export requires the server archive.")
      return
    }
    const mutationId = startServerExportMutation("export")
    try {
      await exportGeneratedAudioToServer(id)
      await refreshServerExportStatus({ silent: true })
    } catch (caught) {
      const exportError = formatServerExportError(caught)
      const result = await resolveServerExportStatus()
      setServerExportStatus(result.status)
      setServerExportError(result.error ?? exportError)
    } finally {
      clearServerExportMutation(mutationId)
    }
  }

  async function handleExportAllGeneratedAudioToServer() {
    if (persistenceModeRef.current !== "server") {
      setServerExportError("Server export requires the server archive.")
      return
    }
    const mutationId = startServerExportMutation("export-all")
    try {
      await exportAllGeneratedAudioToServer()
      await refreshServerExportStatus({ silent: true })
    } catch (caught) {
      const exportError = formatServerExportError(caught)
      const result = await resolveServerExportStatus()
      setServerExportStatus(result.status)
      setServerExportError(result.error ?? exportError)
    } finally {
      clearServerExportMutation(mutationId)
    }
  }

  async function persistGeneratedAudio(input: SaveGeneratedAudioInput, limitBytes: number) {
    if (persistenceModeRef.current === "server") {
      try {
        const saved = await saveGeneratedAudioArchive(input, limitBytes)
        await safeMarkGeneratedAudioArchiveImported([saved.item.id])
        await safeMarkGeneratedAudioArchiveCleared(saved.prunedIds)
        const archive = await listGeneratedAudioArchive()
        const nextItems = replaceArchivedGeneratedAudioItems(archive.items)
        setStorageLimitBytes(archive.usage.limitBytes)
        setGeneratedAudioUsage(archive.usage)
        setGeneratedAudioStorageError(null)
        await refreshServerExportStatus({ silent: true })
        return nextItems.find((item) => item.id === saved.item.id) ?? archivedAudioToResult(saved.item)
      } catch (archiveError) {
        if (shouldFallBackToBrowserGeneratedAudio(archiveError)) {
          setPersistenceMode("browser")
          return persistGeneratedAudioInBrowser(input, limitBytes)
        }
        const temporaryItem = showTemporaryGeneratedAudio(storedGeneratedAudioFromInput(input))
        setGeneratedAudioStorageError(formatGeneratedAudioStorageError(archiveError, "server archive"))
        return temporaryItem
      }
    }

    return persistGeneratedAudioInBrowser(input, limitBytes)
  }

  async function persistGeneratedAudioInBrowser(input: SaveGeneratedAudioInput, limitBytes: number) {
    try {
      const saved = await saveGeneratedAudio(input, limitBytes)
      const records = await listGeneratedAudio()
      const nextItems = replaceStoredGeneratedAudioItems(records)
      setGeneratedAudioUsage(saved.usage)
      setGeneratedAudioStorageError(null)
      return nextItems.find((item) => item.id === saved.item.id) ?? storedAudioToResult(saved.item)
    } catch (storageError) {
      const temporaryItem = showTemporaryGeneratedAudio({
        ...input,
        contentType: input.contentType || input.blob.type || "audio/mpeg",
        createdAt: input.createdAt ?? new Date().toISOString(),
        generationElapsedMs: input.generationElapsedMs ?? null,
        id: createTemporaryGeneratedAudioId(),
        sha256: input.sha256 ?? null,
        sizeBytes: input.blob.size,
      })
      setGeneratedAudioStorageError(formatGeneratedAudioStorageError(storageError))
      return temporaryItem
    }
  }

  async function handleDeleteGeneratedAudio(id: string) {
    if (isTemporaryGeneratedAudioId(id)) {
      removeGeneratedAudioItemFromState(id)
      setGeneratedAudioStorageError(null)
      return
    }

    const mutationId = startGeneratedAudioMutation("delete")
    try {
      const usage =
        persistenceModeRef.current === "server"
          ? await deleteGeneratedAudioArchive(id)
          : await deleteGeneratedAudio(id)
      if (persistenceModeRef.current === "server") {
        await safeMarkGeneratedAudioArchiveCleared([id])
        await refreshServerExportStatus({ silent: true })
      }
      removeGeneratedAudioItemFromState(id)
      setGeneratedAudioUsage(usage)
      setGeneratedAudioStorageError(null)
    } catch (caught) {
      setGeneratedAudioStorageError(caught instanceof Error ? caught.message : "Unable to remove generated audio.")
    } finally {
      clearGeneratedAudioMutation(mutationId)
    }
  }

  function removeGeneratedAudioItemFromState(id: string) {
    setGeneratedAudioItems((previous) => {
      const nextItems: GeneratedResult[] = []
      for (const item of previous) {
        if (item.id === id) {
          revokeGeneratedAudioUrls([item])
        } else {
          nextItems.push(item)
        }
      }
      return nextItems
    })
  }

  async function clearAllGeneratedAudio() {
    const mutationId = startGeneratedAudioMutation("clear")
    try {
      const usage =
        persistenceModeRef.current === "server"
          ? (await clearGeneratedAudioArchive()).usage
          : await clearGeneratedAudio()
      if (persistenceModeRef.current === "server") {
        const browserRecords = await safeListStoredGeneratedAudio()
        await safeMarkGeneratedAudioArchiveCleared([
          ...generatedAudioItemsRef.current.map((item) => item.id),
          ...browserRecords.map((record) => record.id),
        ])
        await refreshServerExportStatus({ silent: true })
      }
      setGeneratedAudioItems((previous) => {
        revokeGeneratedAudioUrls(previous)
        return []
      })
      setGeneratedAudioUsage(usage)
      setGeneratedAudioStorageError(null)
    } catch (caught) {
      setGeneratedAudioStorageError(caught instanceof Error ? caught.message : "Unable to clear generated audio.")
    } finally {
      clearGeneratedAudioMutation(mutationId)
    }
  }

  async function applyGeneratedAudioStorageLimit(nextLimitBytes: number) {
    const mutationId = startGeneratedAudioMutation("storage-limit")
    try {
      const result =
        persistenceModeRef.current === "server"
          ? await updateGeneratedAudioArchiveStorageLimitBytes(nextLimitBytes)
          : await updateGeneratedAudioStorageLimitBytes(nextLimitBytes)
      await safeMarkGeneratedAudioArchiveCleared(result.prunedIds)
      if (persistenceModeRef.current === "server") {
        const archive = await listGeneratedAudioArchive()
        replaceArchivedGeneratedAudioItems(archive.items)
        setStorageLimitBytes(archive.usage.limitBytes)
        setGeneratedAudioUsage(archive.usage)
        await refreshServerExportStatus({ silent: true })
      } else {
        const records = await listGeneratedAudio()
        replaceStoredGeneratedAudioItems(records)
        setStorageLimitBytes(result.usage.limitBytes)
        setGeneratedAudioUsage(result.usage)
      }
      setGeneratedAudioStorageError(null)
    } catch (caught) {
      setGeneratedAudioStorageError(caught instanceof Error ? caught.message : "Unable to update generated audio storage.")
    } finally {
      clearGeneratedAudioMutation(mutationId)
    }
  }

  const resolvedUsage = generatedAudioUsage ?? {
    itemCount: generatedAudioItems.length,
    limitBytes: storageLimitBytes || DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
    remainingBytes: storageLimitBytes || DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
    usedBytes: 0,
  }

  return {
    applyGeneratedAudioStorageLimit,
    clearAllGeneratedAudio,
    generatedAudioItems,
    generatedAudioMutation: generatedAudioMutationState?.type ?? null,
    generatedAudioPersistenceMode,
    generatedAudioStorageError,
    generatedAudioStatus,
    generatedAudioUsage,
    handleDeleteGeneratedAudio,
    handleExportAllGeneratedAudioToServer,
    handleExportGeneratedAudioToServer,
    persistGeneratedAudio,
    refreshServerExportStatus,
    resolvedUsage,
    serverExportError,
    serverExportMutation,
    serverExportStatus,
    storageLimitBytes,
  }
}

async function resolveServerExportStatus(): Promise<ServerExportStatusLoadResult> {
  try {
    return {
      error: null,
      status: await loadGeneratedAudioServerExportStatus(),
    }
  } catch (caught) {
    if (caught instanceof GeneratedAudioServerExportUnavailableError) {
      return {
        error: null,
        status: {
          available: false,
          items: [],
          targetId: null,
        },
      }
    }
    return {
      error: formatServerExportError(caught),
      status: null,
    }
  }
}

async function loadBrowserGeneratedAudioLibrary() {
  const limitBytes = getGeneratedAudioStorageLimitBytes()
  const [records, usage] = await Promise.all([listGeneratedAudio(), getGeneratedAudioUsage(limitBytes)])
  return { limitBytes, records, usage }
}

async function importBrowserGeneratedAudioToArchive(
  limitBytes: number
): Promise<GeneratedAudioArchiveMigrationResult> {
  const records = await safeListStoredGeneratedAudio()
  if (records.length === 0) {
    return {
      conflictIds: [],
      failedCount: 0,
      importedCount: 0,
    }
  }
  const migrationState = await readGeneratedAudioArchiveMigrationState()
  const importedIds: string[] = []
  const conflictIds: string[] = []
  let failedCount = 0

  for (const record of [...records].reverse()) {
    if (
      migrationState.clearedIds.has(record.id) ||
      migrationState.conflictIds.has(record.id) ||
      migrationState.importedIds.has(record.id)
    ) {
      continue
    }
    try {
      await saveGeneratedAudioArchive(record, limitBytes)
      importedIds.push(record.id)
    } catch (caught) {
      if (isGeneratedAudioArchiveConflict(caught)) {
        conflictIds.push(record.id)
        continue
      }
      if (shouldFallBackToBrowserGeneratedAudio(caught)) {
        throw caught
      }
      failedCount += 1
    }
  }

  await safeMarkGeneratedAudioArchiveImported(importedIds)
  await safeMarkGeneratedAudioArchiveConflicted(conflictIds)

  return {
    conflictIds,
    failedCount,
    importedCount: importedIds.length,
  }
}

async function safeListStoredGeneratedAudio() {
  try {
    return await listGeneratedAudio()
  } catch {
    return []
  }
}

async function safeMarkGeneratedAudioArchiveImported(ids: Iterable<string>) {
  await ignoreGeneratedAudioArchiveBookkeepingError(() => markGeneratedAudioArchiveImported(ids))
}

async function safeMarkGeneratedAudioArchiveCleared(ids: Iterable<string>) {
  await ignoreGeneratedAudioArchiveBookkeepingError(() => markGeneratedAudioArchiveCleared(ids))
}

async function safeMarkGeneratedAudioArchiveConflicted(ids: Iterable<string>) {
  await ignoreGeneratedAudioArchiveBookkeepingError(() => markGeneratedAudioArchiveConflicted(ids))
}

async function ignoreGeneratedAudioArchiveBookkeepingError(operation: () => Promise<void>) {
  try {
    await operation()
  } catch {
    // Local migration bookkeeping is best-effort; the server archive remains canonical.
  }
}

function storedGeneratedAudioFromInput(input: SaveGeneratedAudioInput): StoredGeneratedAudio {
  return {
    ...input,
    contentType: input.contentType || input.blob.type || "audio/mpeg",
    createdAt: input.createdAt ?? new Date().toISOString(),
    generationElapsedMs: input.generationElapsedMs ?? null,
    id: createTemporaryGeneratedAudioId(),
    multiVoiceMetadata: input.multiVoiceMetadata ?? null,
    sha256: input.sha256 ?? null,
    sizeBytes: input.blob.size,
    tuningMetadata: input.tuningMetadata ?? null,
  }
}

function shouldFallBackToBrowserGeneratedAudio(value: unknown) {
  return (
    value instanceof GeneratedAudioArchiveUnavailableError ||
    value instanceof TypeError ||
    (value instanceof Error && value.name === "GeneratedAudioArchiveUnavailableError")
  )
}

function isGeneratedAudioArchiveConflict(value: unknown) {
  return (
    value instanceof GeneratedAudioArchiveConflictError ||
    (value instanceof Error && value.name === "GeneratedAudioArchiveConflictError")
  )
}

function formatServerExportError(value: unknown) {
  if (value instanceof Error) {
    return value.message
  }
  return "Unable to export generated audio."
}

function formatGeneratedAudioArchiveMigrationMessage(result: GeneratedAudioArchiveMigrationResult) {
  if (result.conflictIds.length > 0 && result.failedCount > 0) {
    return `${result.conflictIds.length} browser audio item(s) conflicted with the server archive and ${result.failedCount} item(s) could not be imported.`
  }
  if (result.conflictIds.length > 0) {
    return `${result.conflictIds.length} browser audio item(s) conflicted with the server archive and were not imported.`
  }
  if (result.failedCount > 0) {
    return `${result.failedCount} browser audio item(s) could not be imported to the server archive.`
  }
  return null
}
