import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/lib/api"
import { estimateSampleProcessingDurationRangeSeconds } from "@/lib/sample-processing-estimate"
import {
  markUnpairedTranscriptTimingDiagnosticsIncomplete,
  readActiveTranscriptTimingDiagnostic,
  readTranscriptTimingDiagnostics,
  startTranscriptTimingDiagnostic,
  type TranscriptTimingDiagnosticRecord,
  type TranscriptTimingDiagnosticStatus,
  updateTranscriptTimingDiagnostic,
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
export const LATEST_TRANSCRIPT_SESSION_STORAGE_KEY = "voice-cloning.latestTranscriptSession.v1"
// Each active session has its own key so tabs never need a read-modify-write
// update to a shared JSON array.
export const TRANSCRIPT_SESSION_STORAGE_PREFIX = "voice-cloning.transcriptSession.v1."
// Kept only to migrate installations created by the first paired-session release.
export const ACTIVE_TRANSCRIPT_SESSIONS_STORAGE_KEY = "voice-cloning.activeTranscriptSessions.v1"
export const TRANSCRIPT_AUDIO_ACCEPT = ".mp3,.wav,.m4a,.m4b,.aac,.ogg,.flac,audio/*"
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "m4b", "mp3", "ogg", "wav"])

export function useTranscriptWorkflow({
  availabilityError,
  availabilityStatus,
  diarizationAvailable,
  onVoiceSaved,
}: UseTranscriptWorkflowOptions) {
  const [initialStoredTranscriptSessions] = useState(readStoredTranscriptSessions)
  const [initialStoredTranscriptSession] = useState(
    () => readStoredLatestTranscriptSession() ?? initialStoredTranscriptSessions.at(-1) ?? null
  )
  const [initialStoredJobId] = useState(
    () => initialStoredTranscriptSession?.jobId ?? readStoredLatestTranscriptJobId()
  )
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [job, setJob] = useState<SampleProcessingJob | null>(null)
  const [status, setStatus] = useState<TranscriptWorkflowStatus>(() =>
    initialStoredJobId ? "restoring" : "idle"
  )
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [processingElapsedMs, setProcessingElapsedMs] = useState<number | null>(null)
  const [timingDiagnostic, setTimingDiagnostic] = useState<TranscriptTimingDiagnosticRecord | null>(() =>
    readInitialTimingDiagnostic(
      initialStoredJobId,
      initialStoredTranscriptSessions,
      initialStoredTranscriptSession
    )
  )
  const timingDiagnosticIdRef = useRef<string | null>(timingDiagnostic?.id ?? null)
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
    timingDiagnosticIdRef.current = startedTimingDiagnostic.id
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
        clearStoredLatestTranscriptJob(jobId)
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
        resetMissingJob(jobId)
        return
      }
      activeJobIdRef.current = jobId
      writeStoredLatestTranscriptJob(jobId, timingDiagnosticIdRef.current)
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
          resetMissingJob(jobId)
          return
        }
        setStatus("processing")
        const detail = caught instanceof Error ? caught.message : "Unable to poll transcript processing job."
        setError(`${detail} Retrying.`)
      }
    }
  }

  function resetMissingJob(jobId: string | null = activeJobIdRef.current) {
    finishTimingDiagnostic("incomplete", null)
    activeJobIdRef.current = null
    clearStoredLatestTranscriptJob(jobId)
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
    writeStoredLatestTranscriptJob(nextJob.id, timingDiagnosticIdRef.current)
    setJob(nextJob)
  }

  function updateElapsedTime(nextJob: SampleProcessingJob) {
    setProcessingElapsedMs(elapsedMsFromJob(nextJob))
  }

  function updateTimingDiagnostic(workflowStatus: TranscriptTimingDiagnosticStatus) {
    const diagnosticId = timingDiagnosticIdRef.current
    const updatedDiagnostic = diagnosticId
      ? updateTranscriptTimingDiagnostic(diagnosticId, { workflowStatus })
      : null
    if (updatedDiagnostic) {
      setTimingDiagnostic(updatedDiagnostic)
    }
  }

  function finishTimingDiagnostic(
    workflowStatus: Extract<TranscriptTimingDiagnosticStatus, "success" | "canceled" | "error" | "incomplete">,
    actualElapsedMs: number | null,
    completedAt?: string | null
  ) {
    const diagnosticId = timingDiagnosticIdRef.current
    const updatedDiagnostic = diagnosticId
      ? updateTranscriptTimingDiagnostic(diagnosticId, {
          workflowStatus,
          actualElapsedMs,
          completedAt,
        })
      : null
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

function readInitialTimingDiagnostic(
  initialStoredJobId: string | null,
  storedSessions: readonly StoredTranscriptSession[],
  latestStoredSession: StoredTranscriptSession | null
) {
  // The latest session pointer is authoritative for restoration, even when a
  // concurrent tab has interleaved the bounded session registry write.
  const sessionsForReconciliation = latestStoredSession
    ? [...storedSessions.filter(({ jobId }) => jobId !== latestStoredSession.jobId), latestStoredSession]
    : storedSessions
  const pairedDiagnosticIds = new Set(
    sessionsForReconciliation.flatMap(({ timingDiagnosticId }) => (timingDiagnosticId ? [timingDiagnosticId] : []))
  )
  const reconciledDiagnostics = markUnpairedTranscriptTimingDiagnosticsIncomplete(pairedDiagnosticIds)
  const timingDiagnosticId =
    (latestStoredSession?.jobId === initialStoredJobId ? latestStoredSession : null)?.timingDiagnosticId ??
    storedSessions.find(({ jobId }) => jobId === initialStoredJobId)?.timingDiagnosticId ??
    null
  if (timingDiagnosticId) {
    return readTranscriptTimingDiagnostics().find(({ id }) => id === timingDiagnosticId) ?? null
  }
  const activeDiagnostic = readActiveTranscriptTimingDiagnostic()
  if (!initialStoredJobId && reconciledDiagnostics.length > 0) {
    return reconciledDiagnostics.at(-1) ?? null
  }
  if (!initialStoredJobId && activeDiagnostic) {
    return (
      updateTranscriptTimingDiagnostic(activeDiagnostic.id, {
        workflowStatus: "incomplete",
        actualElapsedMs: null,
      }) ?? activeDiagnostic
    )
  }
  return initialStoredJobId ? null : activeDiagnostic
}

type StoredTranscriptSession = {
  jobId: string
  timingDiagnosticId: string | null
  createdAt?: string
}

function readStoredLatestTranscriptSession(): StoredTranscriptSession | null {
  try {
    const rawValue = window.localStorage.getItem(LATEST_TRANSCRIPT_SESSION_STORAGE_KEY)
    if (!rawValue) {
      return null
    }
    const parsed = JSON.parse(rawValue) as unknown
    if (
      !isStoredTranscriptSession(parsed) ||
      parsed.jobId.length === 0 ||
      parsed.jobId.length > 128 ||
      (parsed.timingDiagnosticId !== null &&
        (parsed.timingDiagnosticId.length === 0 || parsed.timingDiagnosticId.length > 128))
    ) {
      window.localStorage.removeItem(LATEST_TRANSCRIPT_SESSION_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function readStoredTranscriptSessions(): StoredTranscriptSession[] {
  try {
    const perSessionRecords = readStoredTranscriptSessionRecords()
    const legacySessions = readLegacyStoredTranscriptSessions()
    const latestSession = readStoredLatestTranscriptSession()
    const sessions = [...legacySessions, ...perSessionRecords, ...(latestSession ? [latestSession] : [])]
    const uniqueSessions = [...new Map(sessions.map((session) => [session.jobId, session])).values()]
    const retainedSessions = retainStoredTranscriptSessions(uniqueSessions)
    pruneStoredTranscriptSessionRecords(uniqueSessions, retainedSessions)
    return retainedSessions
  } catch {
    return []
  }
}

function readLegacyStoredTranscriptSessions(): StoredTranscriptSession[] {
  const rawValue = window.localStorage.getItem(ACTIVE_TRANSCRIPT_SESSIONS_STORAGE_KEY)
  if (!rawValue) return []
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(ACTIVE_TRANSCRIPT_SESSIONS_STORAGE_KEY)
      return []
    }
    const sessions = parsed.filter(isStoredTranscriptSession).filter(isValidStoredTranscriptSession)
    sessions.forEach(writeStoredTranscriptSession)
    window.localStorage.removeItem(ACTIVE_TRANSCRIPT_SESSIONS_STORAGE_KEY)
    return sessions
  } catch {
    return []
  }
}

function readStoredTranscriptSessionRecords(): StoredTranscriptSession[] {
  return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key): key is string => key?.startsWith(TRANSCRIPT_SESSION_STORAGE_PREFIX) ?? false)
    .flatMap((key) => {
      const rawValue = window.localStorage.getItem(key)
      if (!rawValue) return []
      try {
        const parsed = JSON.parse(rawValue) as unknown
        if (isStoredTranscriptSession(parsed) && isValidStoredTranscriptSession(parsed)) {
          return [parsed]
        }
      } catch {
        // Fall through to remove corrupt entries.
      }
      window.localStorage.removeItem(key)
      return []
    })
}

function isStoredTranscriptSession(value: unknown): value is StoredTranscriptSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "jobId" in value &&
    typeof value.jobId === "string" &&
    "timingDiagnosticId" in value &&
    (typeof value.timingDiagnosticId === "string" || value.timingDiagnosticId === null)
  )
}

function isValidStoredTranscriptSession(session: StoredTranscriptSession) {
  return (
    session.jobId.length > 0 &&
    session.jobId.length <= 128 &&
    (session.createdAt === undefined || Number.isFinite(Date.parse(session.createdAt))) &&
    (session.timingDiagnosticId === null ||
      (session.timingDiagnosticId.length > 0 && session.timingDiagnosticId.length <= 128))
  )
}

function retainStoredTranscriptSessions(sessions: readonly StoredTranscriptSession[]) {
  return [...sessions]
    .sort((first, second) => (first.createdAt ?? "").localeCompare(second.createdAt ?? ""))
    .slice(-50)
}

function transcriptSessionStorageKey(jobId: string) {
  return `${TRANSCRIPT_SESSION_STORAGE_PREFIX}${jobId}`
}

function writeStoredTranscriptSession(session: StoredTranscriptSession) {
  window.localStorage.setItem(
    transcriptSessionStorageKey(session.jobId),
    JSON.stringify({ ...session, createdAt: session.createdAt ?? new Date().toISOString() })
  )
}

function pruneStoredTranscriptSessionRecords(
  observedSessions: readonly StoredTranscriptSession[],
  retainedSessions: readonly StoredTranscriptSession[]
) {
  const retainedJobIds = new Set(retainedSessions.map(({ jobId }) => jobId))
  // Delete only records observed in this read. Enumerating storage again could
  // discover and erase a session another tab wrote after the read completed.
  observedSessions.forEach(({ jobId }) => {
    if (!retainedJobIds.has(jobId)) window.localStorage.removeItem(transcriptSessionStorageKey(jobId))
  })
}

function writeStoredLatestTranscriptJob(jobId: string, timingDiagnosticId: string | null) {
  const nextSession = { jobId, timingDiagnosticId, createdAt: new Date().toISOString() } satisfies StoredTranscriptSession
  try {
    writeStoredTranscriptSession(nextSession)
    readStoredTranscriptSessions()
    window.localStorage.setItem(
      LATEST_TRANSCRIPT_SESSION_STORAGE_KEY,
      JSON.stringify(nextSession)
    )
  } catch {
    // A failed replacement must not leave an older paired session authoritative.
    // Prefer the legacy pointer only after that stale session has been removed.
    try {
      window.localStorage.removeItem(LATEST_TRANSCRIPT_SESSION_STORAGE_KEY)
      window.localStorage.removeItem(ACTIVE_TRANSCRIPT_SESSIONS_STORAGE_KEY)
      window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, jobId)
    } catch {
      // Browser storage is optional; the active mounted workflow still works.
    }
    return
  }
  try {
    // The paired session is authoritative; this legacy pointer preserves recovery
    // for installations created before paired timing diagnostics were introduced.
    window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, jobId)
  } catch {
    // The paired session is enough to restore the current job safely.
  }
}

function clearStoredLatestTranscriptJob(jobId: string | null) {
  try {
    const remainingSessions = readStoredTranscriptSessions().filter(({ jobId: storedJobId }) => storedJobId !== jobId)
    if (jobId) window.localStorage.removeItem(transcriptSessionStorageKey(jobId))
    pruneStoredTranscriptSessionRecords(remainingSessions, remainingSessions)
    const storedSession = readStoredLatestTranscriptSession()
    if (storedSession) {
      if (storedSession.jobId === jobId) {
        const nextLatestSession = remainingSessions.at(-1) ?? null
        if (nextLatestSession) {
          window.localStorage.setItem(LATEST_TRANSCRIPT_SESSION_STORAGE_KEY, JSON.stringify(nextLatestSession))
          window.localStorage.setItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY, nextLatestSession.jobId)
        } else {
          window.localStorage.removeItem(LATEST_TRANSCRIPT_SESSION_STORAGE_KEY)
          window.localStorage.removeItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)
        }
      }
      return
    }
    if (window.localStorage.getItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY) === jobId) {
      window.localStorage.removeItem(LATEST_TRANSCRIPT_JOB_STORAGE_KEY)
    }
  } catch {
    // Ignore browser storage cleanup failures.
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
