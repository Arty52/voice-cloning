import { useEffect, useMemo } from "react"

import { usePlaybackOwner } from "@/hooks/use-playback-controller"
import type { PlaybackSource } from "@/lib/voice-ui-contracts"

type AddVoicePlaybackOptions = {
  isActive: boolean
  sourceUrl: string | null
  sourceLabel: string
}

export type AddVoicePlayback = ReturnType<typeof useAddVoicePlayback>

/**
 * Feature ownership for the Add Voice upload and crop previews. Both surfaces
 * intentionally share the same source so only one preview can play at once.
 */
export function useAddVoicePlayback({ isActive, sourceLabel, sourceUrl }: AddVoicePlaybackOptions) {
  const controller = usePlaybackOwner("add-voice")
  const { replaceSource, snapshot } = controller
  const source = useMemo<PlaybackSource | null>(() => {
    const url = sourceUrl?.trim()
    if (!url) {
      return null
    }
    return {
      id: "add-voice:sample-preview",
      kind: "voicePreview",
      label: sourceLabel.trim() || "Voice Sample Preview",
      url,
    }
  }, [sourceLabel, sourceUrl])

  useEffect(() => {
    if (!isActive || !source) {
      replaceSource(null)
      return
    }
    const activeSource = snapshot.source
    if (activeSource?.id !== source.id) {
      return
    }
    if (activeSource.url !== source.url || activeSource.label !== source.label) {
      replaceSource(source)
    }
  }, [isActive, replaceSource, snapshot.source, source])

  function activate() {
    if (!source || !isActive) {
      return false
    }
    replaceSource(source)
    return true
  }

  return { activate, controller, source }
}
