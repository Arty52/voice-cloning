import type {
  ModelOption,
  ModelsResponse,
  ProvidersResponse,
  SampleProcessingJobResponse,
  SampleProcessingMediaSourceResponse,
  SampleProcessingOperationId,
  SampleProcessingOptionsResponse,
  SampleProcessingPresetId,
  SampleProcessingSourceRange,
  SampleProcessingSourcePreference,
  SpeechJobResponse,
  SpeechSegmentAssignmentKind,
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
  providerId?: string
  voicePresetId?: VoicePresetId
  voiceSettings?: VoiceTuningValues
}

export type CreateSampleProcessingJobRequest = {
  cleanVoice?: boolean | null
  detectSpeakers?: boolean | null
  isolationPresetId?: SampleProcessingPresetId | null
  operationId?: SampleProcessingOperationId
  processingPresetId?: SampleProcessingPresetId | null
  sourceFile?: File | null
  sourceMediaId?: string | null
  sourcePreference?: SampleProcessingSourcePreference
  sourceRanges?: SampleProcessingSourceRangeRequest[] | null
  sourceVoiceId?: string | null
  trimCandidates?: boolean | null
  trimPresetId?: SampleProcessingPresetId | null
  workflowSteps?: SampleProcessingWorkflowStepRequest[]
}

export type SampleProcessingWorkflowStepRequest = {
  operationId: SampleProcessingOperationId
  processingPresetId?: SampleProcessingPresetId | null
}

export type SampleProcessingSourceRangeRequest = Pick<SampleProcessingSourceRange, "startSeconds" | "endSeconds"> & {
  label?: string | null
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

export type SavePreparedCandidateVoiceRequest = {
  candidateId: string
  name: string
  voicePresetId?: VoicePresetId
}

export type SavePreparedCandidateVoicesRequest = {
  voices: SavePreparedCandidateVoiceRequest[]
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

export type CreateSpeechJobSegmentRequest = {
  assignmentKind: SpeechSegmentAssignmentKind
  clientSegmentId: string
  text: string
  voiceId: string
  voiceSettings?: VoiceTuningValues | null
}

export type CreateSpeechJobRequest = {
  defaultVoiceId: string
  modelId: string | null
  providerId: string | null
  providerKey: string | null
  segmentGapMs?: number | null
  segments: CreateSpeechJobSegmentRequest[]
  signal?: AbortSignal
  text: string
  tuning: VoiceTuningValues
}

export type RegenerateSpeechJobSegmentRequest = {
  providerKey: string | null
  voiceId?: string | null
  voiceSettings?: VoiceTuningValues | null
}

export type RegenerateSpeechJobVoiceRequest = {
  providerKey: string | null
  voiceSettings: VoiceTuningValues
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

export async function uploadSampleProcessingSource(sourceFile: File) {
  const formData = new FormData()
  formData.append("sourceFile", sourceFile)
  return fetchJson<SampleProcessingMediaSourceResponse>("/api/sample-processing/sources", {
    method: "POST",
    body: formData,
  })
}

export async function fetchSampleProcessingSource(sourceId: string) {
  return fetchJson<SampleProcessingMediaSourceResponse>(
    `/api/sample-processing/sources/${encodeURIComponent(sourceId)}`
  )
}

export async function deleteSampleProcessingSource(sourceId: string) {
  const response = await fetch(`/api/sample-processing/sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
}

export function sampleProcessingSourcePreviewUrl(sourceId: string, startSeconds: number, durationSeconds: number) {
  const params = new URLSearchParams({
    startSeconds: formatSecondsParam(startSeconds),
    durationSeconds: formatSecondsParam(durationSeconds),
  })
  return `/api/sample-processing/sources/${encodeURIComponent(sourceId)}/preview?${params.toString()}`
}

export function sampleProcessingSourceMediaUrl(sourceId: string) {
  return `/api/sample-processing/sources/${encodeURIComponent(sourceId)}/media`
}

export async function createSampleProcessingJob({
  cleanVoice,
  detectSpeakers,
  isolationPresetId,
  operationId,
  processingPresetId,
  sourceFile,
  sourceMediaId,
  sourcePreference,
  sourceRanges,
  sourceVoiceId,
  trimCandidates,
  trimPresetId,
  workflowSteps,
}: CreateSampleProcessingJobRequest) {
  const hasWorkflowSteps = Boolean(workflowSteps?.length)
  if (!operationId && !hasWorkflowSteps) {
    throw new Error("Sample processing requires operationId or workflowSteps.")
  }
  if (operationId && hasWorkflowSteps) {
    throw new Error("Provide either operationId or workflowSteps, not both.")
  }

  const formData = new FormData()
  if (hasWorkflowSteps) {
    formData.append("workflowSteps", JSON.stringify(workflowSteps))
  } else {
    const singleOperationId = operationId
    if (!singleOperationId) {
      throw new Error("Sample processing requires operationId or workflowSteps.")
    }
    formData.append("operationId", singleOperationId)
  }
  if (processingPresetId) {
    formData.append("processingPresetId", processingPresetId)
  }
  if (isolationPresetId) {
    formData.append("isolationPresetId", isolationPresetId)
  }
  if (trimPresetId) {
    formData.append("trimPresetId", trimPresetId)
  }
  if (cleanVoice !== undefined && cleanVoice !== null) {
    formData.append("cleanVoice", String(cleanVoice))
  }
  if (detectSpeakers !== undefined && detectSpeakers !== null) {
    formData.append("detectSpeakers", String(detectSpeakers))
  }
  if (trimCandidates !== undefined && trimCandidates !== null) {
    formData.append("trimCandidates", String(trimCandidates))
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
  if (sourceMediaId) {
    formData.append("sourceMediaId", sourceMediaId)
  }
  if (sourceRanges?.length) {
    formData.append("sourceRanges", JSON.stringify(sourceRanges))
  }
  return fetchJson<SampleProcessingJobResponse>("/api/sample-processing/jobs", {
    method: "POST",
    body: formData,
  })
}

export async function fetchSampleProcessingJob(jobId: string) {
  return fetchJson<SampleProcessingJobResponse>(`/api/sample-processing/jobs/${encodeURIComponent(jobId)}`)
}

export async function cancelSampleProcessingJob(jobId: string) {
  return fetchJson<SampleProcessingJobResponse>(`/api/sample-processing/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  })
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

export function sampleProcessingCandidateResultUrl(jobId: string, candidateId: string) {
  return `/api/sample-processing/jobs/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(candidateId)}/result`
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

export async function savePreparedCandidateVoices(jobId: string, request: SavePreparedCandidateVoicesRequest) {
  return fetchJson<{ voices: VoiceAsset[] }>(
    `/api/sample-processing/jobs/${encodeURIComponent(jobId)}/candidate-voices`,
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

export async function createSpeechJob({
  defaultVoiceId,
  modelId,
  providerId,
  providerKey,
  segmentGapMs,
  segments,
  signal,
  text,
  tuning,
}: CreateSpeechJobRequest) {
  const body: {
    defaultVoiceId: string
    modelId: string | null
    providerId: string | null
    segmentGapMs?: number
    segments: CreateSpeechJobSegmentRequest[]
    text: string
    voiceSettings: VoiceTuningValues
  } = {
    defaultVoiceId,
    modelId,
    providerId,
    segments,
    text,
    voiceSettings: tuning,
  }
  if (segmentGapMs !== undefined && segmentGapMs !== null) {
    body.segmentGapMs = segmentGapMs
  }

  return fetchJson<SpeechJobResponse>("/api/speech/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...providerHeaders({ providerKey }),
    },
    body: JSON.stringify(body),
    signal,
  })
}

export async function fetchSpeechJob(jobId: string) {
  return fetchJson<SpeechJobResponse>(`/api/speech/jobs/${encodeURIComponent(jobId)}`)
}

export async function cancelSpeechJob(jobId: string) {
  return fetchJson<SpeechJobResponse>(`/api/speech/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  })
}

export function speechJobResultUrl(jobId: string) {
  return `/api/speech/jobs/${encodeURIComponent(jobId)}/result`
}

export function speechJobSegmentResultUrl(jobId: string, segmentId: string) {
  return `/api/speech/jobs/${encodeURIComponent(jobId)}/segments/${encodeURIComponent(segmentId)}/result`
}

export async function regenerateSpeechJobSegment(
  jobId: string,
  segmentId: string,
  { providerKey, voiceId, voiceSettings }: RegenerateSpeechJobSegmentRequest
) {
  return fetchJson<SpeechJobResponse>(
    `/api/speech/jobs/${encodeURIComponent(jobId)}/segments/${encodeURIComponent(segmentId)}/regenerate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...providerHeaders({ providerKey }),
      },
      body: JSON.stringify({ voiceId: voiceId ?? null, voiceSettings: voiceSettings ?? null }),
    }
  )
}

export async function regenerateSpeechJobVoice(
  jobId: string,
  voiceId: string,
  { providerKey, voiceSettings }: RegenerateSpeechJobVoiceRequest
) {
  return fetchJson<SpeechJobResponse>(
    `/api/speech/jobs/${encodeURIComponent(jobId)}/voices/${encodeURIComponent(voiceId)}/regenerate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...providerHeaders({ providerKey }),
      },
      body: JSON.stringify({ voiceSettings }),
    }
  )
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

function formatSecondsParam(value: number) {
  return Number.isFinite(value) ? String(Math.max(0, value)) : "0"
}
