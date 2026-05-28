import { useEffect, useState } from "react"

import { DEFAULT_MODEL_ID } from "@/constants"
import { fetchModels, fetchSubscription } from "@/lib/api"
import type { AsyncStatus, ModelOption, SubscriptionResponse } from "@/types"

export function useVoiceMetadata() {
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] = useState<AsyncStatus>("idle")
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelStatus, setModelStatus] = useState<AsyncStatus>("idle")
  const [modelError, setModelError] = useState<string | null>(null)
  const [backendDefaultModelId, setBackendDefaultModelId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID)

  async function loadSubscription() {
    setSubscriptionStatus("loading")
    setSubscriptionError(null)
    try {
      const payload = await fetchSubscription()
      if (payload.available) {
        setSubscription(payload)
        setSubscriptionStatus("success")
      } else {
        setSubscription(null)
        setSubscriptionStatus("error")
        setSubscriptionError(payload.error || "Quota unavailable.")
      }
    } catch (caught) {
      setSubscription(null)
      setSubscriptionStatus("error")
      setSubscriptionError(caught instanceof Error ? caught.message : "Unable to load quota.")
    }
  }

  async function loadModels() {
    setModelStatus("loading")
    setModelError(null)
    try {
      const payload = await fetchModels()
      const loadedModels = Array.isArray(payload.models) ? payload.models : []
      setBackendDefaultModelId(payload.defaultModelId || null)
      setModels(payload.available ? loadedModels : [])
      setSelectedModelId((current) => {
        if (payload.available && loadedModels.some((model) => model.modelId === current)) {
          return current
        }
        return payload.defaultModelId || loadedModels[0]?.modelId || DEFAULT_MODEL_ID
      })
      if (payload.available) {
        setModelStatus("success")
      } else {
        setModelStatus("error")
        setModelError(payload.error || "Model metadata unavailable.")
      }
    } catch (caught) {
      setModels([])
      setBackendDefaultModelId(null)
      setSelectedModelId((current) => current || DEFAULT_MODEL_ID)
      setModelStatus("error")
      setModelError(caught instanceof Error ? caught.message : "Unable to load models.")
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSubscription()
      void loadModels()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  return {
    backendDefaultModelId,
    loadModels,
    loadSubscription,
    modelError,
    models,
    modelStatus,
    selectedModelId,
    setSelectedModelId,
    subscription,
    subscriptionError,
    subscriptionStatus,
  }
}
