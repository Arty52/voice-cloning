import { useCallback, useEffect, useState } from "react"

import { DEFAULT_MODEL_ID } from "@/constants"
import { fetchModels, fetchSubscription } from "@/lib/api"
import type { AsyncStatus, ModelOption, SubscriptionResponse } from "@/types"

type UseVoiceMetadataOptions = {
  canUseProvider: boolean
  providerKey: string | null
  providerStatus: AsyncStatus
}

const MISSING_PROVIDER_KEY_MESSAGE = "Add a provider API key to load this data."

export function useVoiceMetadata({ canUseProvider, providerKey, providerStatus }: UseVoiceMetadataOptions) {
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] = useState<AsyncStatus>("idle")
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelStatus, setModelStatus] = useState<AsyncStatus>("idle")
  const [modelError, setModelError] = useState<string | null>(null)
  const [backendDefaultModelId, setBackendDefaultModelId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID)

  const loadSubscription = useCallback(async () => {
    if (!canUseProvider) {
      setSubscription(null)
      setSubscriptionStatus("error")
      setSubscriptionError(MISSING_PROVIDER_KEY_MESSAGE)
      return
    }
    setSubscriptionStatus("loading")
    setSubscriptionError(null)
    try {
      const payload = await fetchSubscription({ providerKey })
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
  }, [canUseProvider, providerKey])

  const loadModels = useCallback(async () => {
    if (!canUseProvider) {
      setModels([])
      setBackendDefaultModelId(null)
      setModelStatus("error")
      setModelError(MISSING_PROVIDER_KEY_MESSAGE)
      setSelectedModelId((current) => current || DEFAULT_MODEL_ID)
      return
    }
    setModelStatus("loading")
    setModelError(null)
    try {
      const payload = await fetchModels({ providerKey })
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
  }, [canUseProvider, providerKey])

  useEffect(() => {
    if (providerStatus === "idle" || providerStatus === "loading") {
      return undefined
    }
    const timeoutId = window.setTimeout(() => {
      void loadSubscription()
      void loadModels()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadModels, loadSubscription, providerStatus])

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
