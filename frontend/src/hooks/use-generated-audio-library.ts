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
import type { GeneratedResult } from "@/types"

export function useGeneratedAudioLibrary() {
  const [generatedAudioItems, setGeneratedAudioItems] = useState<GeneratedResult[]>([])
  const [generatedAudioUsage, setGeneratedAudioUsage] = useState<GeneratedAudioUsage | null>(null)
  const [generatedAudioStorageError, setGeneratedAudioStorageError] = useState<string | null>(null)
  const [storageLimitBytes, setStorageLimitBytes] = useState(() => getGeneratedAudioStorageLimitBytes())
  const generatedAudioItemsRef = useRef<GeneratedResult[]>([])

  useEffect(() => {
    async function loadGeneratedAudioLibrary() {
      try {
        const limitBytes = getGeneratedAudioStorageLimitBytes()
        const [records, usage] = await Promise.all([listGeneratedAudio(), getGeneratedAudioUsage(limitBytes)])
        replaceGeneratedAudioItems(records)
        setGeneratedAudioUsage(usage)
        setGeneratedAudioStorageError(null)
      } catch (caught) {
        setGeneratedAudioStorageError(caught instanceof Error ? caught.message : "Unable to load generated audio.")
      }
    }

    void loadGeneratedAudioLibrary()
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
  }

  function showTemporaryGeneratedAudio(record: StoredGeneratedAudio) {
    const temporaryItem = storedAudioToResult(record)
    setGeneratedAudioItems((previous) => [temporaryItem, ...previous])
  }

  async function persistGeneratedAudio(input: SaveGeneratedAudioInput, limitBytes: number) {
    try {
      const saved = await saveGeneratedAudio(input, limitBytes)
      const records = await listGeneratedAudio()
      replaceGeneratedAudioItems(records)
      setGeneratedAudioUsage(saved.usage)
      setGeneratedAudioStorageError(null)
    } catch (storageError) {
      showTemporaryGeneratedAudio({
        ...input,
        contentType: input.contentType || input.blob.type || "audio/mpeg",
        createdAt: input.createdAt ?? new Date().toISOString(),
        id: createTemporaryGeneratedAudioId(),
        sizeBytes: input.blob.size,
      })
      setGeneratedAudioStorageError(formatGeneratedAudioStorageError(storageError))
    }
  }

  async function handleDeleteGeneratedAudio(id: string) {
    if (isTemporaryGeneratedAudioId(id)) {
      removeGeneratedAudioItemFromState(id)
      setGeneratedAudioStorageError(null)
      return
    }

    try {
      const usage = await deleteGeneratedAudio(id)
      removeGeneratedAudioItemFromState(id)
      setGeneratedAudioUsage(usage)
      setGeneratedAudioStorageError(null)
    } catch (caught) {
      setGeneratedAudioStorageError(caught instanceof Error ? caught.message : "Unable to remove generated audio.")
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
    }
  }

  async function applyGeneratedAudioStorageLimit(nextLimitBytes: number) {
    try {
      const result = await updateGeneratedAudioStorageLimitBytes(nextLimitBytes)
      const records = await listGeneratedAudio()
      replaceGeneratedAudioItems(records)
      setStorageLimitBytes(result.usage.limitBytes)
      setGeneratedAudioUsage(result.usage)
      setGeneratedAudioStorageError(null)
    } catch (caught) {
      setGeneratedAudioStorageError(caught instanceof Error ? caught.message : "Unable to update generated audio storage.")
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
    generatedAudioStorageError,
    generatedAudioUsage,
    handleDeleteGeneratedAudio,
    persistGeneratedAudio,
    resolvedUsage,
    storageLimitBytes,
  }
}
