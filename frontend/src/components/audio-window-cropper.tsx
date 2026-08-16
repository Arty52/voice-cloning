import { useEffect } from "react"
import { Pause, Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { audioWindowEndSeconds, normalizeAudioWindowRange, type AudioWindow } from "@/lib/audio-window"
import { formatRecordingDuration } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import type { PlaybackController, PlaybackSource } from "@/lib/voice-ui-contracts"
import type { VoiceSampleMode } from "@/types"

type AudioWindowCropperProps = {
  disabled?: boolean
  durationSeconds: number
  maxWindowSeconds: number
  playbackController: PlaybackController
  onActivatePlayback: () => boolean
  onSampleModeChange: (mode: VoiceSampleMode) => void
  onWindowChange: (window: AudioWindow) => void
  recommendedMaxSeconds: number
  recommendedMinSeconds: number
  sampleMode: VoiceSampleMode
  source: PlaybackSource
  window: AudioWindow
}

export function AudioWindowCropper({
  disabled = false,
  durationSeconds,
  maxWindowSeconds,
  playbackController,
  onActivatePlayback,
  onSampleModeChange,
  onWindowChange,
  recommendedMaxSeconds,
  recommendedMinSeconds,
  sampleMode,
  source,
  window,
}: AudioWindowCropperProps) {
  const windowEndSeconds = audioWindowEndSeconds(window)
  const activeSource = playbackController.snapshot.source
  const isCurrentSource = activeSource?.id === source.id && activeSource.url === source.url
  const activeRange = playbackController.snapshot.activeRange
  const isSelectionActive =
    activeRange?.startSeconds === window.startSeconds && activeRange.endSeconds === windowEndSeconds
  const isPreviewing = isCurrentSource && isSelectionActive && playbackController.snapshot.status === "playing"

  useEffect(() => {
    // A changed crop window must never leave the old bounded preview playing.
    // The controller has no intent for updating a running range; cancellation
    // keeps the media and visible selection coherent.
    if (isCurrentSource && activeRange && playbackController.snapshot.status === "playing" && !isSelectionActive) {
      playbackController.dispatch({ type: "pause" })
    }
  }, [activeRange, isCurrentSource, isSelectionActive, playbackController])

  function handlePreviewToggle() {
    if (isPreviewing) {
      playbackController.dispatch({ type: "pause" })
      return
    }
    if (!isCurrentSource && !onActivatePlayback()) {
      return
    }
    playbackController.dispatch({ endSeconds: windowEndSeconds, startSeconds: window.startSeconds, type: "playRange" })
  }

  function handleWindowChange(range: number[]) {
    const nextWindow = normalizeAudioWindowRange(range, durationSeconds, maxWindowSeconds)
    if (
      isPreviewing &&
      (nextWindow.startSeconds !== window.startSeconds || audioWindowEndSeconds(nextWindow) !== windowEndSeconds)
    ) {
      playbackController.dispatch({ type: "pause" })
    }
    onWindowChange(nextWindow)
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Badge>{formatRecordingDuration(window.durationSeconds)} Selected</Badge>
          <Badge>{formatRecordingDuration(maxWindowSeconds)} Max</Badge>
          <Badge>
            {formatRecordingDuration(recommendedMinSeconds)}-{formatRecordingDuration(recommendedMaxSeconds)} Recommended
          </Badge>
        </div>
        <Button disabled={disabled || window.durationSeconds <= 0} onClick={handlePreviewToggle} size="sm" type="button" variant="secondary">
          {isPreviewing ? <Pause aria-hidden="true" data-icon="inline-start" /> : <Play aria-hidden="true" data-icon="inline-start" />}
          {isPreviewing ? "Pause Selection" : "Play Selection"}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 font-mono text-xs tabular-nums text-muted-foreground">
          <span>{formatRecordingDuration(window.startSeconds)}</span>
          <span>{formatRecordingDuration(windowEndSeconds)}</span>
        </div>
        <Slider
          aria-label="Sample Window"
          disabled={disabled}
          max={durationSeconds}
          min={0}
          minStepsBetweenThumbs={1}
          onValueChange={handleWindowChange}
          step={0.1}
          value={[window.startSeconds, windowEndSeconds]}
        />
        <div className="flex items-center justify-between gap-3 font-mono text-xs tabular-nums text-muted-foreground">
          <span>0:00</span>
          <span>{formatRecordingDuration(durationSeconds)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-card/70 p-1" role="group" aria-label="Saved Sample Mode">
        <Button
          aria-pressed={sampleMode === "excerpt"}
          className={cn(sampleMode !== "excerpt" && "bg-transparent")}
          disabled={disabled}
          onClick={() => onSampleModeChange("excerpt")}
          type="button"
          variant={sampleMode === "excerpt" ? "secondary" : "ghost"}
        >
          Save Excerpt
        </Button>
        <Button
          aria-pressed={sampleMode === "sourceWindow"}
          className={cn(sampleMode !== "sourceWindow" && "bg-transparent")}
          disabled={disabled}
          onClick={() => onSampleModeChange("sourceWindow")}
          type="button"
          variant={sampleMode === "sourceWindow" ? "secondary" : "ghost"}
        >
          Keep Original
        </Button>
      </div>
    </div>
  )
}
