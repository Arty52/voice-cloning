import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/lib/api"
import { DEFAULT_VOICE_PRESET_ID } from "@/lib/voice-presets"
import type {
  AsyncStatus,
  SampleProcessingJob,
  SampleProcessingOperationId,
  SampleProcessingOptionsResponse,
  SampleProcessingPresetId,
  SampleProcessingSourcePreference,
  SpeakerSeparationResult,
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
const TIMER_INTERVAL_MS = 100
const DEFAULT_PROCESSING_PRESET_ID: SampleProcessingPresetId = "balanced"

export function useSampleProcessing({ onVoiceSaved, selectedVoice, voices }: UseSampleProcessingOptions) {
  const [options, setOptions] = useState<SampleProcessingOptionsResponse | null>(null)
  const [optionsStatus, setOptionsStatus] = useState<AsyncStatus>("idle")
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [operationId, setOperationId] = useState<SampleProcessingOperationId>("isolateVoice")
  const [processingPresetId, setProcessingPresetId] = useState<SampleProcessingPresetId>(DEFAULT_PROCESSING_PRESET_ID)
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
  const [selectedTranscriptItemIds, setSelectedTranscriptItemIds] = useState<string[]>([])
  const [speakerNameAssignments, setSpeakerNameAssignments] = useState<Record<string, string>>({})
  const [speakerVoicePresetIds, setSpeakerVoicePresetIds] = useState<Record<string, VoicePresetId>>({})
  const [selectedSpeakerIds, setSelectedSpeakerIds] = useState<string[]>([])
  const [assignmentStatus, setAssignmentStatus] = useState<AsyncStatus>("idle")
  const [assignmentError, setAssignmentError] = useState<string | null>(null)
  const [speakerSaveStatus, setSpeakerSaveStatus] = useState<AsyncStatus>("idle")
  const [speakerSaveError, setSpeakerSaveError] = useState<string | null>(null)
  const [processingElapsedMs, setProcessingElapsedMs] = useState<number | null>(null)
  const runIdRef = useRef(0)
  const mountedRef = useRef(true)
  const processingStartedAtRef = useRef<number | null>(null)
  const activeJobIdRef = useRef<string | null>(null)
  const speakerStateJobIdRef = useRef<string | null>(null)
  const assignmentRequestIdRef = useRef(0)
  const speakerSaveRequestIdRef = useRef(0)

  const operations = useMemo(() => options?.operations ?? [], [options])
  const enabledOperations = useMemo(() => operations.filter((operation) => operation.enabled), [operations])
  const selectedOperation = operations.find((operation) => operation.id === operationId) ?? null
  const processingPresets = selectedOperation?.enabled === true ? selectedOperation.processingPresets : []
  const resolvedProcessingPresetId = resolveProcessingPresetId(processingPresetId, selectedOperation)
  const selectedProcessingPreset =
    processingPresets.find((preset) => preset.id === resolvedProcessingPresetId) ?? null
  const resolvedSourceVoiceId = voices.some((voice) => voice.id === sourceVoiceId)
    ? sourceVoiceId
    : selectedVoice?.id ?? voices[0]?.id ?? ""
  const selectedSourceVoice = voices.find((voice) => voice.id === resolvedSourceVoiceId) ?? null
  const voiceOptions = useMemo(() => voices.map((voice) => ({ label: voice.name, value: voice.id })), [voices])
  const isProcessing = status === "starting" || status === "processing"
  const hasSource = sourceMode === "upload" ? sourceFile !== null : resolvedSourceVoiceId.trim().length > 0
  const canStart = !isProcessing && selectedOperation?.enabled === true && hasSource
  const speakerSeparationResult =
    job?.status === "success" && isSpeakerSeparationResult(job.result) ? job.result : null
  const isSpeakerSeparationJob = speakerSeparationResult !== null
  const canSave =
    job?.status === "success" &&
    !isSpeakerSeparationJob &&
    saveName.trim().length > 0 &&
    saveStatus !== "loading" &&
    saveStatus !== "success"
  const canSaveSelectedSpeakers =
    job?.status === "success" &&
    isSpeakerSeparationJob &&
    selectedSpeakerIds.length > 0 &&
    selectedSpeakerIds.every((speakerId) => (speakerNameAssignments[speakerId] ?? "").trim().length > 0) &&
    speakerSaveStatus !== "loading" &&
    speakerSaveStatus !== "success"
  const resultUrl =
    job?.status === "success" && job.result !== null && !isSpeakerSeparationResult(job.result)
      ? api.sampleProcessingResultUrl(job.id)
      : null
  const speakerSourceUrl = job?.status === "success" && isSpeakerSeparationJob ? api.sampleProcessingSourceUrl(job.id) : null
  const speakerResultUrls = useMemo(() => {
    if (job?.status !== "success" || speakerSeparationResult === null) {
      return {}
    }
    return Object.fromEntries(
      speakerSeparationResult.speakers.map((speaker) => [
        speaker.id,
        api.sampleProcessingSpeakerResultUrl(job.id, speaker.id),
      ])
    ) as Record<string, string>
  }, [job?.id, job?.status, speakerSeparationResult])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runIdRef.current += 1
      processingStartedAtRef.current = null
    }
  }, [])

  useEffect(() => {
    const result = job?.status === "success" && isSpeakerSeparationResult(job.result) ? job.result : null
    if (!job || result === null) {
      if (speakerStateJobIdRef.current !== null) {
        speakerStateJobIdRef.current = null
        setSelectedTranscriptItemIds([])
        setSpeakerNameAssignments({})
        setSpeakerVoicePresetIds({})
        setSelectedSpeakerIds([])
        setAssignmentStatus("idle")
        setAssignmentError(null)
        setSpeakerSaveStatus("idle")
        setSpeakerSaveError(null)
      }
      return
    }
    if (speakerStateJobIdRef.current === job.id) {
      return
    }
    speakerStateJobIdRef.current = job.id
    setSelectedTranscriptItemIds([])
    setSpeakerNameAssignments(
      Object.fromEntries(
        result.speakers.map((speaker) => [speaker.id, speaker.assignedName ?? speaker.label])
      )
    )
    setSpeakerVoicePresetIds(
      Object.fromEntries(
        result.speakers.map((speaker) => [speaker.id, selectedSourceVoice?.voicePresetId ?? DEFAULT_VOICE_PRESET_ID])
      ) as Record<string, VoicePresetId>
    )
    setSelectedSpeakerIds(result.speakers.map((speaker) => speaker.id))
    setAssignmentStatus("idle")
    setAssignmentError(null)
    setSpeakerSaveStatus("idle")
    setSpeakerSaveError(null)
  }, [job, selectedSourceVoice?.voicePresetId])

  useEffect(() => {
    if (!isProcessing || processingStartedAtRef.current === null) {
      return
    }
    const intervalId = window.setInterval(() => {
      updateProcessingElapsedTime()
    }, TIMER_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [isProcessing])

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
          setProcessingPresetId((current) => resolveProcessingPresetId(current, nextOperation))
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
    clearProcessingTimer()
    updateJob(null)
    setError(null)
    setSaveError(null)
    setSaveStatus("idle")
    clearSpeakerSeparationState()
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
    handleSourceFileSelect(event.currentTarget.files?.[0] ?? null)
  }

  function handleSourceFileSelect(nextFile: File | null) {
    setSourceFile(nextFile)
    resetProcessedCandidate()
  }

  function handleOperationChange(nextOperationId: SampleProcessingOperationId) {
    if (nextOperationId === operationId) {
      return
    }
    setOperationId(nextOperationId)
    setProcessingPresetId(resolveProcessingPresetId(undefined, operations.find((operation) => operation.id === nextOperationId)))
    resetProcessedCandidate()
  }

  function handleProcessingPresetChange(nextPresetId: SampleProcessingPresetId) {
    if (nextPresetId === resolvedProcessingPresetId) {
      return
    }
    setProcessingPresetId(nextPresetId)
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
    startProcessingTimer()
    setStatus("starting")
    setError(null)
    setSaveError(null)
    setSaveStatus("idle")
    updateJob(null)
    clearSpeakerSeparationState()
    setSaveName(suggestedSaveName(sourceMode, selectedSourceVoice, sourceFile, selectedOperation))
    setSaveVoicePresetId(selectedSourceVoice?.voicePresetId ?? DEFAULT_VOICE_PRESET_ID)

    try {
      const payload = await api.createSampleProcessingJob({
        operationId,
        processingPresetId: processingPresets.length > 0 ? resolvedProcessingPresetId : null,
        sourceFile: sourceMode === "upload" ? sourceFile : null,
        sourcePreference: sourceMode === "voice" ? sourcePreference : undefined,
        sourceVoiceId: sourceMode === "voice" ? resolvedSourceVoiceId : null,
      })
      if (!isActiveRun(runId)) {
        return
      }
      updateJob(payload.job)
      if (payload.job.status === "success") {
        finishProcessingTimer()
        setStatus("success")
        return
      }
      if (payload.job.status === "error") {
        finishProcessingTimer()
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
      finishProcessingTimer()
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
        updateJob(payload.job)
        if (payload.job.status === "success") {
          finishProcessingTimer()
          setStatus("success")
          return
        }
        if (payload.job.status === "error") {
          finishProcessingTimer()
          setStatus("error")
          setError(payload.job.error || "Sample processing failed.")
          return
        }
      } catch (caught) {
        if (!isActiveRun(runId)) {
          return
        }
        finishProcessingTimer()
        setStatus("error")
        setError(caught instanceof Error ? caught.message : "Unable to poll sample processing job.")
        return
      }
      await delay(POLL_INTERVAL_MS)
    }
  }

  async function handleSaveProcessedVoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!job || job.status !== "success" || isSpeakerSeparationResult(job.result)) {
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

  function handleTranscriptSelectionChange(itemIds: string[]) {
    setSelectedTranscriptItemIds(uniqueIds(itemIds))
  }

  function handleSpeakerNameChange(speakerId: string, name: string) {
    setSpeakerNameAssignments((current) => ({ ...current, [speakerId]: name }))
  }

  function handleSpeakerVoicePresetChange(speakerId: string, voicePresetId: VoicePresetId) {
    setSpeakerVoicePresetIds((current) => ({ ...current, [speakerId]: voicePresetId }))
  }

  function handleSpeakerSaveSelectionChange(speakerId: string, selected: boolean) {
    setSelectedSpeakerIds((current) => {
      const currentIds = new Set(current)
      if (selected) {
        currentIds.add(speakerId)
      } else {
        currentIds.delete(speakerId)
      }
      return Array.from(currentIds)
    })
  }

  async function patchSpeakerAssignments(request: api.UpdateSpeakerAssignmentsRequest) {
    if (!job || job.status !== "success" || !isSpeakerSeparationResult(job.result)) {
      return
    }
    const activeJobId = job.id
    const activeRunId = runIdRef.current
    const assignmentRequestId = assignmentRequestIdRef.current + 1
    assignmentRequestIdRef.current = assignmentRequestId
    setAssignmentStatus("loading")
    setAssignmentError(null)
    try {
      const payload = await api.updateSampleProcessingSpeakerAssignments(activeJobId, request)
      if (!isActiveAssignmentPatch(activeJobId, activeRunId, assignmentRequestId)) {
        return
      }
      updateJob(payload.job)
      setAssignmentStatus("success")
    } catch (caught) {
      if (!isActiveAssignmentPatch(activeJobId, activeRunId, assignmentRequestId)) {
        return
      }
      setAssignmentStatus("error")
      setAssignmentError(caught instanceof Error ? caught.message : "Unable to update speaker assignments.")
    }
  }

  async function assignSpeakerName(speakerId: string, name: string) {
    handleSpeakerNameChange(speakerId, name)
    await patchSpeakerAssignments({ speakerNames: [{ speakerId, name }] })
  }

  async function assignTranscriptItemsToSpeaker(itemIds: string[], speakerId: string) {
    const uniqueItemIds = uniqueIds(itemIds)
    if (uniqueItemIds.length === 0) {
      return
    }
    setSelectedTranscriptItemIds(uniqueItemIds)
    await patchSpeakerAssignments({
      transcriptAssignments: uniqueItemIds.map((itemId) => ({ itemId, speakerId })),
    })
  }

  async function assignSelectedTranscriptItemsToSpeaker(speakerId: string) {
    await assignTranscriptItemsToSpeaker(selectedTranscriptItemIds, speakerId)
  }

  async function handleSaveSpeakerVoices(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!job || job.status !== "success" || !isSpeakerSeparationResult(job.result)) {
      return
    }
    const activeJobId = job.id
    const activeRunId = runIdRef.current
    if (selectedSpeakerIds.length === 0) {
      setSpeakerSaveStatus("error")
      setSpeakerSaveError("Choose at least one speaker.")
      return
    }
    const voicesToSave = selectedSpeakerIds.map((speakerId) => ({
      speakerId,
      name: (speakerNameAssignments[speakerId] ?? "").trim(),
      voicePresetId: speakerVoicePresetIds[speakerId] ?? DEFAULT_VOICE_PRESET_ID,
    }))
    if (voicesToSave.some((voice) => !voice.name)) {
      setSpeakerSaveStatus("error")
      setSpeakerSaveError("Voice name is required.")
      return
    }

    const speakerSaveRequestId = speakerSaveRequestIdRef.current + 1
    speakerSaveRequestIdRef.current = speakerSaveRequestId
    setSpeakerSaveStatus("loading")
    setSpeakerSaveError(null)
    try {
      const payload = await api.saveSpeakerVoices(activeJobId, { voices: voicesToSave })
      if (!isActiveSpeakerSave(activeJobId, activeRunId, speakerSaveRequestId)) {
        return
      }
      payload.voices.forEach((voice) => onVoiceSaved(voice))
      setSpeakerSaveStatus("success")
    } catch (caught) {
      if (!isActiveSpeakerSave(activeJobId, activeRunId, speakerSaveRequestId)) {
        return
      }
      setSpeakerSaveStatus("error")
      setSpeakerSaveError(caught instanceof Error ? caught.message : "Unable to add speaker voices.")
    }
  }

  function clearSpeakerSeparationState() {
    assignmentRequestIdRef.current += 1
    speakerSaveRequestIdRef.current += 1
    speakerStateJobIdRef.current = null
    setSelectedTranscriptItemIds([])
    setSpeakerNameAssignments({})
    setSpeakerVoicePresetIds({})
    setSelectedSpeakerIds([])
    setAssignmentStatus("idle")
    setAssignmentError(null)
    setSpeakerSaveStatus("idle")
    setSpeakerSaveError(null)
  }

  function isActiveRun(runId: number) {
    return mountedRef.current && runIdRef.current === runId
  }

  function isActiveAssignmentPatch(jobId: string, runId: number, requestId: number) {
    return (
      mountedRef.current &&
      runIdRef.current === runId &&
      activeJobIdRef.current === jobId &&
      assignmentRequestIdRef.current === requestId
    )
  }

  function isActiveSpeakerSave(jobId: string, runId: number, requestId: number) {
    return (
      mountedRef.current &&
      runIdRef.current === runId &&
      activeJobIdRef.current === jobId &&
      speakerSaveRequestIdRef.current === requestId
    )
  }

  function updateJob(nextJob: SampleProcessingJob | null) {
    activeJobIdRef.current = nextJob?.id ?? null
    setJob(nextJob)
  }

  function startProcessingTimer() {
    processingStartedAtRef.current = performance.now()
    setProcessingElapsedMs(0)
  }

  function updateProcessingElapsedTime() {
    const startedAt = processingStartedAtRef.current
    if (startedAt === null) {
      return
    }
    setProcessingElapsedMs(Math.max(0, Math.round(performance.now() - startedAt)))
  }

  function finishProcessingTimer() {
    updateProcessingElapsedTime()
    processingStartedAtRef.current = null
  }

  function clearProcessingTimer() {
    processingStartedAtRef.current = null
    setProcessingElapsedMs(null)
  }

  return {
    canSave,
    canSaveSelectedSpeakers,
    canStart,
    assignmentError,
    assignmentStatus,
    assignSelectedTranscriptItemsToSpeaker,
    assignSpeakerName,
    assignTranscriptItemsToSpeaker,
    enabledOperations,
    error,
    handleSaveProcessedVoice,
    handleSaveSpeakerVoices,
    handleSpeakerNameChange,
    handleSpeakerSaveSelectionChange,
    handleSpeakerVoicePresetChange,
    handleSourceFileChange,
    handleSourceFileSelect,
    handleSourceModeChange,
    handleStartProcessing,
    handleTranscriptSelectionChange,
    isProcessing,
    isSpeakerSeparationJob,
    job,
    operationId,
    operations,
    options,
    optionsError,
    optionsStatus,
    processingPresetId: resolvedProcessingPresetId,
    processingPresets,
    processingElapsedMs,
    resultUrl,
    saveError,
    saveName,
    saveStatus,
    saveVoicePresetId,
    selectedOperation,
    selectedProcessingPreset,
    selectedSpeakerIds,
    selectedSourceVoice,
    selectedTranscriptItemIds,
    setOperationId: handleOperationChange,
    setProcessingPresetId: handleProcessingPresetChange,
    setSaveName,
    setSaveVoicePresetId,
    setSelectedSpeakerIds,
    setSourcePreference: handleSourcePreferenceChange,
    setSourceVoiceId: handleSourceVoiceChange,
    speakerNameAssignments,
    speakerResultUrls,
    speakerSaveError,
    speakerSaveStatus,
    speakerSeparationResult,
    speakerSourceUrl,
    speakerVoicePresetIds,
    sourceFile,
    sourceMode,
    sourcePreference,
    sourceVoiceId: resolvedSourceVoiceId,
    status,
    voiceOptions,
  }
}

export type SampleProcessingController = ReturnType<typeof useSampleProcessing>

function resolveProcessingPresetId(
  current: SampleProcessingPresetId | undefined,
  operation: SampleProcessingOptionsResponse["operations"][number] | null | undefined
) {
  const presets = operation?.processingPresets ?? []
  if (presets.some((preset) => preset.id === current)) {
    return current ?? DEFAULT_PROCESSING_PRESET_ID
  }
  return operation?.defaultProcessingPresetId ?? presets[0]?.id ?? DEFAULT_PROCESSING_PRESET_ID
}

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

function isSpeakerSeparationResult(result: SampleProcessingJob["result"]): result is SpeakerSeparationResult {
  return Boolean(result && "kind" in result && result.kind === "speakerSeparation")
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)))
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
