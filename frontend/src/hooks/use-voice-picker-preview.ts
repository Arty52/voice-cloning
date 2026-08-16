import { useEffect, useMemo } from "react"

import { usePlaybackOwner } from "@/hooks/use-playback-controller"
import { voiceAssetToPickerOption, voiceAssetToPreviewSource } from "@/lib/voice-ui-adapters"
import type { VoicePickerOption } from "@/lib/voice-ui-contracts"
import type { VoiceAsset } from "@/types"

type VoicePickerPreviewOptions = {
  isActive: boolean
  voices: VoiceAsset[]
}

type ActiveVoicePreview = {
  error: string | null
  isLoading: boolean
  isPlaying: boolean
  voiceId: string
}

/**
 * Feature ownership for every Speech Input voice-picker preview. Picker
 * surfaces select voices independently, while this hook keeps their preview
 * audio mutually exclusive through the app's shared playback controller.
 */
export function useVoicePickerPreview({ isActive, voices }: VoicePickerPreviewOptions) {
  const controller = usePlaybackOwner("voice-picker")
  const { dispatch, replaceSource, snapshot } = controller
  const options = useMemo<VoicePickerOption[]>(
    () =>
      voices.map((voice) => {
        const preview = voiceAssetToPreviewSource(voice)
        const option = voiceAssetToPickerOption(voice, { previewUrl: preview?.url ?? null })
        return {
          ...option,
          preview: option.preview
            ? { ...option.preview, id: `voice-picker:${option.id}:preview` }
            : null,
        }
      }),
    [voices],
  )
  const optionsById = useMemo(() => new Map(options.map((option) => [option.id, option])), [options])

  useEffect(() => {
    if (!isActive) {
      replaceSource(null)
    }
  }, [isActive, replaceSource])

  useEffect(() => {
    const source = snapshot.source
    if (
      source?.kind === "voicePreview" &&
      source.id.startsWith("voice-picker:") &&
      !options.some((option) => option.preview?.id === source.id)
    ) {
      replaceSource(null)
    }
  }, [options, replaceSource, snapshot.source])

  const activePreview = useMemo<ActiveVoicePreview | null>(() => {
    const source = snapshot.source
    if (source?.kind !== "voicePreview" || !source.id.startsWith("voice-picker:")) {
      return null
    }
    const voiceId = source.id.slice("voice-picker:".length, -":preview".length)
    return {
      error: snapshot.error,
      isLoading: snapshot.loadState === "loading",
      isPlaying: snapshot.status === "playing",
      voiceId,
    }
  }, [snapshot.error, snapshot.loadState, snapshot.source, snapshot.status])

  function togglePreview(voiceId: string) {
    const source = optionsById.get(voiceId)?.preview
    if (!isActive || !source) {
      return false
    }
    if (snapshot.source?.id === source.id) {
      dispatch({ type: "toggle" })
      return true
    }
    replaceSource(source)
    dispatch({ type: "play" })
    return true
  }

  function clearPreview() {
    const source = snapshot.source
    if (source?.kind === "voicePreview" && source.id.startsWith("voice-picker:")) {
      replaceSource(null)
    }
  }

  return { activePreview, clearPreview, options, togglePreview }
}
