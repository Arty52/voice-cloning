import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react"

import * as api from "@/lib/api"
import { DEFAULT_VOICE_PRESET_ID } from "@/lib/voice-presets"
import type {
  AsyncStatus,
  SampleProcessingJob,
  SpeakerSeparationResult,
  VoiceAsset,
  VoicePresetId,
} from "@/types"

type UseSpeakerTranscriptOptions = {
  defaultVoicePresetId?: VoicePresetId
  job: SampleProcessingJob | null
  onJobUpdate: (job: SampleProcessingJob) => void
  onVoiceSaved: (voice: VoiceAsset) => void
}

export function useSpeakerTranscript({
  defaultVoicePresetId = DEFAULT_VOICE_PRESET_ID,
  job,
  onJobUpdate,
  onVoiceSaved,
}: UseSpeakerTranscriptOptions) {
  const [selectedTranscriptItemIds, setSelectedTranscriptItemIds] = useState<string[]>([])
  const [speakerNameAssignments, setSpeakerNameAssignments] = useState<Record<string, string>>({})
  const [speakerVoicePresetIds, setSpeakerVoicePresetIds] = useState<Record<string, VoicePresetId>>({})
  const [selectedSpeakerIds, setSelectedSpeakerIds] = useState<string[]>([])
  const [transcriptTextDrafts, setTranscriptTextDrafts] = useState<Record<string, string>>({})
  const [savedTranscriptTexts, setSavedTranscriptTexts] = useState<Record<string, string>>({})
  const [assignmentStatus, setAssignmentStatus] = useState<AsyncStatus>("idle")
  const [assignmentError, setAssignmentError] = useState<string | null>(null)
  const [transcriptSaveStatus, setTranscriptSaveStatus] = useState<AsyncStatus>("idle")
  const [transcriptSaveError, setTranscriptSaveError] = useState<string | null>(null)
  const [speakerSaveStatus, setSpeakerSaveStatus] = useState<AsyncStatus>("idle")
  const [speakerSaveError, setSpeakerSaveError] = useState<string | null>(null)
  const transcriptSelectionSurfaceId = useId()
  const mountedRef = useRef(true)
  const activeJobIdRef = useRef<string | null>(job?.id ?? null)
  const stateJobIdRef = useRef<string | null>(null)
  const assignmentRequestIdRef = useRef(0)
  const transcriptSaveRequestIdRef = useRef(0)
  const transcriptSaveInFlightRef = useRef(false)
  const speakerSaveRequestIdRef = useRef(0)

  const transcriptResult =
    job?.status === "success" && isTranscriptResult(job.result) ? job.result : null
  const isTranscriptJob = transcriptResult !== null
  const unsavedTranscriptItemIds = useMemo(() => {
    if (!transcriptResult) {
      return []
    }
    return transcriptResult.transcript.items
      .filter((item) => (transcriptTextDrafts[item.id] ?? item.text) !== (savedTranscriptTexts[item.id] ?? item.text))
      .map((item) => item.id)
  }, [savedTranscriptTexts, transcriptResult, transcriptTextDrafts])
  const hasUnsavedTranscriptChanges = unsavedTranscriptItemIds.length > 0
  const canSaveTranscript =
    hasUnsavedTranscriptChanges &&
    unsavedTranscriptItemIds.every((itemId) => (transcriptTextDrafts[itemId] ?? "").trim().length > 0) &&
    transcriptSaveStatus !== "loading"
  const canSaveSelectedSpeakers =
    job?.status === "success" &&
    isTranscriptJob &&
    selectedSpeakerIds.length > 0 &&
    selectedSpeakerIds.every((speakerId) => (speakerNameAssignments[speakerId] ?? "").trim().length > 0) &&
    speakerSaveStatus !== "loading" &&
    speakerSaveStatus !== "success"
  const speakerSourceUrl =
    job?.status === "success" && isTranscriptJob ? api.sampleProcessingSourceUrl(job.id) : null
  const speakerResultUrls =
    job?.status === "success" && transcriptResult !== null
      ? (Object.fromEntries(
          transcriptResult.speakers.map((speaker) => [
            speaker.id,
            api.sampleProcessingSpeakerResultUrl(job.id, speaker.id),
          ])
        ) as Record<string, string>)
      : {}

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      assignmentRequestIdRef.current += 1
      transcriptSaveRequestIdRef.current += 1
      speakerSaveRequestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    activeJobIdRef.current = job?.id ?? null
  }, [job?.id])

  useEffect(() => {
    if (selectedTranscriptItemIds.length === 0) {
      return
    }

    function handleDocumentPointerDown(event: PointerEvent) {
      const target = event.target
      const element =
        target instanceof Element ? target : target instanceof Node ? target.parentElement : null
      const selectionSurface = element?.closest("[data-transcript-selection-workspace]")
      const isCurrentWorkspaceSurface =
        selectionSurface?.getAttribute("data-transcript-selection-workspace") === transcriptSelectionSurfaceId
      if (!isCurrentWorkspaceSurface) {
        setSelectedTranscriptItemIds([])
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true)
    return () => document.removeEventListener("pointerdown", handleDocumentPointerDown, true)
  }, [selectedTranscriptItemIds.length, transcriptSelectionSurfaceId])

  useEffect(() => {
    if (!job || transcriptResult === null) {
      if (stateJobIdRef.current !== null) {
        assignmentRequestIdRef.current += 1
        transcriptSaveRequestIdRef.current += 1
        transcriptSaveInFlightRef.current = false
        speakerSaveRequestIdRef.current += 1
        stateJobIdRef.current = null
        setSelectedTranscriptItemIds([])
        setSpeakerNameAssignments({})
        setSpeakerVoicePresetIds({})
        setSelectedSpeakerIds([])
        setTranscriptTextDrafts({})
        setSavedTranscriptTexts({})
        setAssignmentStatus("idle")
        setAssignmentError(null)
        setTranscriptSaveStatus("idle")
        setTranscriptSaveError(null)
        setSpeakerSaveStatus("idle")
        setSpeakerSaveError(null)
      }
      return
    }
    if (stateJobIdRef.current === job.id) {
      return
    }
    stateJobIdRef.current = job.id
    transcriptSaveInFlightRef.current = false
    setSelectedTranscriptItemIds([])
    setSpeakerNameAssignments(
      Object.fromEntries(
        transcriptResult.speakers.map((speaker) => [speaker.id, speaker.assignedName ?? speaker.label])
      )
    )
    setSpeakerVoicePresetIds(
      Object.fromEntries(
        transcriptResult.speakers.map((speaker) => [speaker.id, defaultVoicePresetId])
      ) as Record<string, VoicePresetId>
    )
    setSelectedSpeakerIds(transcriptResult.speakers.map((speaker) => speaker.id))
    const transcriptTexts = Object.fromEntries(
      transcriptResult.transcript.items.map((item) => [item.id, item.text])
    )
    setTranscriptTextDrafts(transcriptTexts)
    setSavedTranscriptTexts(transcriptTexts)
    setAssignmentStatus("idle")
    setAssignmentError(null)
    setTranscriptSaveStatus("idle")
    setTranscriptSaveError(null)
    setSpeakerSaveStatus("idle")
    setSpeakerSaveError(null)
  }, [defaultVoicePresetId, job, transcriptResult])

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

  function handleTranscriptTextChange(itemId: string, text: string) {
    setTranscriptTextDrafts((current) => ({ ...current, [itemId]: text }))
    setTranscriptSaveStatus((current) => (current === "loading" ? current : "idle"))
    setTranscriptSaveError(null)
  }

  async function patchSpeakerAssignments(request: api.UpdateSpeakerAssignmentsRequest) {
    if (!job || job.status !== "success" || !isTranscriptResult(job.result)) {
      return
    }
    const activeJobId = job.id
    const requestId = assignmentRequestIdRef.current + 1
    assignmentRequestIdRef.current = requestId
    setAssignmentStatus("loading")
    setAssignmentError(null)
    try {
      const payload = await api.updateSampleProcessingSpeakerAssignments(activeJobId, request)
      if (!isActiveRequest(activeJobId, requestId, assignmentRequestIdRef)) {
        return
      }
      onJobUpdate(payload.job)
      setAssignmentStatus("success")
    } catch (caught) {
      if (!isActiveRequest(activeJobId, requestId, assignmentRequestIdRef)) {
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

  async function saveTranscriptItems(itemIds = unsavedTranscriptItemIds) {
    const result = job?.result ?? null
    if (!job || job.status !== "success" || !isTranscriptResult(result)) {
      return
    }
    const uniqueItemIds = uniqueIds(itemIds).filter((itemId) =>
      result.transcript.items.some((item) => item.id === itemId)
    )
    if (uniqueItemIds.length === 0) {
      return
    }
    const items = uniqueItemIds.map((itemId) => ({ itemId, text: transcriptTextDrafts[itemId] ?? "" }))
    if (items.some((item) => item.text.trim().length === 0)) {
      setTranscriptSaveStatus("error")
      setTranscriptSaveError("Transcript text is required.")
      return
    }
    if (transcriptSaveInFlightRef.current) {
      return
    }

    const activeJobId = job.id
    const requestId = transcriptSaveRequestIdRef.current + 1
    transcriptSaveRequestIdRef.current = requestId
    transcriptSaveInFlightRef.current = true
    setTranscriptSaveStatus("loading")
    setTranscriptSaveError(null)
    try {
      const payload = await api.updateSampleProcessingTranscriptItems(activeJobId, { items })
      if (!isActiveRequest(activeJobId, requestId, transcriptSaveRequestIdRef)) {
        return
      }
      onJobUpdate(payload.job)
      if (isTranscriptResult(payload.job.result)) {
        const responseTexts = new Map(
          payload.job.result.transcript.items.map((item) => [item.id, item.text])
        )
        setTranscriptTextDrafts((current) => {
          const next = { ...current }
          items.forEach((item) => {
            const responseText = responseTexts.get(item.itemId)
            if (responseText !== undefined && current[item.itemId] === item.text) {
              next[item.itemId] = responseText
            }
          })
          return next
        })
        setSavedTranscriptTexts((current) => {
          const next = { ...current }
          items.forEach((item) => {
            const responseText = responseTexts.get(item.itemId)
            if (responseText !== undefined) {
              next[item.itemId] = responseText
            }
          })
          return next
        })
      }
      setTranscriptSaveStatus("success")
    } catch (caught) {
      if (!isActiveRequest(activeJobId, requestId, transcriptSaveRequestIdRef)) {
        return
      }
      setTranscriptSaveStatus("error")
      setTranscriptSaveError(caught instanceof Error ? caught.message : "Unable to save transcript corrections.")
    } finally {
      if (transcriptSaveRequestIdRef.current === requestId) {
        transcriptSaveInFlightRef.current = false
      }
    }
  }

  async function handleSaveTranscriptItems(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    await saveTranscriptItems()
  }

  async function handleSaveSpeakerVoices(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!job || job.status !== "success" || !isTranscriptResult(job.result)) {
      return
    }
    const activeJobId = job.id
    if (selectedSpeakerIds.length === 0) {
      setSpeakerSaveStatus("error")
      setSpeakerSaveError("Choose at least one speaker.")
      return
    }
    const voices = selectedSpeakerIds.map((speakerId) => ({
      speakerId,
      name: (speakerNameAssignments[speakerId] ?? "").trim(),
      voicePresetId: speakerVoicePresetIds[speakerId] ?? DEFAULT_VOICE_PRESET_ID,
    }))
    if (voices.some((voice) => !voice.name)) {
      setSpeakerSaveStatus("error")
      setSpeakerSaveError("Voice name is required.")
      return
    }

    const requestId = speakerSaveRequestIdRef.current + 1
    speakerSaveRequestIdRef.current = requestId
    setSpeakerSaveStatus("loading")
    setSpeakerSaveError(null)
    try {
      const payload = await api.saveSpeakerVoices(activeJobId, { voices })
      if (!isActiveRequest(activeJobId, requestId, speakerSaveRequestIdRef)) {
        return
      }
      payload.voices.forEach((voice) => onVoiceSaved(voice))
      setSpeakerSaveStatus("success")
    } catch (caught) {
      if (!isActiveRequest(activeJobId, requestId, speakerSaveRequestIdRef)) {
        return
      }
      setSpeakerSaveStatus("error")
      setSpeakerSaveError(caught instanceof Error ? caught.message : "Unable to add speaker voices.")
    }
  }

  function isActiveRequest(jobId: string, requestId: number, requestRef: { current: number }) {
    return mountedRef.current && activeJobIdRef.current === jobId && requestRef.current === requestId
  }

  return {
    assignmentError,
    assignmentStatus,
    assignSelectedTranscriptItemsToSpeaker,
    assignSpeakerName,
    assignTranscriptItemsToSpeaker,
    canSaveSelectedSpeakers,
    canSaveTranscript,
    handleSaveSpeakerVoices,
    handleSaveTranscriptItems,
    handleSpeakerNameChange,
    handleSpeakerSaveSelectionChange,
    handleSpeakerVoicePresetChange,
    handleTranscriptSelectionChange,
    handleTranscriptTextChange,
    hasUnsavedTranscriptChanges,
    isTranscriptJob,
    saveTranscriptItems,
    selectedSpeakerIds,
    selectedTranscriptItemIds,
    setSelectedSpeakerIds,
    speakerNameAssignments,
    speakerResultUrls,
    speakerSaveError,
    speakerSaveStatus,
    transcriptResult,
    speakerSourceUrl,
    speakerVoicePresetIds,
    transcriptSaveError,
    transcriptSaveStatus,
    transcriptSelectionSurfaceId,
    transcriptTextDrafts,
    unsavedTranscriptItemIds,
  }
}

export type SpeakerTranscriptController = ReturnType<typeof useSpeakerTranscript>

function isTranscriptResult(result: SampleProcessingJob["result"]): result is SpeakerSeparationResult {
  return Boolean(result && "kind" in result && (result.kind === "speakerSeparation" || result.kind === "transcript"))
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)))
}
