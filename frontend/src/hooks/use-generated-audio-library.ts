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
  archivedAudioToResult,
  createTemporaryGeneratedAudioId,
  formatGeneratedAudioStorageError,
  isTemporaryGeneratedAudioId,
  revokeGeneratedAudioUrls,
  storedAudioToResult,
} from "@/lib/generated-audio-view-model"
import type { AsyncStatus, GeneratedResult } from "@/types"

export type GeneratedAudioMutation = "clear" | "delete" | "storage-limit"
type GeneratedAudioPersistenceMode = "browser" | "server"

type GeneratedAudioMutationState = {
  id: number
  type: GeneratedAudioMutation
}

type GeneratedAudioArchiveMigrationResult = {
  conflictIds: string[]
  failedCount: number
  importedCount: number
}

export function useGeneratedAudioLibrary() {
  const [generatedAudioItems, setGeneratedAudioItems] = useState<GeneratedResult[]>([])
  const [generatedAudioUsage, setGeneratedAudioUsage] = useState<GeneratedAudioUsage | null>(null)
  const [generatedAudioStorageError, setGeneratedAudioStorageError] = useState<string | null>(null)
  const [generatedAudioStatus, setGeneratedAudioStatus] = useState<AsyncStatus>("idle")
  const [generatedAudioMutationState, setGeneratedAudioMutationState] = useState<GeneratedAudioMutationState | null>(null)
  const [storageLimitBytes, setStorageLimitBytes] = useState(() => getGeneratedAudioStorageLimitBytes())
  const generatedAudioItemsRef = useRef<GeneratedResult[]>([])
  const generatedAudioMutationIdRef = useRef(0)
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
          persistenceModeRef.current = "server"
          replaceArchivedGeneratedAudioItems(resolvedArchive.items)
          setGeneratedAudioUsage(resolvedArchive.usage)
          setStorageLimitBytes(resolvedArchive.usage.limitBytes)
          setGeneratedAudioStorageError(formatGeneratedAudioArchiveMigrationMessage(migration))
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
        persistenceModeRef.current = "browser"
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

  async function persistGeneratedAudio(input: SaveGeneratedAudioInput, limitBytes: number) {
    if (persistenceModeRef.current === "server") {
      try {
        const saved = await saveGeneratedAudioArchive(input, limitBytes)
        markGeneratedAudioArchiveImported([saved.item.id])
        markGeneratedAudioArchiveCleared(saved.prunedIds)
        const archive = await listGeneratedAudioArchive()
        const nextItems = replaceArchivedGeneratedAudioItems(archive.items)
        setStorageLimitBytes(archive.usage.limitBytes)
        setGeneratedAudioUsage(archive.usage)
        setGeneratedAudioStorageError(null)
        return nextItems.find((item) => item.id === saved.item.id) ?? archivedAudioToResult(saved.item)
      } catch (archiveError) {
        if (shouldFallBackToBrowserGeneratedAudio(archiveError)) {
          persistenceModeRef.current = "browser"
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
        markGeneratedAudioArchiveCleared([id])
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
        markGeneratedAudioArchiveCleared([
          ...generatedAudioItemsRef.current.map((item) => item.id),
          ...browserRecords.map((record) => record.id),
        ])
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
      markGeneratedAudioArchiveCleared(result.prunedIds)
      if (persistenceModeRef.current === "server") {
        const archive = await listGeneratedAudioArchive()
        replaceArchivedGeneratedAudioItems(archive.items)
        setStorageLimitBytes(archive.usage.limitBytes)
        setGeneratedAudioUsage(archive.usage)
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
    generatedAudioStorageError,
    generatedAudioStatus,
    generatedAudioUsage,
    handleDeleteGeneratedAudio,
    persistGeneratedAudio,
    resolvedUsage,
    storageLimitBytes,
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
  const migrationState = readGeneratedAudioArchiveMigrationState()
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

  markGeneratedAudioArchiveImported(importedIds)
  markGeneratedAudioArchiveConflicted(conflictIds)

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

function storedGeneratedAudioFromInput(input: SaveGeneratedAudioInput): StoredGeneratedAudio {
  return {
    ...input,
    contentType: input.contentType || input.blob.type || "audio/mpeg",
    createdAt: input.createdAt ?? new Date().toISOString(),
    generationElapsedMs: input.generationElapsedMs ?? null,
    id: createTemporaryGeneratedAudioId(),
    multiVoiceMetadata: input.multiVoiceMetadata ?? null,
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
