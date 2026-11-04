import { useEffect, useState } from "react"
import { fetchTranscriptionEngines } from "@/lib/api"
import type { AsyncStatus, TranscriptionEnginesResponse, TranscriptionOptions } from "@/types"

export const TRANSCRIPTION_SETTINGS_KEY = "voice-cloning.transcriptionOptions.v1"
const DEFAULT_OPTIONS: TranscriptionOptions = { engineId: "faster-whisper", language: "en", detectSpeakers: true }

export function useTranscriptionSettings() {
  const [options, setOptions] = useState(readOptions)
  const [catalog, setCatalog] = useState<TranscriptionEnginesResponse | null>(null)
  const [status, setStatus] = useState<AsyncStatus>("loading")
  const [error, setError] = useState<string | null>(null)
  const [refreshId, setRefreshId] = useState(0)
  useEffect(() => {
    let active = true
    void fetchTranscriptionEngines().then((result) => {
      if (!active) return
      setCatalog(result)
      setStatus("success")
      setError(null)
    }).catch((caught: unknown) => {
      if (!active) return
      setStatus("error")
      setError(caught instanceof Error ? caught.message : "Unable to load transcription engines.")
    })
    return () => { active = false }
  }, [refreshId])
  useEffect(() => {
    try { window.localStorage.setItem(TRANSCRIPTION_SETTINGS_KEY, JSON.stringify(options)) } catch { /* Optional browser preference. */ }
  }, [options])
  const engines = catalog?.engines ?? []
  const selectedEngine = engines.find((engine) => engine.id === options.engineId)
  const languageSupported = selectedEngine?.languages.includes(options.language) === true
  const ready = status === "success" && selectedEngine?.ready === true && languageSupported
  const unavailableReason = status === "loading" ? "Checking transcription engine availability."
    : error || (!selectedEngine ? "The saved engine is unavailable. Select an available engine."
      : !languageSupported ? "Select a supported language for this engine."
        : !selectedEngine.ready ? selectedEngine.unavailableReason || "Prepare this model and start its worker."
          : null)
  function selectEngine(engineId: string) {
    const engine = engines.find((entry) => entry.id === engineId)
    if (!engine) return
    setOptions((current) => ({ ...current, engineId,
      language: engine.languages.includes(current.language) ? current.language : engine.languages[0] ?? "en" }))
  }
  function selectLanguage(language: string) {
    if (selectedEngine?.languages.includes(language)) setOptions((current) => ({ ...current, language }))
  }
  function refresh() {
    setStatus("loading")
    setRefreshId((current) => current + 1)
  }
  return { options, engines, status, selectedEngine, ready, unavailableReason,
    nativeDiarizationReady: catalog?.nativeDiarizationReady ?? false,
    selectEngine, selectLanguage, refresh,
    setDetectSpeakers: (detectSpeakers: boolean) => setOptions((current) => ({ ...current, detectSpeakers })) }
}

export type TranscriptionSettingsController = ReturnType<typeof useTranscriptionSettings>

function readOptions(): TranscriptionOptions {
  try {
    const stored = JSON.parse(window.localStorage.getItem(TRANSCRIPTION_SETTINGS_KEY) ?? "null") as Partial<TranscriptionOptions> | null
    if (stored && typeof stored.engineId === "string" && stored.engineId.length < 80 &&
        typeof stored.language === "string" && stored.language.length < 20 && typeof stored.detectSpeakers === "boolean") {
      return stored as TranscriptionOptions
    }
  } catch { /* Malformed or blocked storage uses the compatibility default. */ }
  return DEFAULT_OPTIONS
}
