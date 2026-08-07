import { Pause, Play, RotateCcw, RotateCw } from "lucide-react"
import { useEffect, useId, useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Loading } from "@/components/ui/loading"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { PlaybackControllerProvider, useHasPlaybackController, usePlaybackOwner } from "@/hooks/use-playback-controller"
import type { PlaybackSourceKind } from "@/lib/voice-ui-contracts"
import { formatRecordingDuration } from "@/lib/formatters"
import { cn } from "@/lib/utils"

type AudioPlayerProps = {
  ariaLabel: string
  className?: string
  sourceKind?: PlaybackSourceKind
  src: string
}

type AudioPlayerControlsProps = AudioPlayerProps & {
  loadOnMount?: boolean
  sourceKind: PlaybackSourceKind
}

const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const
const SEEK_STEP_SECONDS = 10

/**
 * Generic, controller-backed playback controls. Legacy consumers can keep
 * passing `src`; source-specific ownership and product presentation migrate
 * in their own surface PRs.
 */
export function AudioPlayer({ ariaLabel, className, sourceKind = "generatedAudio", src }: AudioPlayerProps) {
  const hasPlaybackController = useHasPlaybackController()

  if (!hasPlaybackController) {
    return (
      <PlaybackControllerProvider>
        <AudioPlayerControls ariaLabel={ariaLabel} className={className} loadOnMount sourceKind={sourceKind} src={src} />
      </PlaybackControllerProvider>
    )
  }

  return <AudioPlayerControls ariaLabel={ariaLabel} className={className} sourceKind={sourceKind} src={src} />
}

function AudioPlayerControls({ ariaLabel, className, loadOnMount = false, sourceKind, src }: AudioPlayerControlsProps) {
  const ownerId = useId()
  const controller = usePlaybackOwner(`generic-audio-player:${ownerId}`)
  const source = useMemo(
    () => ({ id: `generic-audio-player:${ownerId}`, kind: sourceKind, label: ariaLabel, url: src }),
    [ariaLabel, ownerId, sourceKind, src]
  )
  const isCurrentSource =
    controller.snapshot.source?.id === source.id && controller.snapshot.source.url === source.url
  const duration = isCurrentSource ? controller.snapshot.durationSeconds : null
  const currentTime = isCurrentSource ? controller.snapshot.currentTimeSeconds : 0
  const canSeek = duration !== null && duration > 0
  const isPlaying = isCurrentSource && controller.snapshot.status === "playing"
  const isLoading = isCurrentSource && controller.snapshot.loadState === "loading"
  const error = isCurrentSource ? controller.snapshot.error : null
  const displayedDuration = canSeek ? formatRecordingDuration(duration) : "--:--"
  const replaceSource = controller.replaceSource

  useEffect(() => {
    if (loadOnMount) {
      replaceSource(source)
    }
  }, [loadOnMount, replaceSource, source])

  function handlePlayToggle() {
    if (!isCurrentSource) {
      controller.replaceSource(source)
      controller.dispatch({ type: "play" })
      return
    }
    controller.dispatch({ type: isPlaying ? "pause" : "play" })
  }

  function handleSeek(nextTime: number) {
    if (!canSeek) {
      return
    }
    controller.dispatch({ positionSeconds: nextTime, type: "seek" })
  }

  return (
    <div aria-label={ariaLabel} className={cn("flex flex-col gap-2", className)} role="group">
      <div className="flex flex-wrap items-center gap-2">
        <Button aria-label={isPlaying ? "Pause Audio" : "Play Audio"} onClick={handlePlayToggle} size="icon" type="button">
          {isPlaying ? <Pause aria-hidden="true" data-icon="inline-start" /> : <Play aria-hidden="true" data-icon="inline-start" />}
        </Button>
        <Button
          aria-label="Rewind 10 Seconds"
          disabled={!canSeek}
          onClick={() => controller.dispatch({ seconds: -SEEK_STEP_SECONDS, type: "skip" })}
          size="icon"
          type="button"
          variant="secondary"
        >
          <RotateCcw aria-hidden="true" data-icon="inline-start" />
        </Button>
        <Button
          aria-label="Forward 10 Seconds"
          disabled={!canSeek}
          onClick={() => controller.dispatch({ seconds: SEEK_STEP_SECONDS, type: "skip" })}
          size="icon"
          type="button"
          variant="secondary"
        >
          <RotateCw aria-hidden="true" data-icon="inline-start" />
        </Button>
        <Slider
          aria-label="Audio Position"
          className="min-w-0 flex-1"
          disabled={!canSeek}
          max={duration ?? 1}
          min={0}
          onValueChange={([nextTime]) => handleSeek(nextTime)}
          step={0.01}
          value={[canSeek ? Math.min(currentTime, duration) : 0]}
        />
        <Select
          disabled={!isCurrentSource}
          onValueChange={(value) => controller.dispatch({ playbackRate: Number(value), type: "setPlaybackRate" })}
          value={String(controller.snapshot.playbackRate)}
        >
          <SelectTrigger aria-label="Playback Rate" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PLAYBACK_RATES.map((playbackRate) => (
                <SelectItem key={playbackRate} value={String(playbackRate)}>
                  {playbackRate}x
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <output
          aria-label={`Elapsed ${formatRecordingDuration(currentTime)} of ${canSeek ? displayedDuration : "Unknown Duration"}`}
          aria-live="polite"
          className="min-w-20 text-right font-mono text-xs tabular-nums text-muted-foreground"
        >
          {formatRecordingDuration(currentTime)} / {displayedDuration}
        </output>
      </div>
      {isLoading ? <Loading size="sm" text="Loading Audio" variant="secondary" /> : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
