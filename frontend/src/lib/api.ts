import type {
  ModelOption,
  ModelsResponse,
  ProvidersResponse,
  SubscriptionResponse,
  VoiceAsset,
  VoicesResponse,
  VoiceTuningValues,
} from "@/types"

export const VOICE_PROVIDER_KEY_HEADER = "X-Voice-Provider-Key"

export type ProviderRequestOptions = {
  providerId?: string | null
  providerKey: string | null
}

export type SpeechApiRequest = {
  modelId: string | null
  providerId: string | null
  providerKey: string | null
  signal: AbortSignal
  text: string
  tuning: VoiceTuningValues
  voiceId: string
}

export type SpeechApiResult =
  | { status: "canceled" }
  | {
      appVoiceId: string | null
      blob: Blob
      cacheState: string | null
      characterCount: number | null
      contentType: string
      modelId: string | null
      requestId: string | null
      status: "success"
      voiceId: string | null
    }

export async function fetchVoices() {
  return fetchJson<VoicesResponse>("/api/voices")
}

export async function addVoice(name: string, sampleFile: File) {
  const formData = new FormData()
  formData.append("name", name)
  formData.append("sampleFile", sampleFile)
  return fetchJson<{ voice: VoiceAsset }>("/api/voices", {
    method: "POST",
    body: formData,
  })
}

export async function renameVoice(voiceId: string, name: string) {
  return fetchJson<VoicesResponse>(`/api/voices/${encodeURIComponent(voiceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

export async function deleteVoice(voiceId: string) {
  return fetchJson<VoicesResponse>(`/api/voices/${encodeURIComponent(voiceId)}`, {
    method: "DELETE",
  })
}

export async function setDefaultVoice(voiceId: string) {
  return fetchJson<VoicesResponse>("/api/voices/default", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voiceId }),
  })
}

export async function fetchProviders() {
  return fetchJson<ProvidersResponse>("/api/providers")
}

export async function fetchSubscription(options?: ProviderRequestOptions) {
  return fetchJson<SubscriptionResponse>(providerUrl("/api/subscription", options), providerRequestInit(options))
}

export async function fetchModels(options?: ProviderRequestOptions) {
  return fetchJson<ModelsResponse>(providerUrl("/api/models", options), providerRequestInit(options))
}

export async function createSpeech({
  modelId,
  providerId,
  providerKey,
  signal,
  text,
  tuning,
  voiceId,
}: SpeechApiRequest): Promise<SpeechApiResult> {
  const formData = new FormData()
  formData.append("text", text.trim())
  formData.append("voiceId", voiceId)
  if (providerId) {
    formData.append("providerId", providerId)
  }
  if (modelId) {
    formData.append("modelId", modelId)
  }
  formData.append("voiceSettings", JSON.stringify(tuning))

  const response = await fetch("/api/speech", {
    method: "POST",
    body: formData,
    headers: providerHeaders({ providerKey }),
    signal,
  })
  if (response.status === 499) {
    return { status: "canceled" }
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const blob = await response.blob()
  return {
    appVoiceId: response.headers.get("X-App-Voice-Id"),
    blob,
    cacheState: response.headers.get("X-Voice-Cache"),
    characterCount: parseNullableInt(response.headers.get("X-Character-Count")),
    contentType: blob.type || response.headers.get("Content-Type") || "audio/mpeg",
    modelId: response.headers.get("X-Model-Id"),
    requestId: response.headers.get("X-Request-Id"),
    status: "success",
    voiceId: response.headers.get("X-Voice-Id"),
  }
}

export function hasModel(models: ModelOption[], modelId: string) {
  return models.some((model) => model.modelId === modelId)
}

export function providerHeaders(options?: ProviderRequestOptions) {
  const providerKey = options?.providerKey?.trim()
  return providerKey ? { [VOICE_PROVIDER_KEY_HEADER]: providerKey } : undefined
}

function providerRequestInit(options?: ProviderRequestOptions): RequestInit | undefined {
  const headers = providerHeaders(options)
  return headers ? { headers } : undefined
}

function providerUrl(url: string, options?: ProviderRequestOptions) {
  const providerId = options?.providerId?.trim()
  if (!providerId) {
    return url
  }
  const params = new URLSearchParams({ providerId })
  return `${url}?${params.toString()}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return (await response.json()) as T
}

async function readError(response: Response) {
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === "string") {
      return payload.detail
    }
  }
  const text = await response.text()
  return text || `Request failed with status ${response.status}.`
}

function parseNullableInt(value: string | null) {
  if (!value) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}
