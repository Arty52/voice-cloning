import { useEffect, useMemo, useState } from "react"

import { fetchProviders } from "@/lib/api"
import {
  clearStoredProviderKey,
  loadStoredProviderKeys,
  saveStoredProviderKeys,
  setStoredProviderKey,
  type StoredProviderKeys,
} from "@/lib/provider-keys"
import type { AsyncStatus, ProviderKeySource, VoiceProvider } from "@/types"

const DEFAULT_PROVIDER_SAMPLE = {
  maxWindowSeconds: 120,
  recommendedMinSeconds: 60,
  recommendedMaxSeconds: 120,
}

export function useProviderKeys() {
  const [providers, setProviders] = useState<VoiceProvider[]>([])
  const [defaultProviderId, setDefaultProviderId] = useState("elevenlabs")
  const [providerStatus, setProviderStatus] = useState<AsyncStatus>("idle")
  const [providerError, setProviderError] = useState<string | null>(null)
  const [providerKeys, setProviderKeys] = useState<StoredProviderKeys>(() => loadStoredProviderKeys())

  useEffect(() => {
    let isMounted = true

    async function loadProviderConfig() {
      setProviderStatus("loading")
      setProviderError(null)
      try {
        const payload = await fetchProviders()
        if (!isMounted) {
          return
        }
        const loadedProviders = Array.isArray(payload.providers) ? payload.providers.map(normalizeVoiceProvider) : []
        setProviders(loadedProviders)
        setDefaultProviderId(payload.defaultProviderId || loadedProviders[0]?.id || "elevenlabs")
        setProviderStatus("success")
      } catch (caught) {
        if (!isMounted) {
          return
        }
        setProviders([])
        setProviderStatus("error")
        setProviderError(caught instanceof Error ? caught.message : "Unable to load provider settings.")
      }
    }

    void loadProviderConfig()
    return () => {
      isMounted = false
    }
  }, [])

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === defaultProviderId) ?? providers[0] ?? null,
    [defaultProviderId, providers]
  )
  const activeProviderId = activeProvider?.id ?? defaultProviderId
  const activeProviderKey = providerKeys[activeProviderId]?.trim() || null
  const hasServerKey = activeProvider?.serverKeyConfigured === true
  const keySource: ProviderKeySource = activeProviderKey ? "browser" : hasServerKey || providerStatus !== "success" ? "server" : "missing"
  const canUseProvider = keySource !== "missing"

  function saveProviderKey(providerId: string, apiKey: string) {
    setProviderKeys((current) => {
      const nextKeys = setStoredProviderKey(current, providerId, apiKey)
      return saveStoredProviderKeys(nextKeys)
    })
  }

  function clearProviderKey(providerId: string) {
    setProviderKeys((current) => {
      const nextKeys = clearStoredProviderKey(current, providerId)
      return saveStoredProviderKeys(nextKeys)
    })
  }

  return {
    activeProvider,
    activeProviderId,
    activeProviderKey,
    canUseProvider,
    clearProviderKey,
    defaultProviderId,
    keySource,
    providerError,
    providerKeys,
    providers,
    providerStatus,
    saveProviderKey,
  }
}

function normalizeVoiceProvider(provider: VoiceProvider): VoiceProvider {
  return {
    ...provider,
    links: Array.isArray(provider.links) ? provider.links : [],
    sample: normalizeProviderSample(provider.sample),
    tuning: {
      controls: Array.isArray(provider.tuning?.controls) ? provider.tuning.controls : [],
      presets: Array.isArray(provider.tuning?.presets) ? provider.tuning.presets : [],
      defaultValues:
        provider.tuning?.defaultValues && typeof provider.tuning.defaultValues === "object"
          ? provider.tuning.defaultValues
          : {},
    },
  }
}

function normalizeProviderSample(sample: VoiceProvider["sample"]): VoiceProvider["sample"] {
  return {
    maxWindowSeconds: positiveNumberOrDefault(sample?.maxWindowSeconds, DEFAULT_PROVIDER_SAMPLE.maxWindowSeconds),
    recommendedMinSeconds: positiveNumberOrDefault(
      sample?.recommendedMinSeconds,
      DEFAULT_PROVIDER_SAMPLE.recommendedMinSeconds
    ),
    recommendedMaxSeconds: positiveNumberOrDefault(
      sample?.recommendedMaxSeconds,
      DEFAULT_PROVIDER_SAMPLE.recommendedMaxSeconds
    ),
  }
}

function positiveNumberOrDefault(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}
