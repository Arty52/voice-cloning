import { useEffect, useRef, useState } from "react"

import {
  BACKEND_DEFAULT_MODEL_LABEL,
  CANCELED_GENERATION_MESSAGE,
  CANCEL_GENERATION_CONFIRMATION,
} from "@/constants"
import { createSpeech, hasModel } from "@/lib/api"
import type { SaveGeneratedAudioInput } from "@/lib/generated-audio-storage"
import type { GeneratedResult, ModelOption, RequestStatus, VoiceAsset, VoiceTuningValues } from "@/types"

type GenerateSpeechInput = {
  backendDefaultModelId: string | null
  canUseProvider: boolean
  models: ModelOption[]
  providerId: string | null
  providerKey: string | null
  selectedModelId: string
  selectedVoice: VoiceAsset | null
  storageLimitBytes: number
  text: string
  tuning: VoiceTuningValues
}

type UseSpeechGenerationOptions = {
  persistGeneratedAudio: (input: SaveGeneratedAudioInput, limitBytes: number) => Promise<GeneratedResult>
}

export function useSpeechGeneration({ persistGeneratedAudio }: UseSpeechGenerationOptions) {
  const [status, setStatus] = useState<RequestStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const generationAbortController = useRef<AbortController | null>(null)
  const isGenerating = status === "generating"

  useEffect(() => {
    return () => {
      generationAbortController.current?.abort()
    }
  }, [])

  async function generateSpeech({
    backendDefaultModelId,
    canUseProvider,
    models,
    providerId,
    providerKey,
    selectedModelId,
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
        setStatus("canceled")
        setError(CANCELED_GENERATION_MESSAGE)
        return null
      }

      const createdAt = new Date().toISOString()
      const generatedAudioInput = {
        appVoiceId: response.appVoiceId || selectedVoice.id,
        blob: response.blob,
        cacheState: response.cacheState || "unknown",
        characterCount: response.characterCount,
        contentType: response.contentType,
        createdAt,
        modelId: response.modelId || submittedModelId || backendDefaultModelId || BACKEND_DEFAULT_MODEL_LABEL,
        requestId: response.requestId,
        voiceId: response.voiceId || "unknown",
        voiceName: selectedVoice.name,
      }

      const generatedResult = await persistGeneratedAudio(generatedAudioInput, storageLimitBytes)
      setStatus("success")
      return generatedResult
    } catch (caught) {
      if (isAbortError(caught)) {
        setStatus("canceled")
        setError(CANCELED_GENERATION_MESSAGE)
        return null
      }
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
    isGenerating,
    status,
  }
}

function isAbortError(value: unknown) {
  return typeof value === "object" && value !== null && "name" in value && value.name === "AbortError"
}
