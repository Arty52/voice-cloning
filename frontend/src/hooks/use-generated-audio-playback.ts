import { useEffect, useMemo } from "react"

import { usePlaybackOwner } from "@/hooks/use-playback-controller"
import { generatedAudioToPlaybackSource, generatedSegmentToPlaybackSource } from "@/lib/voice-ui-adapters"
import type { PlaybackSource } from "@/lib/voice-ui-contracts"
import type { GeneratedResult } from "@/types"

type GeneratedAudioPlaybackOptions = {
  items: GeneratedResult[]
  latestItem: GeneratedResult | null
  segmentResultUrls: Record<string, string>
}

/**
 * Feature ownership for generated-audio playback. Archive rows, the latest
 * result, and dialogue segments share one controller without owning media.
 */
export function useGeneratedAudioPlayback({ items, latestItem, segmentResultUrls }: GeneratedAudioPlaybackOptions) {
  const controller = usePlaybackOwner("generated-audio")
  const { replaceSource, snapshot } = controller
  const itemSources = useMemo(
    () =>
      new Map(
        items.concat(latestItem ? [latestItem] : []).map((item) => [item.id, generatedAudioToPlaybackSource(item)]),
      ),
    [items, latestItem],
  )
  const segmentSources = useMemo(() => {
    if (!latestItem?.multiVoiceMetadata) {
      return new Map<string, PlaybackSource>()
    }
    return new Map(
      latestItem.multiVoiceMetadata.segments.flatMap((segment) => {
        const source = generatedSegmentToPlaybackSource({
          generatedAudioId: latestItem.id,
          label: `Generated Segment ${segment.index + 1} Playback`,
          segmentId: segment.id,
          url: segmentResultUrls[segment.id] ?? "",
        })
        return source ? [[segment.id, source] as const] : []
      }),
    )
  }, [latestItem, segmentResultUrls])

  useEffect(() => {
    const activeSource = snapshot.source
    if (activeSource?.kind !== "generatedAudio" || !activeSource.id.startsWith("generated-audio:")) {
      return
    }
    const currentSource = [...itemSources.values(), ...segmentSources.values()].find(
      (source) => source?.id === activeSource.id,
    )
    if (!currentSource) {
      replaceSource(null)
      return
    }
    if (currentSource.url !== activeSource.url) {
      replaceSource(currentSource)
    }
  }, [itemSources, replaceSource, segmentSources, snapshot.source])

  function activateItem(itemId: string) {
    const source = itemSources.get(itemId)
    if (!source) {
      return false
    }
    replaceSource(source)
    return true
  }

  function activateSegment(segmentId: string) {
    const source = segmentSources.get(segmentId)
    if (!source) {
      return false
    }
    replaceSource(source)
    return true
  }

  return {
    activateItem,
    activateSegment,
    controller,
    itemSources,
    segmentSources,
  }
}
