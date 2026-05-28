import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react"

import { addVoice } from "@/lib/api"
import { startVoiceRecorder, type VoiceRecorderSession } from "@/lib/voice-recorder"
import type { AsyncStatus, RecorderStatus, VoiceAsset, VoiceSampleInputMode } from "@/types"

type UseVoiceSampleInputOptions = {
  onVoiceSaved: (voice: VoiceAsset) => void
}

export function useVoiceSampleInput({ onVoiceSaved }: UseVoiceSampleInputOptions) {
  const [uploadName, setUploadName] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<AsyncStatus>("idle")
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [voiceSampleInputMode, setVoiceSampleInputMode] = useState<VoiceSampleInputMode>("upload")
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus>("idle")
  const [recorderError, setRecorderError] = useState<string | null>(null)
  const [recordingDurationSeconds, setRecordingDurationSeconds] = useState(0)
  const recordingSessionRef = useRef<VoiceRecorderSession | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingAutoStopTimerRef = useRef<number | null>(null)

  const isUploading = uploadStatus === "loading"
  const isRecording = recorderStatus === "recording"
  const isRecorderBusy = recorderStatus === "starting" || recorderStatus === "recording" || recorderStatus === "stopping"
  const canUpload = uploadName.trim().length > 0 && uploadFile !== null && !isUploading && !isRecorderBusy

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl)
      }
    }
  }, [uploadPreviewUrl])

  useEffect(() => {
    return () => {
      clearRecordingTimers(recordingTimerRef, recordingAutoStopTimerRef)
      void recordingSessionRef.current?.discard()
    }
  }, [])

  function handleUploadFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setVoiceSampleInputMode("upload")
    setUploadFile(nextFile)
    setUploadPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null)
    setUploadError(null)
  }

  function handleVoiceSampleInputModeChange(mode: VoiceSampleInputMode) {
    if (isRecorderBusy || mode === voiceSampleInputMode) {
      return
    }
    setVoiceSampleInputMode(mode)
    setUploadError(null)
    setUploadFile(null)
    setUploadPreviewUrl(null)
    setRecorderStatus("idle")
    setRecorderError(null)
    setRecordingDurationSeconds(0)
  }

  async function handleStartRecording() {
    if (isUploading || isRecorderBusy) {
      return
    }

    setVoiceSampleInputMode("record")
    setRecorderStatus("starting")
    setRecorderError(null)
    setUploadError(null)
    setUploadFile(null)
    setUploadPreviewUrl(null)
    setRecordingDurationSeconds(0)

    try {
      const session = await startVoiceRecorder()
      recordingSessionRef.current = session
      setRecorderStatus("recording")
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingDurationSeconds(session.getElapsedSeconds())
      }, 250)
      recordingAutoStopTimerRef.current = window.setTimeout(() => {
        void handleStopRecording(session)
      }, session.maxDurationSeconds * 1000)
    } catch (caught) {
      setRecorderStatus("error")
      setRecorderError(caught instanceof Error ? caught.message : "Unable to start microphone recording.")
    }
  }

  async function handleStopRecording(session = recordingSessionRef.current) {
    if (!session) {
      return
    }

    clearRecordingTimers(recordingTimerRef, recordingAutoStopTimerRef)
    recordingSessionRef.current = null
    setRecorderStatus("stopping")
    try {
      const recording = await session.stop()
      setUploadFile(recording.file)
      setUploadPreviewUrl(URL.createObjectURL(recording.file))
      setRecordingDurationSeconds(recording.durationSeconds)
      setRecorderStatus("recorded")
      setRecorderError(null)
    } catch (caught) {
      setRecorderStatus("error")
      setRecorderError(caught instanceof Error ? caught.message : "Unable to save microphone recording.")
    }
  }

  async function handleDiscardRecording() {
    clearRecordingTimers(recordingTimerRef, recordingAutoStopTimerRef)
    const session = recordingSessionRef.current
    recordingSessionRef.current = null
    if (session) {
      await session.discard()
    }
    resetSampleInput()
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canUpload || !uploadFile) {
      setUploadStatus("error")
      setUploadError("Add a voice name and upload or record an audio sample before saving.")
      return
    }

    setUploadStatus("loading")
    setUploadError(null)
    try {
      const payload = await addVoice(uploadName.trim(), uploadFile)
      onVoiceSaved(payload.voice)
      setUploadName("")
      resetSampleInput()
      setUploadStatus("success")
    } catch (caught) {
      setUploadStatus("error")
      setUploadError(caught instanceof Error ? caught.message : "Unable to save voice.")
    }
  }

  function resetSampleInput() {
    setUploadFile(null)
    setUploadPreviewUrl(null)
    setRecorderStatus("idle")
    setRecorderError(null)
    setRecordingDurationSeconds(0)
  }

  return {
    canUpload,
    handleDiscardRecording,
    handleStartRecording,
    handleStopRecording,
    handleUpload,
    handleUploadFileChange,
    handleVoiceSampleInputModeChange,
    isRecorderBusy,
    isRecording,
    isUploading,
    recorderError,
    recorderStatus,
    recordingDurationSeconds,
    setUploadName,
    uploadError,
    uploadFile,
    uploadName,
    uploadPreviewUrl,
    uploadStatus,
    voiceSampleInputMode,
  }
}

function clearRecordingTimers(
  recordingTimerRef: { current: number | null },
  recordingAutoStopTimerRef: { current: number | null }
) {
  if (recordingTimerRef.current !== null) {
    window.clearInterval(recordingTimerRef.current)
    recordingTimerRef.current = null
  }
  if (recordingAutoStopTimerRef.current !== null) {
    window.clearTimeout(recordingAutoStopTimerRef.current)
    recordingAutoStopTimerRef.current = null
  }
}
