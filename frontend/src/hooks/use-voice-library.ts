import { type FormEvent, useEffect, useRef, useState } from "react"

import * as voiceApi from "@/lib/api"
import type { AsyncStatus, VoiceAsset, VoicePresetId, VoicesResponse } from "@/types"

export function useVoiceLibrary() {
  const [voices, setVoices] = useState<VoiceAsset[]>([])
  const [defaultVoiceId, setDefaultVoiceId] = useState<string>("")
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("")
  const [voiceStatus, setVoiceStatus] = useState<AsyncStatus>("idle")
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [renameVoice, setRenameVoice] = useState<VoiceAsset | null>(null)
  const [renameName, setRenameName] = useState("")
  const [renameError, setRenameError] = useState<string | null>(null)
  const [voiceActionStatus, setVoiceActionStatus] = useState<AsyncStatus>("idle")
  const [defaultStatus, setDefaultStatus] = useState<AsyncStatus>("idle")
  const voicePlaybackRef = useRef<HTMLAudioElement | null>(null)

  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) ?? null
  const isUpdatingVoice = voiceActionStatus === "loading"
  const isSettingDefault = defaultStatus === "loading"

  useEffect(() => {
    async function loadVoices() {
      setVoiceStatus("loading")
      setVoiceError(null)
      try {
        const payload = await voiceApi.fetchVoices()
        applyVoicePayload(payload)
        setVoiceStatus("success")
      } catch (caught) {
        setVoiceStatus("error")
        setVoiceError(caught instanceof Error ? caught.message : "Unable to load voices.")
      }
    }

    void loadVoices()
  }, [])

  useEffect(() => {
    return () => {
      voicePlaybackRef.current?.pause()
    }
  }, [])

  function applyVoicePayload(payload: VoicesResponse) {
    setVoices(payload.voices)
    setDefaultVoiceId(payload.defaultVoiceId)
    setSelectedVoiceId((current) => {
      if (payload.voices.some((voice) => voice.id === current)) {
        return current
      }
      return payload.defaultVoiceId || payload.voices[0]?.id || ""
    })
  }

  function addSavedVoice(voice: VoiceAsset) {
    setVoices((current) => [...current, voice])
    setSelectedVoiceId(voice.id)
    setDefaultVoiceId((current) => current || voice.id)
  }

  function playVoice(voice: VoiceAsset) {
    setSelectedVoiceId(voice.id)
    setVoiceError(null)
    voicePlaybackRef.current?.pause()
    const audio = new Audio(`/api/voices/${encodeURIComponent(voice.id)}/sample`)
    voicePlaybackRef.current = audio
    void audio.play().catch(() => {
      setVoiceError("Unable to play voice sample.")
    })
  }

  function requestRename(voice: VoiceAsset) {
    setRenameVoice(voice)
    setRenameName(voice.name)
    setRenameError(null)
  }

  function cancelRename() {
    setRenameVoice(null)
    setRenameName("")
    setRenameError(null)
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renameVoice) {
      return
    }
    const nextName = renameName.trim()
    if (!nextName) {
      setRenameError("Voice name is required.")
      return
    }

    setVoiceActionStatus("loading")
    setRenameError(null)
    try {
      const payload = await voiceApi.renameVoice(renameVoice.id, nextName)
      applyVoicePayload(payload)
      setRenameVoice(null)
      setRenameName("")
      setVoiceActionStatus("success")
    } catch (caught) {
      setVoiceActionStatus("error")
      setRenameError(caught instanceof Error ? caught.message : "Unable to rename voice.")
    }
  }

  async function deleteVoice(voice: VoiceAsset) {
    setVoiceActionStatus("loading")
    setVoiceError(null)
    try {
      const payload = await voiceApi.deleteVoice(voice.id)
      applyVoicePayload(payload)
      if (voicePlaybackRef.current) {
        voicePlaybackRef.current.pause()
        voicePlaybackRef.current = null
      }
      setVoiceActionStatus("success")
    } catch (caught) {
      setVoiceActionStatus("error")
      setVoiceError(caught instanceof Error ? caught.message : "Unable to delete voice.")
    }
  }

  async function setDefault(voiceId: string) {
    if (!voiceId || voiceId === defaultVoiceId || isSettingDefault) {
      return
    }
    setDefaultStatus("loading")
    setVoiceError(null)
    try {
      const payload = await voiceApi.setDefaultVoice(voiceId)
      setVoices(payload.voices)
      setDefaultVoiceId(payload.defaultVoiceId)
      setDefaultStatus("success")
    } catch (caught) {
      setDefaultStatus("error")
      setVoiceError(caught instanceof Error ? caught.message : "Unable to set default voice.")
    }
  }

  async function updateVoicePreset(voice: VoiceAsset, voicePresetId: VoicePresetId) {
    if (voice.voicePresetId === voicePresetId) {
      return
    }
    setVoiceActionStatus("loading")
    setVoiceError(null)
    try {
      const payload = await voiceApi.updateVoice(voice.id, { voicePresetId })
      applyVoicePayload(payload)
      setVoiceActionStatus("success")
    } catch (caught) {
      setVoiceActionStatus("error")
      setVoiceError(caught instanceof Error ? caught.message : "Unable to update voice preset.")
    }
  }

  return {
    addSavedVoice,
    cancelRename,
    defaultVoiceId,
    defaultStatus,
    deleteVoice,
    isSettingDefault,
    isUpdatingVoice,
    playVoice,
    renameError,
    renameName,
    renameVoice,
    requestRename,
    selectedVoice,
    selectedVoiceId,
    setDefault,
    setRenameName,
    setSelectedVoiceId,
    setVoiceError,
    submitRename,
    updateVoicePreset,
    voiceActionStatus,
    voiceError,
    voices,
    voiceStatus,
  }
}
