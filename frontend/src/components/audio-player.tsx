import { Pause, Play, RotateCcw, RotateCw } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { formatRecordingDuration } from "@/lib/formatters"
import { cn } from "@/lib/utils"

type AudioPlayerProps = {
  ariaLabel: string
  className?: string
  src: string
}

const SEEK_STEP_SECONDS = 10

export function AudioPlayer({ ariaLabel, className, src }: AudioPlayerProps) {
  return <AudioPlayerSource ariaLabel={ariaLabel} className={className} key={src} src={src} />
}

function AudioPlayerSource({ ariaLabel, className, src }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSeek = Number.isFinite(duration) && duration > 0
  const progressMax = canSeek ? duration : 0

  async function handlePlayToggle() {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    setError(null)
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      return
    }

    try {
      await audio.play()
      setIsPlaying(true)
    } catch {
      setIsPlaying(false)
      setError("Unable to play this audio in the browser.")
    }
  }

  function handleSeek(nextTime: number) {
    const audio = audioRef.current
    if (!audio || !canSeek) {
      return
    }
    const clampedTime = Math.min(Math.max(nextTime, 0), duration)
    audio.currentTime = clampedTime
    setCurrentTime(clampedTime)
  }

  return (
    <div aria-label={ariaLabel} className={cn("flex flex-col gap-2", className)} role="group">
      <audio
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0)
        }}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          setIsPlaying(false)
          setError("Unable to load this audio.")
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0)
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        preload="metadata"
        ref={audioRef}
        src={src}
      />
      <div className="flex items-center gap-2">
        <Button aria-label={isPlaying ? "Pause Audio" : "Play Audio"} onClick={handlePlayToggle} size="icon" type="button">
          {isPlaying ? <Pause aria-hidden="true" data-icon="inline-start" /> : <Play aria-hidden="true" data-icon="inline-start" />}
        </Button>
        <Button
          aria-label="Rewind 10 Seconds"
          disabled={!canSeek}
          onClick={() => handleSeek(currentTime - SEEK_STEP_SECONDS)}
          size="icon"
          type="button"
          variant="secondary"
        >
          <RotateCcw aria-hidden="true" data-icon="inline-start" />
        </Button>
        <Button
          aria-label="Forward 10 Seconds"
          disabled={!canSeek}
          onClick={() => handleSeek(currentTime + SEEK_STEP_SECONDS)}
          size="icon"
          type="button"
          variant="secondary"
        >
          <RotateCw aria-hidden="true" data-icon="inline-start" />
        </Button>
        <div className="min-w-0 flex-1">
          <input
            aria-label="Audio Position"
            className="block h-2 w-full accent-primary disabled:opacity-50"
            disabled={!canSeek}
            max={progressMax}
            min={0}
            onChange={(event) => handleSeek(Number(event.currentTarget.value))}
            step="0.01"
            type="range"
            value={canSeek ? Math.min(currentTime, duration) : 0}
          />
        </div>
        <div className="min-w-20 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {formatRecordingDuration(currentTime)} / {formatRecordingDuration(duration)}
        </div>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
