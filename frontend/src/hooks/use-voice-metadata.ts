import { useCallback, useEffect, useRef, useState } from "react"

import { DEFAULT_MODEL_ID } from "@/constants"
import { fetchModels, fetchSubscription } from "@/lib/api"
import { isAppSettingsUnavailableError, loadAppSettings, saveAppSettings } from "@/lib/app-settings-api"
import type { AsyncStatus, ModelOption, SubscriptionResponse } from "@/types"

type UseVoiceMetadataOptions = {
  canUseProvider: boolean
  providerId: string | null
  providerKey: string | null
  providerStatus: AsyncStatus
}

const MISSING_PROVIDER_KEY_MESSAGE = "Add a provider API key to load this data."

export function useVoiceMetadata({ canUseProvider, providerId, providerKey, providerStatus }: UseVoiceMetadataOptions) {
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] = useState<AsyncStatus>("idle")
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelStatus, setModelStatus] = useState<AsyncStatus>("idle")
  const [modelError, setModelError] = useState<string | null>(null)
  const [backendDefaultModelId, setBackendDefaultModelId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelIdState] = useState(DEFAULT_MODEL_ID)
  const subscriptionRequestId = useRef(0)
  const modelsRequestId = useRef(0)

  const loadSubscription = useCallback(async () => {
    const requestId = (subscriptionRequestId.current += 1)
    if (!canUseProvider) {
      setSubscription(null)
      setSubscriptionStatus("error")
      setSubscriptionError(MISSING_PROVIDER_KEY_MESSAGE)
      return
    }
    setSubscriptionStatus("loading")
    setSubscriptionError(null)
    try {
      const payload = await fetchSubscription({ providerId, providerKey })
      if (requestId !== subscriptionRequestId.current) {
        return
      }
      if (payload.available) {
        setSubscription(payload)
        setSubscriptionStatus("success")
      } else {
        setSubscription(null)
        setSubscriptionStatus("error")
        setSubscriptionError(payload.error || "Quota unavailable.")
      }
    } catch (caught) {
      if (requestId !== subscriptionRequestId.current) {
        return
      }
      setSubscription(null)
      setSubscriptionStatus("error")
      setSubscriptionError(caught instanceof Error ? caught.message : "Unable to load quota.")
    }
  }, [canUseProvider, providerId, providerKey])

  const loadModels = useCallback(async () => {
    const requestId = (modelsRequestId.current += 1)
    if (!canUseProvider) {
      setModels([])
      setBackendDefaultModelId(null)
      setModelStatus("error")
      setModelError(MISSING_PROVIDER_KEY_MESSAGE)
      setSelectedModelIdState((current) => current || DEFAULT_MODEL_ID)
      return
    }
    setModelStatus("loading")
    setModelError(null)
    try {
      const [payload, appSettings] = await Promise.all([
        fetchModels({ providerId, providerKey }),
        loadAppSettingsOrNull(),
      ])
      if (requestId !== modelsRequestId.current) {
        return
      }
      const loadedModels = Array.isArray(payload.models) ? payload.models : []
      setBackendDefaultModelId(payload.defaultModelId || null)
      setModels(payload.available ? loadedModels : [])
      const preferredModelId = providerId ? appSettings?.settings.selectedModelByProvider[providerId] : null
      setSelectedModelIdState((current) => {
        if (preferredModelId && loadedModels.some((model) => model.modelId === preferredModelId)) {
          return preferredModelId
        }
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
      if (requestId !== modelsRequestId.current) {
        return
      }
      setModels([])
      setBackendDefaultModelId(null)
      setSelectedModelIdState((current) => current || DEFAULT_MODEL_ID)
      setModelStatus("error")
      setModelError(caught instanceof Error ? caught.message : "Unable to load models.")
    }
  }, [canUseProvider, providerId, providerKey])

  function setSelectedModelId(modelId: string) {
    setSelectedModelIdState(modelId)
    if (!providerId) {
      return
    }
    void saveAppSettings({ selectedModelByProvider: { [providerId]: modelId } }).catch((caught) => {
      if (!isAppSettingsUnavailableError(caught)) {
        setModelError(caught instanceof Error ? caught.message : "Unable to save selected model.")
      }
    })
  }

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

async function loadAppSettingsOrNull() {
  try {
    return await loadAppSettings()
  } catch (caught) {
    if (isAppSettingsUnavailableError(caught)) {
      return null
    }
    throw caught
  }
}
