import { useEffect, useMemo, useRef, useState } from "react"

import { BACKEND_DEFAULT_MODEL_LABEL, CANCELED_GENERATION_MESSAGE } from "@/constants"
import * as api from "@/lib/api"
import {
  buildGeneratedAudioMultiVoiceMetadata,
  buildGeneratedAudioTuningMetadata,
} from "@/lib/generated-audio-metadata"
import type { SaveGeneratedAudioInput } from "@/lib/generated-audio-storage"
import type { SpeechJobSegmentDraft } from "@/lib/voice-assignments"
import type {
  GeneratedResult,
  ModelOption,
  SpeechJob,
  VoiceAsset,
  VoiceProvider,
  VoiceTuningValues,
} from "@/types"

export type MultiVoiceGenerationStatus = "idle" | "starting" | "processing" | "success" | "error" | "canceled"

type GenerateMultiVoiceSpeechInput = {
  backendDefaultModelId: string | null
  canUseProvider: boolean
  defaultVoice: VoiceAsset | null
  models: ModelOption[]
  provider: VoiceProvider | null
  providerId: string | null
  providerKey: string | null
  segmentGapMs?: number | null
  segments: SpeechJobSegmentDraft[]
  selectedModelId: string
  selectedTuningPresetId: string
  storageLimitBytes: number
  text: string
  tuning: VoiceTuningValues
}

type RegenerateSegmentInput = {
  providerKey: string | null
  segmentId: string
  storageLimitBytes?: number
  voiceId?: string | null
  voiceSettings?: VoiceTuningValues | null
}

type PersistContext = {
  backendDefaultModelId: string | null
  defaultVoice: VoiceAsset
  modelId: string | null
  provider: VoiceProvider | null
  selectedTuningPresetId: string
  storageLimitBytes: number
  tuning: VoiceTuningValues
}

type UseMultiVoiceSpeechGenerationOptions = {
  persistGeneratedAudio: (input: SaveGeneratedAudioInput, limitBytes: number) => Promise<GeneratedResult>
}

const POLL_INTERVAL_MS = 1500
const TIMER_INTERVAL_MS = 100
const MULTI_VOICE_LABEL = "Multi-Voice"

export function useMultiVoiceSpeechGeneration({ persistGeneratedAudio }: UseMultiVoiceSpeechGenerationOptions) {
  const [job, setJob] = useState<SpeechJob | null>(null)
  const [status, setStatus] = useState<MultiVoiceGenerationStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [generationElapsedMs, setGenerationElapsedMs] = useState<number | null>(null)
  const runIdRef = useRef(0)
  const mountedRef = useRef(true)
  const activeJobIdRef = useRef<string | null>(null)
  const generationStartedAtRef = useRef<number | null>(null)
  const lastPersistContextRef = useRef<PersistContext | null>(null)

  const isGenerating = status === "starting" || status === "processing"
  const canCancel = isGenerating && job !== null
  const resultUrl = job?.status === "success" ? api.speechJobResultUrl(job.id) : null
  const segmentResultUrls = useMemo(() => {
    if (job?.status !== "success") {
      return {}
    }
    return Object.fromEntries(
      job.segments.map((segment) => [segment.id, api.speechJobSegmentResultUrl(job.id, segment.id)])
    ) as Record<string, string>
  }, [job])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runIdRef.current += 1
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

  async function generateSpeech(input: GenerateMultiVoiceSpeechInput) {
    if (input.text.trim().length === 0) {
      setStatus("error")
      setError("Enter text first.")
      return null
    }
    if (!input.defaultVoice) {
      setStatus("error")
      setError("Select a default voice first.")
      return null
    }
    if (input.segments.length === 0) {
      setStatus("error")
      setError("Assign at least one voice before multi-voice generation.")
      return null
    }
    if (!input.canUseProvider) {
      setStatus("error")
      setError("Add a provider API key before generating speech.")
      return null
    }

    const runId = startRun()
    const submittedModelId = api.hasModel(input.models, input.selectedModelId) ? input.selectedModelId : null
    const persistContext: PersistContext = {
      backendDefaultModelId: input.backendDefaultModelId,
      defaultVoice: input.defaultVoice,
      modelId: submittedModelId,
      provider: input.provider,
      selectedTuningPresetId: input.selectedTuningPresetId,
      storageLimitBytes: input.storageLimitBytes,
      tuning: input.tuning,
    }
    lastPersistContextRef.current = persistContext

    try {
      const payload = await api.createSpeechJob({
        defaultVoiceId: input.defaultVoice.id,
        modelId: submittedModelId,
        providerId: input.providerId,
        providerKey: input.providerKey,
        segmentGapMs: input.segmentGapMs,
        segments: input.segments.map((segment) => ({
          assignmentKind: segment.assignmentKind,
          clientSegmentId: segment.clientSegmentId,
          text: segment.text,
          voiceId: segment.voiceId,
          voiceSettings: segment.voiceSettings,
        })),
        text: input.text,
        tuning: input.tuning,
      })
      if (!isActiveRun(runId)) {
        return null
      }
      updateJob(payload.job)
      return await handleJobUpdate(payload.job, runId, persistContext)
    } catch (caught) {
      return failActiveRun(runId, caught, "Unable to start multi-voice generation.")
    }
  }

  async function regenerateSegment({
    providerKey,
    segmentId,
    storageLimitBytes,
    voiceId,
    voiceSettings,
  }: RegenerateSegmentInput) {
    const activeJob = job
    const persistContext = lastPersistContextRef.current
    if (!activeJob || activeJob.status !== "success") {
      setStatus("error")
      setError("Generate multi-voice speech before regenerating a segment.")
      return null
    }
    if (!persistContext) {
      setStatus("error")
      setError("Multi-voice generation context is unavailable.")
      return null
    }

    const runId = startRun({ clearJob: false })
    const nextPersistContext = {
      ...persistContext,
      storageLimitBytes: storageLimitBytes ?? persistContext.storageLimitBytes,
    }
    lastPersistContextRef.current = nextPersistContext

    try {
      const payload = await api.regenerateSpeechJobSegment(activeJob.id, segmentId, {
        providerKey,
        voiceId,
        voiceSettings,
      })
      if (!isActiveRun(runId)) {
        return null
      }
      updateJob(payload.job)
      return await handleJobUpdate(payload.job, runId, nextPersistContext)
    } catch (caught) {
      return failActiveRun(runId, caught, "Unable to regenerate speech segment.")
    }
  }

  async function handleJobUpdate(jobUpdate: SpeechJob, runId: number, persistContext: PersistContext) {
    if (jobUpdate.status === "success") {
      const elapsedMs = finishGenerationTimer()
      setStatus("success")
      setError(null)
      return persistSuccessfulJob(jobUpdate, persistContext, elapsedMs)
    }
    if (jobUpdate.status === "canceled") {
      finishGenerationTimer()
      setStatus("canceled")
      setError(CANCELED_GENERATION_MESSAGE)
      return null
    }
    if (jobUpdate.status === "error") {
      finishGenerationTimer()
      setStatus("error")
      setError(jobUpdate.error || "Multi-voice generation failed.")
      return null
    }
    setStatus("processing")
    return pollJob(jobUpdate.id, runId, persistContext)
  }

  async function pollJob(jobId: string, runId: number, persistContext: PersistContext): Promise<GeneratedResult | null> {
    while (isActiveRun(runId)) {
      try {
        const payload = await api.fetchSpeechJob(jobId)
        if (!isActiveRun(runId)) {
          return null
        }
        updateJob(payload.job)
        if (payload.job.status === "success") {
          const elapsedMs = finishGenerationTimer()
          setStatus("success")
          setError(null)
          return persistSuccessfulJob(payload.job, persistContext, elapsedMs)
        }
        if (payload.job.status === "canceled") {
          finishGenerationTimer()
          setStatus("canceled")
          setError(CANCELED_GENERATION_MESSAGE)
          return null
        }
        if (payload.job.status === "error") {
          finishGenerationTimer()
          setStatus("error")
          setError(payload.job.error || "Multi-voice generation failed.")
          return null
        }
        setStatus("processing")
      } catch (caught) {
        return failActiveRun(runId, caught, "Unable to poll multi-voice generation.")
      }
      await delay(POLL_INTERVAL_MS)
    }
    return null
  }

  async function cancelGeneration() {
    const activeJobId = activeJobIdRef.current
    const activeRunId = runIdRef.current
    if (!activeJobId || !isGenerating) {
      return
    }
    try {
      const payload = await api.cancelSpeechJob(activeJobId)
      if (!isActiveRun(activeRunId)) {
        return
      }
      runIdRef.current = activeRunId + 1
      updateJob(payload.job)
      const elapsedMs = finishGenerationTimer()
      if (payload.job.status === "success") {
        setStatus("success")
        setError(null)
        const persistContext = lastPersistContextRef.current
        return persistContext ? persistSuccessfulJob(payload.job, persistContext, elapsedMs) : null
      }
      if (payload.job.status === "error") {
        setStatus("error")
        setError(payload.job.error || "Multi-voice generation failed.")
        return
      }
      setStatus("canceled")
      setError(CANCELED_GENERATION_MESSAGE)
    } catch (caught) {
      if (!isActiveRun(activeRunId)) {
        return
      }
      setError(caught instanceof Error ? caught.message : "Unable to cancel multi-voice generation.")
    }
  }

  function resetGeneration() {
    runIdRef.current += 1
    updateJob(null)
    clearGenerationTimer()
    setStatus("idle")
    setError(null)
  }

  async function persistSuccessfulJob(jobUpdate: SpeechJob, persistContext: PersistContext, elapsedMs: number | null) {
    try {
      const response = await fetch(api.speechJobResultUrl(jobUpdate.id))
      if (!response.ok) {
        throw new Error(await response.text() || `Request failed with status ${response.status}.`)
      }
      const blob = await response.blob()
      const createdAt = new Date().toISOString()
      const input: SaveGeneratedAudioInput = {
        appVoiceId: persistContext.defaultVoice.id,
        blob,
        cacheState: "multi-voice",
        characterCount: sumCharacters(jobUpdate),
        contentType: blob.type || response.headers.get("Content-Type") || "audio/mpeg",
        createdAt,
        generationElapsedMs: elapsedMs,
        modelId: persistContext.modelId || persistContext.backendDefaultModelId || BACKEND_DEFAULT_MODEL_LABEL,
        multiVoiceMetadata: buildGeneratedAudioMultiVoiceMetadata(jobUpdate),
        requestId: null,
        tuningMetadata: buildGeneratedAudioTuningMetadata({
          provider: persistContext.provider,
          selectedPresetId: persistContext.selectedTuningPresetId,
          tuning: persistContext.tuning,
        }),
        voiceId: persistContext.defaultVoice.id,
        voiceName: MULTI_VOICE_LABEL,
      }
      return persistGeneratedAudio(input, persistContext.storageLimitBytes)
    } catch (caught) {
      setStatus("error")
      setError(caught instanceof Error ? caught.message : "Unable to save multi-voice generated audio.")
      return null
    }
  }

  function startRun({ clearJob = true }: { clearJob?: boolean } = {}) {
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setStatus("starting")
    setError(null)
    if (clearJob) {
      updateJob(null)
    }
    startGenerationTimer()
    return runId
  }

  function failActiveRun(runId: number, caught: unknown, fallback: string) {
    if (!isActiveRun(runId)) {
      return null
    }
    finishGenerationTimer()
    setStatus("error")
    setError(caught instanceof Error ? caught.message : fallback)
    return null
  }

  function isActiveRun(runId: number) {
    return mountedRef.current && runIdRef.current === runId
  }

  function updateJob(nextJob: SpeechJob | null) {
    activeJobIdRef.current = nextJob?.id ?? null
    setJob(nextJob)
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

  function clearGenerationTimer() {
    generationStartedAtRef.current = null
    setGenerationElapsedMs(null)
  }

  return {
    canCancel,
    cancelGeneration,
    error,
    generateSpeech,
    generationElapsedMs,
    isGenerating,
    job,
    regenerateSegment,
    resetGeneration,
    resultUrl,
    segmentResultUrls,
    status,
  }
}

function sumCharacters(job: SpeechJob) {
  return job.segments.reduce((total, segment) => total + (segment.characterCount ?? segment.text.length), 0)
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
