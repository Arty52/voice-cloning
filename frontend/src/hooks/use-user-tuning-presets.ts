import { useEffect, useState } from "react"

import {
  createUserTuningPreset,
  deleteUserTuningPreset,
  isUserTuningPresetsUnavailableError,
  listUserTuningPresets,
  updateUserTuningPreset,
  type UserTuningPresetInput,
} from "@/lib/user-tuning-presets-api"
import type { AsyncStatus, UserTuningPreset } from "@/types"

type PersistenceMode = "browser" | "server"

const STORAGE_KEY = "voice-cloning:user-tuning-presets:v1"

export function useUserTuningPresets() {
  const [presets, setPresets] = useState<UserTuningPreset[]>([])
  const [status, setStatus] = useState<AsyncStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>("browser")

  useEffect(() => {
    let isMounted = true

    async function loadPresets() {
      setStatus("loading")
      try {
        try {
          const response = await listUserTuningPresets()
          if (!isMounted) {
            return
          }
          setPersistenceMode("server")
          setPresets(sortPresets(response.presets))
          setError(null)
          setStatus("success")
          return
        } catch (caught) {
          if (!isUserTuningPresetsUnavailableError(caught)) {
            throw caught
          }
        }

        if (!isMounted) {
          return
        }
        setPersistenceMode("browser")
        setPresets(readBrowserPresets())
        setError(null)
        setStatus("success")
      } catch (caught) {
        if (!isMounted) {
          return
        }
        setError(caught instanceof Error ? caught.message : "Unable to load user tuning presets.")
        setStatus("error")
      }
    }

    void loadPresets()
    return () => {
      isMounted = false
    }
  }, [])

  async function createPreset(input: UserTuningPresetInput) {
    try {
      const preset =
        persistenceMode === "server"
          ? await createUserTuningPreset(input)
          : createBrowserPreset(input, presets)
      setPresets((current) => sortPresets([...current.filter((candidate) => candidate.id !== preset.id), preset]))
      setError(null)
      return preset
    } catch (caught) {
      if (persistenceMode === "server" && isUserTuningPresetsUnavailableError(caught)) {
        return createPresetInBrowser(input)
      }
      setError(caught instanceof Error ? caught.message : "Unable to save user tuning preset.")
      return null
    }
  }

  async function updatePreset(id: string, input: UserTuningPresetInput) {
    try {
      const preset =
        persistenceMode === "server"
          ? await updateUserTuningPreset(id, input)
          : updateBrowserPreset(id, input, presets)
      setPresets((current) => sortPresets(current.map((candidate) => (candidate.id === preset.id ? preset : candidate))))
      setError(null)
      return preset
    } catch (caught) {
      if (persistenceMode === "server" && isUserTuningPresetsUnavailableError(caught)) {
        return updatePresetInBrowser(id, input)
      }
      setError(caught instanceof Error ? caught.message : "Unable to update user tuning preset.")
      return null
    }
  }

  async function deletePreset(id: string) {
    try {
      if (persistenceMode === "server") {
        await deleteUserTuningPreset(id)
      } else {
        writeBrowserPresets(presets.filter((preset) => preset.id !== id))
      }
      setPresets((current) => current.filter((preset) => preset.id !== id))
      setError(null)
    } catch (caught) {
      if (persistenceMode === "server" && isUserTuningPresetsUnavailableError(caught)) {
        deletePresetInBrowser(id)
        return
      }
      setError(caught instanceof Error ? caught.message : "Unable to delete user tuning preset.")
    }
  }

  function createPresetInBrowser(input: UserTuningPresetInput) {
    const browserPresets = readBrowserPresets()
    const preset = createBrowserPreset(input, browserPresets)
    setPersistenceMode("browser")
    setPresets(sortPresets([...browserPresets, preset]))
    setError(null)
    return preset
  }

  function updatePresetInBrowser(id: string, input: UserTuningPresetInput) {
    const browserPresets = readBrowserPresets()
    const preset = updateBrowserPreset(id, input, browserPresets)
    setPersistenceMode("browser")
    setPresets(sortPresets(browserPresets.map((candidate) => (candidate.id === preset.id ? preset : candidate))))
    setError(null)
    return preset
  }

  function deletePresetInBrowser(id: string) {
    const browserPresets = readBrowserPresets().filter((preset) => preset.id !== id)
    writeBrowserPresets(browserPresets)
    setPersistenceMode("browser")
    setPresets(browserPresets)
    setError(null)
  }

  return {
    createPreset,
    deletePreset,
    error,
    persistenceMode,
    presets,
    status,
    updatePreset,
  }
}

function createBrowserPreset(input: UserTuningPresetInput, existingPresets: UserTuningPreset[]) {
  const id = normalizePresetId(input.id) || createPresetId()
  if (existingPresets.some((preset) => preset.id === id)) {
    throw new Error(`Voice tuning preset already exists: ${id}.`)
  }
  const now = new Date().toISOString()
  const preset: UserTuningPreset = {
    id,
    name: input.name.trim(),
    providerId: input.providerId,
    settings: { ...input.settings },
    createdAt: now,
    updatedAt: now,
    voicePresetId: input.voicePresetId ?? null,
  }
  writeBrowserPresets([...existingPresets, preset])
  return preset
}

function updateBrowserPreset(id: string, input: UserTuningPresetInput, existingPresets: UserTuningPreset[]) {
  const existing = existingPresets.find((preset) => preset.id === id)
  if (!existing) {
    throw new Error("Voice tuning preset was not found.")
  }
  const preset: UserTuningPreset = {
    ...existing,
    name: input.name.trim(),
    providerId: input.providerId,
    settings: { ...input.settings },
    updatedAt: new Date().toISOString(),
    voicePresetId: input.voicePresetId ?? null,
  }
  writeBrowserPresets(existingPresets.map((candidate) => (candidate.id === id ? preset : candidate)))
  return preset
}

function readBrowserPresets() {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY)
    if (!rawValue) {
      return []
    }
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return sortPresets(parsed.filter(isStoredUserTuningPreset).map(normalizeStoredPreset))
  } catch {
    return []
  }
}

function writeBrowserPresets(presets: UserTuningPreset[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sortPresets(presets)))
  } catch {
    // Browser-local persistence is best-effort; keep in-memory state usable.
  }
}

function normalizeStoredPreset(preset: UserTuningPreset): UserTuningPreset {
  return {
    id: preset.id,
    name: preset.name,
    providerId: preset.providerId,
    settings: { ...preset.settings },
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    voicePresetId:
      preset.voicePresetId === "standardNarration" || preset.voicePresetId === "animatedDialogue"
        ? preset.voicePresetId
        : null,
  }
}

function isStoredUserTuningPreset(value: unknown): value is UserTuningPreset {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "providerId" in value &&
    "settings" in value
  )
}

function normalizePresetId(id: string | null | undefined) {
  return id?.trim().replace(/[^A-Za-z0-9._:-]+/g, "-") ?? ""
}

function createPresetId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return `preset-${window.crypto.randomUUID()}`
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sortPresets(presets: UserTuningPreset[]) {
  return [...presets].sort(
    (left, right) =>
      left.providerId.localeCompare(right.providerId) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
  )
}
