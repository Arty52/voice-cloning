import type {
  ModelOption,
  ModelsResponse,
  ProvidersResponse,
  SampleProcessingJobResponse,
  SampleProcessingOperationId,
  SampleProcessingOptionsResponse,
  SampleProcessingPresetId,
  SampleProcessingSourcePreference,
  SubscriptionResponse,
  VoiceAsset,
  VoicePresetId,
  VoiceSampleMode,
  VoicesResponse,
  VoiceTuningValues,
} from "@/types"

export const VOICE_PROVIDER_KEY_HEADER = "X-Voice-Provider-Key"

export type ProviderRequestOptions = {
  providerId?: string | null
  providerKey: string | null
}

export type AddVoiceOptions = {
  sampleMode?: VoiceSampleMode
  sourceFile?: File | null
  voicePresetId?: VoicePresetId
  windowDurationSeconds?: number | null
  windowStartSeconds?: number | null
}

export type VoiceUpdate = {
  name?: string
  voicePresetId?: VoicePresetId
}

export type CreateSampleProcessingJobRequest = {
  operationId: SampleProcessingOperationId
  processingPresetId?: SampleProcessingPresetId | null
  sourceFile?: File | null
  sourcePreference?: SampleProcessingSourcePreference
  sourceVoiceId?: string | null
}

export type SaveProcessedVoiceRequest = {
  name: string
  voicePresetId?: VoicePresetId
}

export type SpeakerNameAssignmentRequest = {
  speakerId: string
  name?: string | null
}

export type SpeakerTranscriptAssignmentRequest = {
  itemId: string
  speakerId: string
}

export type UpdateSpeakerAssignmentsRequest = {
  speakerNames?: SpeakerNameAssignmentRequest[]
  transcriptAssignments?: SpeakerTranscriptAssignmentRequest[]
}

export type SaveSpeakerVoiceRequest = {
  speakerId: string
  name: string
  voicePresetId?: VoicePresetId
}

export type SaveSpeakerVoicesRequest = {
  voices: SaveSpeakerVoiceRequest[]
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

export async function addVoice(name: string, sampleFile: File, options: AddVoiceOptions = {}) {
  const formData = new FormData()
  formData.append("name", name)
  formData.append("sampleFile", sampleFile)
  if (options.sampleMode) {
    formData.append("sampleMode", options.sampleMode)
  }
  if (options.sourceFile) {
    formData.append("sourceFile", options.sourceFile)
  }
  if (options.voicePresetId) {
    formData.append("voicePresetId", options.voicePresetId)
  }
  if (options.windowStartSeconds !== undefined && options.windowStartSeconds !== null) {
    formData.append("windowStartSeconds", String(options.windowStartSeconds))
  }
  if (options.windowDurationSeconds !== undefined && options.windowDurationSeconds !== null) {
    formData.append("windowDurationSeconds", String(options.windowDurationSeconds))
  }
  return fetchJson<{ voice: VoiceAsset }>("/api/voices", {
    method: "POST",
    body: formData,
  })
}

export async function renameVoice(voiceId: string, name: string) {
  return updateVoice(voiceId, { name })
}

export async function updateVoice(voiceId: string, update: VoiceUpdate) {
  return fetchJson<VoicesResponse>(`/api/voices/${encodeURIComponent(voiceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
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

export async function fetchSampleProcessingOptions() {
  return fetchJson<SampleProcessingOptionsResponse>("/api/sample-processing/options")
}

export async function createSampleProcessingJob({
  operationId,
  processingPresetId,
  sourceFile,
  sourcePreference,
  sourceVoiceId,
}: CreateSampleProcessingJobRequest) {
  const formData = new FormData()
  formData.append("operationId", operationId)
  if (processingPresetId) {
    formData.append("processingPresetId", processingPresetId)
  }
  if (sourceVoiceId) {
    formData.append("sourceVoiceId", sourceVoiceId)
  }
  if (sourcePreference) {
    formData.append("sourcePreference", sourcePreference)
  }
  if (sourceFile) {
    formData.append("sourceFile", sourceFile)
  }
  return fetchJson<SampleProcessingJobResponse>("/api/sample-processing/jobs", {
    method: "POST",
    body: formData,
  })
}

export async function fetchSampleProcessingJob(jobId: string) {
  return fetchJson<SampleProcessingJobResponse>(`/api/sample-processing/jobs/${encodeURIComponent(jobId)}`)
}

export function sampleProcessingResultUrl(jobId: string) {
  return `/api/sample-processing/jobs/${encodeURIComponent(jobId)}/result`
}

export function sampleProcessingSourceUrl(jobId: string) {
  return `/api/sample-processing/jobs/${encodeURIComponent(jobId)}/source`
}

export function sampleProcessingSpeakerResultUrl(jobId: string, speakerId: string) {
  return `/api/sample-processing/jobs/${encodeURIComponent(jobId)}/speakers/${encodeURIComponent(speakerId)}/result`
}

export async function updateSampleProcessingSpeakerAssignments(jobId: string, request: UpdateSpeakerAssignmentsRequest) {
  return fetchJson<SampleProcessingJobResponse>(
    `/api/sample-processing/jobs/${encodeURIComponent(jobId)}/speaker-assignments`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  )
}

export async function saveProcessedVoice(jobId: string, request: SaveProcessedVoiceRequest) {
  return fetchJson<{ voice: VoiceAsset }>(`/api/sample-processing/jobs/${encodeURIComponent(jobId)}/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
}

export async function saveSpeakerVoices(jobId: string, request: SaveSpeakerVoicesRequest) {
  return fetchJson<{ voices: VoiceAsset[] }>(
    `/api/sample-processing/jobs/${encodeURIComponent(jobId)}/speaker-voices`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  )
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
