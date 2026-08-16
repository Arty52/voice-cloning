import { useEffect, useMemo } from "react"

import { usePlaybackOwner } from "@/hooks/use-playback-controller"
import type { PlaybackSource } from "@/lib/voice-ui-contracts"
import type { VoiceAsset } from "@/types"

type PrepareAudioPreview = { label: string; src: string }

type PrepareAudioPlaybackOptions = {
  candidateResultUrls: Record<string, string>
  isActive: boolean
  jobId: string | null
  processedResultUrl: string | null
  sourcePreview: PrepareAudioPreview | null
  voices: VoiceAsset[]
}

/**
 * Feature ownership for Prepare Audio media. Source inspection, processed
 * samples, candidates, and compact saved-voice previews share one controller
 * while this workflow is visible.
 */
export function usePrepareAudioPlayback({
  candidateResultUrls,
  isActive,
  jobId,
  processedResultUrl,
  sourcePreview,
  voices,
}: PrepareAudioPlaybackOptions) {
  const controller = usePlaybackOwner("prepare-audio")
  const { replaceSource, snapshot } = controller
  const sources = useMemo(() => {
    const sourceMap = new Map<string, PlaybackSource>()
    const jobKey = jobId?.trim() || "pending"
    const add = (key: string, label: string, url: string | null | undefined, kind: PlaybackSource["kind"]) => {
      const normalizedUrl = url?.trim()
      if (!normalizedUrl) {
        return
      }
      sourceMap.set(key, {
        id: `prepare-audio:${jobKey}:${key}`,
        kind,
        label: label.trim() || "Prepare Audio Playback",
        url: normalizedUrl,
      })
    }

    add("source-preview", `${sourcePreview?.label ?? "Source"} Preview`, sourcePreview?.src, "preparedAudio")
    add("processed-result", "Processed Sample Preview", processedResultUrl, "preparedAudio")
    Object.entries(candidateResultUrls).forEach(([candidateId, url]) => {
      add(`candidate:${candidateId}`, `Prepared Candidate ${candidateId} Preview`, url, "preparedAudio")
    })
    voices.forEach((voice) => {
      const voiceId = voice.id.trim()
      if (voiceId) {
        add(`voice:${voiceId}`, `${voice.name.trim() || "Voice"} Preview`, `/api/voices/${encodeURIComponent(voiceId)}/sample`, "voicePreview")
      }
    })
    return sourceMap
  }, [candidateResultUrls, jobId, processedResultUrl, sourcePreview?.label, sourcePreview?.src, voices])

  useEffect(() => {
    if (!isActive) {
      replaceSource(null)
    }
  }, [isActive, replaceSource])

  useEffect(() => {
    const activeSource = snapshot.source
    if (!activeSource?.id.startsWith("prepare-audio:")) {
      return
    }
    const currentSource = [...sources.values()].find((source) => source.id === activeSource.id)
    if (!currentSource) {
      replaceSource(null)
      return
    }
    if (currentSource.url !== activeSource.url || currentSource.label !== activeSource.label) {
      replaceSource(currentSource)
    }
  }, [replaceSource, snapshot.source, sources])

  function activate(key: string) {
    const source = sources.get(key)
    if (!source) {
      return false
    }
    replaceSource(source)
    return true
  }

  return { activate, controller, sources }
}
