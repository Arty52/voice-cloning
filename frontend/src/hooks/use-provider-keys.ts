import { useEffect, useMemo, useState } from "react"

import { fetchProviders } from "@/lib/api"
import {
  clearStoredProviderKey,
  loadStoredProviderKeys,
  saveStoredProviderKeys,
  setStoredProviderKey,
  type StoredProviderKeys,
} from "@/lib/provider-keys"
import { FALLBACK_VOICE_PRESETS, normalizeVoicePresets } from "@/lib/voice-presets"
import type { AsyncStatus, ProviderKeySource, VoicePreset, VoiceProvider } from "@/types"

const DEFAULT_PROVIDER_SAMPLE = {
  maxWindowSeconds: 120,
  maxSourceUploadBytes: 1024 * 1024 * 1024,
  maxUploadBytes: 10 * 1024 * 1024,
  recommendedMinSeconds: 60,
  recommendedMaxSeconds: 120,
  targetSampleRateHz: 16000,
}

export function useProviderKeys() {
  const [providers, setProviders] = useState<VoiceProvider[]>([])
  const [defaultProviderId, setDefaultProviderId] = useState("elevenlabs")
  const [providerStatus, setProviderStatus] = useState<AsyncStatus>("idle")
  const [providerError, setProviderError] = useState<string | null>(null)
  const [providerKeys, setProviderKeys] = useState<StoredProviderKeys>(() => loadStoredProviderKeys())
  const [voicePresets, setVoicePresets] = useState<VoicePreset[]>(FALLBACK_VOICE_PRESETS)

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
        setVoicePresets(normalizeVoicePresets(payload.voicePresets))
        setProviders(loadedProviders)
        setDefaultProviderId(payload.defaultProviderId || loadedProviders[0]?.id || "elevenlabs")
        setProviderStatus("success")
      } catch (caught) {
        if (!isMounted) {
          return
        }
        setProviders([])
        setVoicePresets(FALLBACK_VOICE_PRESETS)
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
    voicePresets,
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
    maxSourceUploadBytes: positiveNumberOrDefault(
      sample?.maxSourceUploadBytes,
      DEFAULT_PROVIDER_SAMPLE.maxSourceUploadBytes
    ),
    maxUploadBytes: positiveNumberOrDefault(sample?.maxUploadBytes, DEFAULT_PROVIDER_SAMPLE.maxUploadBytes),
    recommendedMinSeconds: positiveNumberOrDefault(
      sample?.recommendedMinSeconds,
      DEFAULT_PROVIDER_SAMPLE.recommendedMinSeconds
    ),
    recommendedMaxSeconds: positiveNumberOrDefault(
      sample?.recommendedMaxSeconds,
      DEFAULT_PROVIDER_SAMPLE.recommendedMaxSeconds
    ),
    targetSampleRateHz: positiveNumberOrDefault(sample?.targetSampleRateHz, DEFAULT_PROVIDER_SAMPLE.targetSampleRateHz),
  }
}

function positiveNumberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}
