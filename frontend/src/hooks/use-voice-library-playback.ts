import { useEffect, useMemo } from "react"

import { usePlaybackOwner } from "@/hooks/use-playback-controller"
import { voiceAssetToPreviewSource } from "@/lib/voice-ui-adapters"
import type { VoiceAsset } from "@/types"

type VoiceLibraryPlaybackOptions = {
  isActive: boolean
  voices: VoiceAsset[]
}

type ActiveVoicePreview = {
  error: string | null
  isLoading: boolean
  label: string
  voiceId: string
}

/**
 * Feature ownership for Voice Library previews. The panel receives controlled
 * sources and callbacks; it never coordinates browser media lifecycle.
 */
export function useVoiceLibraryPlayback({ isActive, voices }: VoiceLibraryPlaybackOptions) {
  const controller = usePlaybackOwner("voice-library")
  const { dispatch, replaceSource, snapshot } = controller
  const previewSources = useMemo(
    () => new Map(voices.map((voice) => [voice.id, voiceAssetToPreviewSource(voice)])),
    [voices]
  )

  useEffect(() => {
    if (!isActive) {
      replaceSource(null)
    }
  }, [isActive, replaceSource])

  useEffect(() => {
    const activeSource = snapshot.source
    if (
      activeSource?.kind === "voicePreview" &&
      activeSource.id.startsWith("voice-library:") &&
      !Array.from(previewSources.values()).some((source) => source?.id === activeSource.id)
    ) {
      replaceSource(null)
    }
  }, [previewSources, replaceSource, snapshot.source])

  const activePreview = useMemo<ActiveVoicePreview | null>(() => {
    const source = snapshot.source
    if (source?.kind !== "voicePreview" || !source.id.startsWith("voice-library:")) {
      return null
    }
    const voiceId = source.id.slice("voice-library:".length, -":preview".length)
    return {
      error: snapshot.error,
      isLoading: snapshot.loadState === "loading",
      label: source.label,
      voiceId,
    }
  }, [snapshot.error, snapshot.loadState, snapshot.source])

  function activateVoice(voiceId: string) {
    const source = previewSources.get(voiceId)
    if (!source) {
      return false
    }
    replaceSource(source)
    return true
  }

  function playVoice(voiceId: string) {
    if (!activateVoice(voiceId)) {
      return
    }
    dispatch({ type: "play" })
  }

  return {
    activateVoice,
    activePreview,
    controller,
    playVoice,
    previewSources,
  }
}
