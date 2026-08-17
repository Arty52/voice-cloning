import { useEffect, useId, useMemo } from "react"

import { usePlaybackOwner } from "@/hooks/use-playback-controller"
import { transcriptSourceToPlaybackSource } from "@/lib/voice-ui-adapters"
import type { PlaybackSource } from "@/lib/voice-ui-contracts"
import type { SpeakerTranscriptItem } from "@/types"

type TranscriptPlaybackOptions = {
  isActive: boolean
  jobId: string | null
  sourceLabel: string
  sourceUrl: string | null
  speakerLabels: Record<string, string>
  speakerResultUrls: Record<string, string>
}

/**
 * Feature ownership for Transcript media. The source recording, individual
 * speaker streams, and timed dialogue previews share the app's one player.
 */
export function useTranscriptPlayback({
  isActive,
  jobId,
  sourceLabel,
  sourceUrl,
  speakerLabels,
  speakerResultUrls,
}: TranscriptPlaybackOptions) {
  // A screen can keep more than one Transcript workspace mounted. Ownership
  // must therefore be per workspace rather than per feature, so an inactive
  // workspace cannot clear another workspace's active playback.
  const workspaceId = useId()
  const ownerId = useMemo(() => `transcript:${jobId?.trim() || "workspace"}:${workspaceId}`, [jobId, workspaceId])
  const controller = usePlaybackOwner(ownerId)
  const { replaceSource, snapshot } = controller
  const sources = useMemo(() => {
    const normalizedJobId = jobId?.trim()
    const normalizedSourceUrl = sourceUrl?.trim()
    if (!normalizedJobId || !normalizedSourceUrl) {
      return new Map<string, PlaybackSource>()
    }

    const nextSources = new Map<string, PlaybackSource>()
    const source = transcriptSourceToPlaybackSource({
      documentId: `transcript:${normalizedJobId}`,
      label: `${sourceLabel.trim() || "Transcript"} Original Audio`,
      url: normalizedSourceUrl,
    })
    nextSources.set("source", source)

    Object.entries(speakerResultUrls).forEach(([speakerId, url]) => {
      const normalizedSpeakerId = speakerId.trim()
      const normalizedUrl = url.trim()
      if (!normalizedSpeakerId || !normalizedUrl) {
        return
      }
      nextSources.set(`speaker:${normalizedSpeakerId}`, {
        id: `transcript:${normalizedJobId}:speaker:${normalizedSpeakerId}`,
        kind: "transcriptSource",
        label: `${speakerLabels[normalizedSpeakerId]?.trim() || "Speaker"} Preview`,
        url: normalizedUrl,
      })
    })
    return nextSources
  }, [jobId, sourceLabel, sourceUrl, speakerLabels, speakerResultUrls])

  useEffect(() => {
    if (!isActive) {
      replaceSource(null)
      return
    }
    const activeSource = snapshot.source
    if (!activeSource?.id.startsWith("transcript:")) {
      return
    }
    const currentSource = new Map(
      [...sources.values()].map((source) => [source.id, source]),
    ).get(activeSource.id)
    if (!currentSource) {
      replaceSource(null)
      return
    }
    // Labels can be edited while a range is playing. Updating a label must not
    // reload media and discard that active range; only a changed URL requires
    // replacement.
    if (currentSource.url !== activeSource.url) {
      replaceSource(currentSource)
    }
  }, [isActive, replaceSource, snapshot.source, sources])

  function activate(key: string) {
    const source = sources.get(key)
    if (!isActive || !source) {
      return false
    }
    replaceSource(source)
    return true
  }

  function activateIfNeeded(key: string) {
    const source = sources.get(key)
    if (!isActive || !source) {
      return false
    }
    const activeSource = controller.snapshot.source
    if (activeSource?.id === source.id && activeSource.url === source.url) {
      controller.claimSource(source)
    } else {
      replaceSource(source)
    }
    return true
  }

  function seekTranscript(positionSeconds: number) {
    if (!Number.isFinite(positionSeconds) || !activateIfNeeded("source")) {
      return false
    }
    controller.dispatch({ type: "clearRange" })
    controller.dispatch({ positionSeconds, type: "seek" })
    return true
  }

  function playTranscriptItem(item: Pick<SpeakerTranscriptItem, "startSeconds" | "endSeconds">) {
    if (!activateIfNeeded("source")) {
      return false
    }
    controller.dispatch({
      endSeconds: item.endSeconds,
      startSeconds: item.startSeconds,
      type: "playRange",
    })
    return true
  }

  return { activate, controller, playTranscriptItem, seekTranscript, sources }
}
