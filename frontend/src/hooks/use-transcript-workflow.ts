import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/lib/api"
import { estimateSampleProcessingDurationRangeSeconds } from "@/lib/sample-processing-estimate"
import type { AsyncStatus, SampleProcessingJob, VoiceAsset } from "@/types"

import { useSpeakerTranscript } from "./use-speaker-transcript"

export type TranscriptWorkflowStatus =
  | "idle"
  | "restoring"
  | "starting"
  | "processing"
  | "success"
  | "error"
  | "canceled"

type UseTranscriptWorkflowOptions = {
  availabilityError: string | null
  availabilityStatus: AsyncStatus
  diarizationAvailable: boolean
  onVoiceSaved: (voice: VoiceAsset) => void
}

const POLL_INTERVAL_MS = 1500
const TIMER_INTERVAL_MS = 250
export const LATEST_TRANSCRIPT_JOB_STORAGE_KEY = "voice-cloning.latestTranscriptJobId.v1"
export const TRANSCRIPT_AUDIO_ACCEPT = ".mp3,.wav,.m4a,.m4b,.aac,.ogg,.flac,audio/*"
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "m4b", "mp3", "ogg", "wav"])

export function useTranscriptWorkflow({
  availabilityError,
  availabilityStatus,
  diarizationAvailable,
  onVoiceSaved,
}: UseTranscriptWorkflowOptions) {
  const [initialStoredJobId] = useState(readStoredLatestTranscriptJobId)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [job, setJob] = useState<SampleProcessingJob | null>(null)
  const [status, setStatus] = useState<TranscriptWorkflowStatus>(() =>
    initialStoredJobId ? "restoring" : "idle"
  )
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [processingElapsedMs, setProcessingElapsedMs] = useState<number | null>(null)
  const mountedRef = useRef(true)
  const runIdRef = useRef(0)
  const activeJobIdRef = useRef<string | null>(null)
  const pollJobRef = useRef<(jobId: string, runId: number) => Promise<void>>(async () => undefined)
  const restoreJobRef = useRef<(jobId: string, runId: number) => Promise<void>>(async () => undefined)
  const speakerTranscript = useSpeakerTranscript({
    job,
    onJobUpdate: updateJob,
    onVoiceSaved,
  })
  const preStartEstimateRangeSeconds = useMemo(
    () =>
      estimateSampleProcessingDurationRangeSeconds({
        cleanVoice: false,
        detectSpeakers: true,
        sourceSizeBytes: sourceFile?.size ?? null,
        trimCandidates: false,
      }),
    [sourceFile?.size]
  )

  const isProcessing = status === "restoring" || status === "starting" || status === "processing"
  const canStart =
    sourceFile !== null &&
    availabilityStatus === "success" &&
    diarizationAvailable &&
    !isProcessing
  const canCancel =
    (status === "starting" || status === "processing") && activeJobIdRef.current !== null
  const unavailableReason =
    availabilityStatus === "error"
      ? availabilityError || "Transcript processing options are unavailable."
      : availabilityStatus === "success" && !diarizationAvailable
        ? "Speaker detection is unavailable. Enable the local diarization runtime to create transcripts."
        : null

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    pollJobRef.current = pollJob
    restoreJobRef.current = restoreJob
  })

  useEffect(() => {
    if (!initialStoredJobId) {
      return
    }
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    void restoreJobRef.current(initialStoredJobId, runId)
  }, [initialStoredJobId])

  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "running")) {
      return
    }
    updateElapsedTime(job)
    const intervalId = window.setInterval(() => updateElapsedTime(job), TIMER_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [job])

  function handleSourceFileChange(event: ChangeEvent<HTMLInputElement>) {
    handleSourceFileSelect(event.currentTarget.files?.[0] ?? null)
  }

  function handleSourceFileSelect(nextFile: File | null) {
    if (nextFile && !isSupportedTranscriptAudio(nextFile)) {
      setSourceFile(null)
      setValidationError("Choose an MP3, WAV, M4A, M4B, AAC, OGG, or FLAC audio file.")
      return
    }
    setSourceFile(nextFile)
    setValidationError(null)
    setError(null)
  }

  async function handleStartTranscription(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!canStart || !sourceFile) {
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setStatus("starting")
    setError(null)
    setProcessingElapsedMs(0)
    try {
      const payload = await api.createSampleProcessingJob({
        operationId: "separateSpeakers",
        sourceFile,
      })
      if (!isActiveRun(runId)) {
        return
      }
      setSourceFile(null)
      if (applyJob(payload.job)) {
        return
      }
      setStatus("processing")
      void pollJobRef.current(payload.job.id, runId)
    } catch (caught) {
      if (!isActiveRun(runId)) {
        return
      }
      setStatus("error")
      setError(caught instanceof Error ? caught.message : "Unable to start transcript processing.")
    }
  }

  async function handleCancelTranscription() {
    const activeJobId = activeJobIdRef.current
    const runId = runIdRef.current
    if (!activeJobId || !canCancel) {
      return
    }
    try {
      const payload = await api.cancelSampleProcessingJob(activeJobId)
      if (!isActiveRun(runId)) {
        return
      }
      if (applyJob(payload.job)) {
        runIdRef.current = runId + 1
      }
    } catch (caught) {
      if (isActiveRun(runId)) {
        setError(caught instanceof Error ? caught.message : "Unable to cancel transcript processing.")
      }
    }
  }

  async function restoreJob(jobId: string, runId: number) {
    try {
      const payload = await api.fetchSampleProcessingJob(jobId)
      if (!isActiveRun(runId)) {
        return
      }
      if (payload.job.operationId !== "separateSpeakers") {
        clearStoredLatestTranscriptJobId()
        setStatus("idle")
        return
      }
      if (applyJob(payload.job)) {
        return
      }
      setStatus("processing")
      void pollJobRef.current(jobId, runId)
    } catch (caught) {
      if (!isActiveRun(runId)) {
        return
      }
      if (isMissingTranscriptJobError(caught)) {
        activeJobIdRef.current = null
        clearStoredLatestTranscriptJobId()
        setJob(null)
        setStatus("idle")
        setError(null)
        setProcessingElapsedMs(null)
        return
      }
      setStatus("error")
      setError(caught instanceof Error ? caught.message : "Unable to restore the latest transcript job.")
    }
  }

  async function pollJob(jobId: string, runId: number) {
    while (isActiveRun(runId)) {
      await delay(POLL_INTERVAL_MS)
      if (!isActiveRun(runId)) {
        return
      }
      try {
        const payload = await api.fetchSampleProcessingJob(jobId)
        if (!isActiveRun(runId)) {
          return
        }
        if (applyJob(payload.job)) {
          return
        }
      } catch (caught) {
        if (!isActiveRun(runId)) {
          return
        }
        setStatus("error")
        setError(caught instanceof Error ? caught.message : "Unable to poll transcript processing job.")
        return
      }
    }
  }

  function applyJob(nextJob: SampleProcessingJob) {
    updateJob(nextJob)
    updateElapsedTime(nextJob)
    if (nextJob.status === "success") {
      setStatus("success")
      setError(null)
      return true
    }
    if (nextJob.status === "canceled") {
      setStatus("canceled")
      setError(null)
      return true
    }
    if (nextJob.status === "error" || nextJob.status === "interrupted") {
      setStatus("error")
      setError(nextJob.error || "Transcript processing failed.")
      return true
    }
    return false
  }

  function updateJob(nextJob: SampleProcessingJob) {
    activeJobIdRef.current = nextJob.id
    writeStoredLatestTranscriptJobId(nextJob.id)
    setJob(nextJob)
  }

  function updateElapsedTime(nextJob: SampleProcessingJob) {
    setProcessingElapsedMs(elapsedMsFromJob(nextJob))
  }

  function isActiveRun(runId: number) {
    return mountedRef.current && runIdRef.current === runId
  }

  return {
    canCancel,
    canStart,
    error,
    handleCancelTranscription,
    handleSourceFileChange,
    handleSourceFileSelect,
    handleStartTranscription,
    isProcessing,
    job,
    preStartEstimateRangeSeconds,
    processingElapsedMs,
    sourceFile,
    speakerTranscript,
    status,
    unavailableReason,
    validationError,
  }
}

export type TranscriptWorkflowController = ReturnType<typeof useTranscriptWorkflow>

function isSupportedTranscriptAudio(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  return SUPPORTED_AUDIO_EXTENSIONS.has(extension)
}

function isMissingTranscriptJobError(caught: unknown) {
  return caught instanceof Error && /not found|404/i.test(caught.message)
}

function elapsedMsFromJob(job: SampleProcessingJob) {
  const startTime = Date.parse(job.steps[0]?.startedAt ?? job.createdAt)
  if (!Number.isFinite(startTime)) {
    return 0
  }
  const endTime =
    job.status === "pending" || job.status === "running"
      ? Date.now()
      : Date.parse(job.steps.at(-1)?.completedAt ?? job.updatedAt)
  return Number.isFinite(endTime) ? Math.max(0, endTime - startTime) : 0
}

function readStoredLatestTranscriptJobId() {
  try {
    return window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredLatestTranscriptJobId(jobId: string) {
  try {
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, jobId)
  } catch {
    // Browser storage is optional; the active mounted workflow still works.
  }
}

function clearStoredLatestTranscriptJobId() {
  try {
    window.localStorage.removeItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)
  } catch {
    // Ignore browser storage cleanup failures.
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
