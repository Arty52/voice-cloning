import { useEffect, useRef, useState } from "react"

import {
  BACKEND_DEFAULT_MODEL_LABEL,
  CANCELED_GENERATION_MESSAGE,
  CANCEL_GENERATION_CONFIRMATION,
} from "@/constants"
import { createSpeech, hasModel } from "@/lib/api"
import { buildGeneratedAudioTuningMetadata } from "@/lib/generated-audio-metadata"
import type { SaveGeneratedAudioInput } from "@/lib/generated-audio-storage"
import type {
  GeneratedResult,
  ModelOption,
  RequestStatus,
  UserTuningPreset,
  VoiceAsset,
  VoiceProvider,
  VoiceTuningValues,
} from "@/types"

type GenerateSpeechInput = {
  backendDefaultModelId: string | null
  canUseProvider: boolean
  models: ModelOption[]
  provider: VoiceProvider | null
  providerId: string | null
  providerKey: string | null
  selectedModelId: string
  selectedTuningPresetId: string
  selectedUserTuningPreset?: UserTuningPreset | null
  selectedVoice: VoiceAsset | null
  storageLimitBytes: number
  text: string
  tuning: VoiceTuningValues
}

type UseSpeechGenerationOptions = {
  persistGeneratedAudio: (input: SaveGeneratedAudioInput, limitBytes: number) => Promise<GeneratedResult>
}

const TIMER_INTERVAL_MS = 100

export function useSpeechGeneration({ persistGeneratedAudio }: UseSpeechGenerationOptions) {
  const [status, setStatus] = useState<RequestStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [generationElapsedMs, setGenerationElapsedMs] = useState<number | null>(null)
  const generationAbortController = useRef<AbortController | null>(null)
  const generationStartedAtRef = useRef<number | null>(null)
  const isGenerating = status === "generating"

  useEffect(() => {
    return () => {
      generationAbortController.current?.abort()
      generationStartedAtRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isGenerating || generationStartedAtRef.current === null) {
      return
    }
    const intervalId = window.setInterval(() => {
      const startedAt = generationStartedAtRef.current
      if (startedAt !== null) {
        setGenerationElapsedMs(Math.max(0, Math.round(performance.now() - startedAt)))
      }
    }, TIMER_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [isGenerating])

  async function generateSpeech({
    backendDefaultModelId,
    canUseProvider,
    models,
    provider,
    providerId,
    providerKey,
    selectedModelId,
    selectedTuningPresetId,
    selectedUserTuningPreset = null,
    selectedVoice,
    storageLimitBytes,
    text,
    tuning,
  }: GenerateSpeechInput) {
    if (text.trim().length === 0 || !selectedVoice) {
      setStatus("error")
      setError(selectedVoice ? "Enter text first." : "Select a voice first.")
      return null
    }
    if (!canUseProvider) {
      setStatus("error")
      setError("Add a provider API key before generating speech.")
      return null
    }

    setStatus("generating")
    setError(null)
    startGenerationTimer()
    const abortController = new AbortController()
    generationAbortController.current = abortController
    const submittedModelId = hasModel(models, selectedModelId) ? selectedModelId : null

    try {
      const response = await createSpeech({
        modelId: submittedModelId,
        providerId,
        providerKey,
        signal: abortController.signal,
        text,
        tuning,
        voiceId: selectedVoice.id,
      })
      if (response.status === "canceled") {
        finishGenerationTimer()
        setStatus("canceled")
        setError(CANCELED_GENERATION_MESSAGE)
        return null
      }
      const generationElapsedMs = finishGenerationTimer()

      const createdAt = new Date().toISOString()
      const generatedAudioInput = {
        appVoiceId: response.appVoiceId || selectedVoice.id,
        blob: response.blob,
        cacheState: response.cacheState || "unknown",
        characterCount: response.characterCount,
        contentType: response.contentType,
        createdAt,
        generationElapsedMs,
        modelId: response.modelId || submittedModelId || backendDefaultModelId || BACKEND_DEFAULT_MODEL_LABEL,
        requestId: response.requestId,
        tuningMetadata: buildGeneratedAudioTuningMetadata({
          provider,
          selectedPresetId: selectedTuningPresetId,
          tuning,
          userPreset: selectedUserTuningPreset,
        }),
        voiceId: response.voiceId || "unknown",
        voiceName: selectedVoice.name,
      }

      const generatedResult = await persistGeneratedAudio(generatedAudioInput, storageLimitBytes)
      setStatus("success")
      return generatedResult
    } catch (caught) {
      if (isAbortError(caught)) {
        finishGenerationTimer()
        setStatus("canceled")
        setError(CANCELED_GENERATION_MESSAGE)
        return null
      }
      finishGenerationTimer()
      setStatus("error")
      setError(caught instanceof Error ? caught.message : "Unable to generate speech.")
      return null
    } finally {
      if (generationAbortController.current === abortController) {
        generationAbortController.current = null
      }
    }
  }

  function cancelGeneration() {
    const abortController = generationAbortController.current
    if (!abortController) {
      return
    }
    const shouldCancel = window.confirm(CANCEL_GENERATION_CONFIRMATION)
    if (shouldCancel) {
      abortController.abort()
    }
  }

  return {
    cancelGeneration,
    error,
    generateSpeech,
    generationElapsedMs,
    isGenerating,
    status,
  }

  function startGenerationTimer() {
    generationStartedAtRef.current = performance.now()
    setGenerationElapsedMs(0)
  }

  function finishGenerationTimer() {
    const elapsedMs = currentGenerationElapsedMs()
    setGenerationElapsedMs(elapsedMs)
    generationStartedAtRef.current = null
    return elapsedMs
  }

  function currentGenerationElapsedMs() {
    const startedAt = generationStartedAtRef.current
    if (startedAt === null) {
      return generationElapsedMs
    }
    return Math.max(0, Math.round(performance.now() - startedAt))
  }

}

function isAbortError(value: unknown) {
  return typeof value === "object" && value !== null && "name" in value && value.name === "AbortError"
}
