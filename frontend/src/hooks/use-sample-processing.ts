import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/lib/api"
import { DEFAULT_VOICE_PRESET_ID } from "@/lib/voice-presets"
import type {
  AsyncStatus,
  SampleProcessingJob,
  SampleProcessingOperationId,
  SampleProcessingOptionsResponse,
  SampleProcessingSourcePreference,
  VoiceAsset,
  VoicePresetId,
} from "@/types"

export type SampleProcessingSourceMode = "voice" | "upload"
export type SampleProcessingStatus = "idle" | "starting" | "processing" | "success" | "error"

type UseSampleProcessingOptions = {
  onVoiceSaved: (voice: VoiceAsset) => void
  selectedVoice: VoiceAsset | null
  voices: VoiceAsset[]
}

const POLL_INTERVAL_MS = 1500

export function useSampleProcessing({ onVoiceSaved, selectedVoice, voices }: UseSampleProcessingOptions) {
  const [options, setOptions] = useState<SampleProcessingOptionsResponse | null>(null)
  const [optionsStatus, setOptionsStatus] = useState<AsyncStatus>("idle")
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [operationId, setOperationId] = useState<SampleProcessingOperationId>("isolateVoice")
  const [sourceMode, setSourceMode] = useState<SampleProcessingSourceMode>("voice")
  const [sourceVoiceId, setSourceVoiceId] = useState("")
  const [sourcePreference, setSourcePreference] = useState<SampleProcessingSourcePreference>("original")
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [job, setJob] = useState<SampleProcessingJob | null>(null)
  const [status, setStatus] = useState<SampleProcessingStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [saveName, setSaveName] = useState("")
  const [saveVoicePresetId, setSaveVoicePresetId] = useState<VoicePresetId>(DEFAULT_VOICE_PRESET_ID)
  const [saveStatus, setSaveStatus] = useState<AsyncStatus>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const runIdRef = useRef(0)
  const mountedRef = useRef(true)

  const operations = useMemo(() => options?.operations ?? [], [options])
  const enabledOperations = useMemo(() => operations.filter((operation) => operation.enabled), [operations])
  const selectedOperation = operations.find((operation) => operation.id === operationId) ?? null
  const resolvedSourceVoiceId = voices.some((voice) => voice.id === sourceVoiceId)
    ? sourceVoiceId
    : selectedVoice?.id ?? voices[0]?.id ?? ""
  const selectedSourceVoice = voices.find((voice) => voice.id === resolvedSourceVoiceId) ?? null
  const voiceOptions = useMemo(() => voices.map((voice) => ({ label: voice.name, value: voice.id })), [voices])
  const isProcessing = status === "starting" || status === "processing"
  const hasSource = sourceMode === "upload" ? sourceFile !== null : resolvedSourceVoiceId.trim().length > 0
  const canStart = !isProcessing && selectedOperation?.enabled === true && hasSource
  const canSave = job?.status === "success" && saveName.trim().length > 0 && saveStatus !== "loading" && saveStatus !== "success"
  const resultUrl = job?.status === "success" ? api.sampleProcessingResultUrl(job.id) : null

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    async function loadOptions() {
      setOptionsStatus("loading")
      setOptionsError(null)
      try {
        const payload = await api.fetchSampleProcessingOptions()
        if (!mountedRef.current) {
          return
        }
        setOptions(payload)
        setOptionsStatus("success")
        const nextOperation = payload.operations.find((operation) => operation.enabled) ?? payload.operations[0]
        if (nextOperation) {
          setOperationId((current) => {
            const currentOperation = payload.operations.find((operation) => operation.id === current)
            return currentOperation?.enabled ? current : nextOperation.id
          })
        }
      } catch (caught) {
        if (!mountedRef.current) {
          return
        }
        setOptionsStatus("error")
        setOptionsError(caught instanceof Error ? caught.message : "Unable to load sample processing options.")
      }
    }

    void loadOptions()
  }, [])

  function resetProcessedCandidate() {
    runIdRef.current += 1
    setJob(null)
    setError(null)
    setSaveError(null)
    setSaveStatus("idle")
    setStatus("idle")
  }

  function handleSourceModeChange(nextMode: SampleProcessingSourceMode) {
    if (nextMode === sourceMode) {
      return
    }
    setSourceMode(nextMode)
    resetProcessedCandidate()
  }

  function handleSourceFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSourceFile(event.currentTarget.files?.[0] ?? null)
    resetProcessedCandidate()
  }

  function handleOperationChange(nextOperationId: SampleProcessingOperationId) {
    if (nextOperationId === operationId) {
      return
    }
    setOperationId(nextOperationId)
    resetProcessedCandidate()
  }

  function handleSourcePreferenceChange(nextPreference: SampleProcessingSourcePreference) {
    if (nextPreference === sourcePreference) {
      return
    }
    setSourcePreference(nextPreference)
    resetProcessedCandidate()
  }

  function handleSourceVoiceChange(nextVoiceId: string) {
    if (nextVoiceId === resolvedSourceVoiceId) {
      return
    }
    setSourceVoiceId(nextVoiceId)
    resetProcessedCandidate()
  }

  async function handleStartProcessing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canStart) {
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setStatus("starting")
    setError(null)
    setSaveError(null)
    setSaveStatus("idle")
    setJob(null)
    setSaveName(suggestedSaveName(sourceMode, selectedSourceVoice, sourceFile, selectedOperation))
    setSaveVoicePresetId(selectedSourceVoice?.voicePresetId ?? DEFAULT_VOICE_PRESET_ID)

    try {
      const payload = await api.createSampleProcessingJob({
        operationId,
        sourceFile: sourceMode === "upload" ? sourceFile : null,
        sourcePreference: sourceMode === "voice" ? sourcePreference : undefined,
        sourceVoiceId: sourceMode === "voice" ? resolvedSourceVoiceId : null,
      })
      if (!isActiveRun(runId)) {
        return
      }
      setJob(payload.job)
      if (payload.job.status === "success") {
        setStatus("success")
        return
      }
      if (payload.job.status === "error") {
        setStatus("error")
        setError(payload.job.error || "Sample processing failed.")
        return
      }
      setStatus("processing")
      void pollJob(payload.job.id, runId)
    } catch (caught) {
      if (!isActiveRun(runId)) {
        return
      }
      setStatus("error")
      setError(caught instanceof Error ? caught.message : "Unable to start sample processing.")
    }
  }

  async function pollJob(jobId: string, runId: number) {
    while (isActiveRun(runId)) {
      try {
        const payload = await api.fetchSampleProcessingJob(jobId)
        if (!isActiveRun(runId)) {
          return
        }
        setJob(payload.job)
        if (payload.job.status === "success") {
          setStatus("success")
          return
        }
        if (payload.job.status === "error") {
          setStatus("error")
          setError(payload.job.error || "Sample processing failed.")
          return
        }
      } catch (caught) {
        if (!isActiveRun(runId)) {
          return
        }
        setStatus("error")
        setError(caught instanceof Error ? caught.message : "Unable to poll sample processing job.")
        return
      }
      await delay(POLL_INTERVAL_MS)
    }
  }

  async function handleSaveProcessedVoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!job || job.status !== "success") {
      return
    }
    const trimmedName = saveName.trim()
    if (!trimmedName) {
      setSaveError("Voice name is required.")
      return
    }

    setSaveStatus("loading")
    setSaveError(null)
    try {
      const payload = await api.saveProcessedVoice(job.id, {
        name: trimmedName,
        voicePresetId: saveVoicePresetId,
      })
      if (!mountedRef.current) {
        return
      }
      onVoiceSaved(payload.voice)
      setSaveStatus("success")
    } catch (caught) {
      if (!mountedRef.current) {
        return
      }
      setSaveStatus("error")
      setSaveError(caught instanceof Error ? caught.message : "Unable to add processed voice.")
    }
  }

  function isActiveRun(runId: number) {
    return mountedRef.current && runIdRef.current === runId
  }

  return {
    canSave,
    canStart,
    enabledOperations,
    error,
    handleSaveProcessedVoice,
    handleSourceFileChange,
    handleSourceModeChange,
    handleStartProcessing,
    isProcessing,
    job,
    operationId,
    operations,
    options,
    optionsError,
    optionsStatus,
    resultUrl,
    saveError,
    saveName,
    saveStatus,
    saveVoicePresetId,
    selectedOperation,
    selectedSourceVoice,
    setOperationId: handleOperationChange,
    setSaveName,
    setSaveVoicePresetId,
    setSourcePreference: handleSourcePreferenceChange,
    setSourceVoiceId: handleSourceVoiceChange,
    sourceFile,
    sourceMode,
    sourcePreference,
    sourceVoiceId: resolvedSourceVoiceId,
    status,
    voiceOptions,
  }
}

export type SampleProcessingController = ReturnType<typeof useSampleProcessing>

function suggestedSaveName(
  sourceMode: SampleProcessingSourceMode,
  sourceVoice: VoiceAsset | null,
  sourceFile: File | null,
  operation: SampleProcessingOptionsResponse["operations"][number] | null
) {
  const suffix = operationNameSuffix(operation)
  if (sourceMode === "voice") {
    return `${sourceVoice?.name || "Processed Voice"} ${suffix}`
  }
  return `${fileStem(sourceFile?.name) || "Uploaded Source"} ${suffix}`
}

function operationNameSuffix(operation: SampleProcessingOptionsResponse["operations"][number] | null) {
  if (operation?.id === "isolateVoice") {
    return "Isolated"
  }
  if (operation?.id === "trimSilence") {
    return "Trimmed"
  }
  if (operation?.id === "separateSpeakers") {
    return "Separated"
  }
  return operation?.label ?? "Processed"
}

function fileStem(filename: string | undefined) {
  if (!filename) {
    return ""
  }
  return filename.replace(/\.[^/.]+$/, "").trim()
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
