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
  createTemporaryGeneratedAudioId,
  formatGeneratedAudioStorageError,
  isTemporaryGeneratedAudioId,
  revokeGeneratedAudioUrls,
  storedAudioToResult,
} from "@/lib/generated-audio-view-model"
import type { AsyncStatus, GeneratedResult } from "@/types"

export type GeneratedAudioMutation = "clear" | "delete" | "storage-limit"

type GeneratedAudioMutationState = {
  id: number
  type: GeneratedAudioMutation
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

  useEffect(() => {
    let isMounted = true

    async function loadGeneratedAudioLibrary() {
      setGeneratedAudioStatus("loading")
      try {
        const limitBytes = getGeneratedAudioStorageLimitBytes()
        const [records, usage] = await Promise.all([listGeneratedAudio(), getGeneratedAudioUsage(limitBytes)])
        if (!isMounted) {
          return
        }
        replaceGeneratedAudioItems(records)
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

  function replaceGeneratedAudioItems(records: StoredGeneratedAudio[]) {
    const nextItems = records.map(storedAudioToResult)
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
    try {
      const saved = await saveGeneratedAudio(input, limitBytes)
      const records = await listGeneratedAudio()
      const nextItems = replaceGeneratedAudioItems(records)
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
      const usage = await deleteGeneratedAudio(id)
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
          URL.revokeObjectURL(item.url)
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
      const usage = await clearGeneratedAudio()
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
      const result = await updateGeneratedAudioStorageLimitBytes(nextLimitBytes)
      const records = await listGeneratedAudio()
      replaceGeneratedAudioItems(records)
      setStorageLimitBytes(result.usage.limitBytes)
      setGeneratedAudioUsage(result.usage)
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
