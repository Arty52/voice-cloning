import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/lib/api"
import { estimateSampleProcessingDurationRangeSeconds } from "@/lib/sample-processing-estimate"
import {
  readActiveTranscriptTimingDiagnostic,
  startTranscriptTimingDiagnostic,
  type TranscriptTimingDiagnosticRecord,
  type TranscriptTimingDiagnosticStatus,
  updateActiveTranscriptTimingDiagnostic,
} from "@/lib/transcript-timing-diagnostics"
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
  const [timingDiagnostic, setTimingDiagnostic] = useState<TranscriptTimingDiagnosticRecord | null>(() =>
    readInitialTimingDiagnostic(initialStoredJobId)
  )
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
    const intervalId = window.setInterval(() => {
      if (activeJobIdRef.current === job.id) {
        updateElapsedTime(job)
      }
    }, TIMER_INTERVAL_MS)
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
    if (!canStart || !sourceFile || !preStartEstimateRangeSeconds) {
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    const startedTimingDiagnostic = startTranscriptTimingDiagnostic({
      estimate: preStartEstimateRangeSeconds,
      sourceFile,
    })
    setTimingDiagnostic(startedTimingDiagnostic)
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
      finishTimingDiagnostic(
        "error",
        Math.max(0, Date.now() - Date.parse(startedTimingDiagnostic.createdAt))
      )
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
        finishTimingDiagnostic("incomplete", null)
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
        resetMissingJob()
        return
      }
      activeJobIdRef.current = jobId
      writeStoredLatestTranscriptJobId(jobId)
      updateTimingDiagnostic("processing")
      setStatus("processing")
      const detail = caught instanceof Error ? caught.message : "Unable to restore the latest transcript job."
      setError(`${detail} Retrying.`)
      void pollJobRef.current(jobId, runId)
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
        if (isMissingTranscriptJobError(caught)) {
          resetMissingJob()
          return
        }
        setStatus("processing")
        const detail = caught instanceof Error ? caught.message : "Unable to poll transcript processing job."
        setError(`${detail} Retrying.`)
      }
    }
  }

  function resetMissingJob() {
    finishTimingDiagnostic("incomplete", null)
    activeJobIdRef.current = null
    clearStoredLatestTranscriptJobId()
    setJob(null)
    setStatus("idle")
    setError(null)
    setProcessingElapsedMs(null)
  }

  function applyJob(nextJob: SampleProcessingJob) {
    updateJob(nextJob)
    const elapsedMs = elapsedMsFromJob(nextJob)
    setProcessingElapsedMs(elapsedMs)
    if (nextJob.status === "success") {
      finishTimingDiagnostic("success", elapsedMs, completedAtFromJob(nextJob))
      setStatus("success")
      setError(null)
      return true
    }
    if (nextJob.status === "canceled") {
      finishTimingDiagnostic("canceled", elapsedMs, completedAtFromJob(nextJob))
      setStatus("canceled")
      setError(null)
      return true
    }
    if (nextJob.status === "error" || nextJob.status === "interrupted") {
      finishTimingDiagnostic("error", elapsedMs, completedAtFromJob(nextJob))
      setStatus("error")
      setError(nextJob.error || "Transcript processing failed.")
      return true
    }
    updateTimingDiagnostic("processing")
    setError(null)
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

  function updateTimingDiagnostic(workflowStatus: TranscriptTimingDiagnosticStatus) {
    const updatedDiagnostic = updateActiveTranscriptTimingDiagnostic({ workflowStatus })
    if (updatedDiagnostic) {
      setTimingDiagnostic(updatedDiagnostic)
    }
  }

  function finishTimingDiagnostic(
    workflowStatus: Extract<TranscriptTimingDiagnosticStatus, "success" | "canceled" | "error" | "incomplete">,
    actualElapsedMs: number | null,
    completedAt?: string | null
  ) {
    const updatedDiagnostic = updateActiveTranscriptTimingDiagnostic({
      workflowStatus,
      actualElapsedMs,
      completedAt,
    })
    if (updatedDiagnostic) {
      setTimingDiagnostic(updatedDiagnostic)
    }
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
    timingDiagnostic,
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

function completedAtFromJob(job: SampleProcessingJob) {
  const completedAt = job.steps.at(-1)?.completedAt ?? job.updatedAt
  return Number.isFinite(Date.parse(completedAt)) ? completedAt : null
}

function readStoredLatestTranscriptJobId() {
  try {
    return window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)
  } catch {
    return null
  }
}

function readInitialTimingDiagnostic(initialStoredJobId: string | null) {
  const activeDiagnostic = readActiveTranscriptTimingDiagnostic()
  if (!initialStoredJobId && activeDiagnostic) {
    return updateActiveTranscriptTimingDiagnostic({
      workflowStatus: "incomplete",
      actualElapsedMs: null,
    }) ?? activeDiagnostic
  }
  return activeDiagnostic
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
