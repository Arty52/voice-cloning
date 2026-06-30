import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { clampAudioWindow, createWindowedAudioFile, decodeAudioFile, type AudioWindow } from "@/lib/audio-window"
import { addVoice } from "@/lib/api"
import { DEFAULT_VOICE_PRESET_ID } from "@/lib/voice-presets"
import { startVoiceRecorder, type VoiceRecorderSession } from "@/lib/voice-recorder"
import type {
  AsyncStatus,
  ProviderSampleMetadata,
  RecorderStatus,
  VoiceAsset,
  VoicePresetId,
  VoiceSampleInputMode,
  VoiceSampleMode,
} from "@/types"

const DEFAULT_PROVIDER_SAMPLE: ProviderSampleMetadata = {
  maxSelectedSourceAudioBytes: 1024 * 1024 * 1024,
  maxWindowSeconds: 120,
  maxSourceUploadBytes: 1024 * 1024 * 1024,
  maxUploadBytes: 10 * 1024 * 1024,
  recommendedMinSeconds: 60,
  recommendedMaxSeconds: 120,
  targetSampleRateHz: 16000,
}

type UseVoiceSampleInputOptions = {
  onVoiceSaved: (voice: VoiceAsset) => void
  providerSample?: ProviderSampleMetadata | null
}

export function useVoiceSampleInput({ onVoiceSaved, providerSample }: UseVoiceSampleInputOptions) {
  const [uploadName, setUploadName] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<AsyncStatus>("idle")
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadPreparationStatus, setUploadPreparationStatus] = useState<AsyncStatus>("idle")
  const [uploadDurationSeconds, setUploadDurationSeconds] = useState<number | null>(null)
  const [uploadWindow, setUploadWindow] = useState<AudioWindow | null>(null)
  const [sampleMode, setSampleMode] = useState<VoiceSampleMode>("excerpt")
  const [uploadVoicePresetId, setUploadVoicePresetId] = useState<VoicePresetId>(DEFAULT_VOICE_PRESET_ID)
  const [voiceSampleInputMode, setVoiceSampleInputMode] = useState<VoiceSampleInputMode>("upload")
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus>("idle")
  const [recorderError, setRecorderError] = useState<string | null>(null)
  const [recordingDurationSeconds, setRecordingDurationSeconds] = useState(0)
  const recordingSessionRef = useRef<VoiceRecorderSession | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingAutoStopTimerRef = useRef<number | null>(null)
  const uploadPreparationIdRef = useRef(0)

  const sampleLimits = providerSample ?? DEFAULT_PROVIDER_SAMPLE
  const clampedUploadWindow = useMemo(() => {
    if (voiceSampleInputMode !== "upload" || uploadDurationSeconds === null || uploadWindow === null) {
      return uploadWindow
    }
    return clampAudioWindow(
      uploadDurationSeconds,
      sampleLimits.maxWindowSeconds,
      uploadWindow.startSeconds,
      uploadWindow.durationSeconds
    )
  }, [sampleLimits.maxWindowSeconds, uploadDurationSeconds, uploadWindow, voiceSampleInputMode])
  const isUploading = uploadStatus === "loading"
  const isPreparingSample = uploadPreparationStatus === "loading"
  const isRecording = recorderStatus === "recording"
  const isRecorderBusy = recorderStatus === "starting" || recorderStatus === "recording" || recorderStatus === "stopping"
  const canUpload =
    uploadName.trim().length > 0 &&
    uploadFile !== null &&
    (voiceSampleInputMode === "record" || clampedUploadWindow !== null) &&
    !isUploading &&
    !isPreparingSample &&
    !isRecorderBusy

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
    handleUploadFileSelect(event.target.files?.[0] ?? null)
  }

  function handleUploadFileSelect(nextFile: File | null) {
    setVoiceSampleInputMode("upload")
    clearRecordingTimers(recordingTimerRef, recordingAutoStopTimerRef)
    void recordingSessionRef.current?.discard()
    recordingSessionRef.current = null
    setUploadFile(nextFile)
    setUploadPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null)
    setUploadError(null)
    setSampleMode("excerpt")
    setUploadDurationSeconds(null)
    setUploadWindow(null)
    setRecorderStatus("idle")
    setRecorderError(null)
    setRecordingDurationSeconds(0)
    if (nextFile) {
      void prepareUploadWindow(nextFile)
    } else {
      setUploadPreparationStatus("idle")
    }
  }

  function handleVoiceSampleInputModeChange(mode: VoiceSampleInputMode) {
    if (isRecorderBusy || mode === voiceSampleInputMode) {
      return
    }
    setVoiceSampleInputMode(mode)
    setUploadError(null)
    setUploadFile(null)
    setUploadPreviewUrl(null)
    setUploadDurationSeconds(null)
    setUploadWindow(null)
    setSampleMode("excerpt")
    setUploadPreparationStatus("idle")
    setRecorderStatus("idle")
    setRecorderError(null)
    setRecordingDurationSeconds(0)
  }

  async function handleStartRecording() {
    if (isUploading || isPreparingSample || isRecorderBusy) {
      return
    }

    setVoiceSampleInputMode("record")
    setRecorderStatus("starting")
    setRecorderError(null)
    setUploadError(null)
    setUploadFile(null)
    setUploadPreviewUrl(null)
    setUploadDurationSeconds(null)
    setUploadWindow(null)
    setSampleMode("excerpt")
    setUploadPreparationStatus("idle")
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
      setUploadDurationSeconds(null)
      setUploadWindow(null)
      setSampleMode("excerpt")
      setUploadPreparationStatus("idle")
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
      const selectedUploadWindow = clampedUploadWindow
      const activeSampleFile =
        voiceSampleInputMode === "upload" && selectedUploadWindow
          ? await createWindowedAudioFile({ file: uploadFile, window: selectedUploadWindow })
          : uploadFile
      const payload = await addVoice(uploadName.trim(), activeSampleFile, {
        sampleMode: voiceSampleInputMode === "upload" ? sampleMode : "excerpt",
        sourceFile: voiceSampleInputMode === "upload" && sampleMode === "sourceWindow" ? uploadFile : null,
        voicePresetId: uploadVoicePresetId,
        windowDurationSeconds: voiceSampleInputMode === "upload" ? selectedUploadWindow?.durationSeconds : null,
        windowStartSeconds: voiceSampleInputMode === "upload" ? selectedUploadWindow?.startSeconds : null,
      })
      onVoiceSaved(payload.voice)
      setUploadName("")
      setUploadVoicePresetId(DEFAULT_VOICE_PRESET_ID)
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
    setUploadDurationSeconds(null)
    setUploadWindow(null)
    setSampleMode("excerpt")
    setUploadPreparationStatus("idle")
    setRecorderStatus("idle")
    setRecorderError(null)
    setRecordingDurationSeconds(0)
  }

  return {
    canUpload,
    handleDiscardRecording,
    handleStartRecording,
    handleStopRecording,
    handleSampleModeChange: setSampleMode,
    handleSampleWindowChange: setUploadWindow,
    handleUpload,
    handleUploadFileChange,
    handleUploadFileSelect,
    handleVoiceSampleInputModeChange,
    isRecorderBusy,
    isRecording,
    isPreparingSample,
    isUploading,
    recorderError,
    recorderStatus,
    recordingDurationSeconds,
    sampleLimits,
    sampleMode,
    setUploadName,
    setUploadVoicePresetId,
    uploadDurationSeconds,
    uploadError,
    uploadFile,
    uploadName,
    uploadPreviewUrl,
    uploadVoicePresetId,
    uploadStatus,
    uploadWindow: clampedUploadWindow,
    voiceSampleInputMode,
  }

  async function prepareUploadWindow(file: File) {
    const preparationId = uploadPreparationIdRef.current + 1
    uploadPreparationIdRef.current = preparationId
    setUploadPreparationStatus("loading")
    try {
      const audioBuffer = await decodeAudioFile(file)
      if (uploadPreparationIdRef.current !== preparationId) {
        return
      }
      const nextWindow = clampAudioWindow(audioBuffer.duration, sampleLimits.maxWindowSeconds)
      setUploadDurationSeconds(audioBuffer.duration)
      setUploadWindow(nextWindow)
      setUploadPreparationStatus("success")
    } catch (caught) {
      if (uploadPreparationIdRef.current !== preparationId) {
        return
      }
      setUploadDurationSeconds(null)
      setUploadWindow(null)
      setUploadPreparationStatus("error")
      setUploadError(caught instanceof Error ? caught.message : "Unable to prepare this audio file.")
    }
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
