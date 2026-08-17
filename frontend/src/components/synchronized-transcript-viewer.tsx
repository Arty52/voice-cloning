import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react"
import { LocateFixed } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatRecordingDuration } from "@/lib/formatters"
import type { TranscriptDocument, TranscriptSegment, TranscriptWord } from "@/lib/voice-ui-contracts"
import { cn } from "@/lib/utils"

type PlaybackPosition = "current" | "future" | "past"

type SynchronizedTranscriptViewerProps = {
  currentTimeSeconds: number | null
  document: TranscriptDocument
  isSeekDisabled?: boolean
  onSeek: (positionSeconds: number) => void
}

/**
 * Read-only transcript presentation. Playback and persistence remain owned by
 * the parent workflow; this component only presents time and emits seek intent.
 */
export function SynchronizedTranscriptViewer({
  currentTimeSeconds,
  document,
  isSeekDisabled = false,
  onSeek,
}: SynchronizedTranscriptViewerProps) {
  const [isFollowing, setIsFollowing] = useState(true)
  const prefersReducedMotion = usePrefersReducedMotion()
  const currentSegmentId = useMemo(
    () => segmentAtTime(document.segments, currentTimeSeconds)?.id ?? null,
    [currentTimeSeconds, document.segments],
  )
  const currentSegmentRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (isFollowing && currentSegmentId && !prefersReducedMotion) {
      scrollToSegment(currentSegmentRef.current)
    }
  }, [currentSegmentId, isFollowing, prefersReducedMotion])

  function returnToCurrent() {
    setIsFollowing(true)
    scrollToSegment(currentSegmentRef.current)
  }

  function handleManualScrollKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.closest("[data-radix-scroll-area-viewport]")) {
      return
    }

    const isActivationTarget = target.closest(
      "button, a[href], input, select, textarea, [role='button'], [role='link']",
    )
    if (event.key === " " && isActivationTarget) {
      return
    }

    if (MANUAL_SCROLL_KEYS.has(event.key)) {
      setIsFollowing(false)
    }
  }

  function handleScrollbarPointer(event: PointerEvent<HTMLDivElement>) {
    const target = event.target
    if (target instanceof HTMLElement && target.closest("[data-slot='scroll-area-scrollbar']")) {
      setIsFollowing(false)
    }
  }

  if (document.segments.length === 0) {
    return <p className="text-sm text-muted-foreground">No transcript dialogue is available.</p>
  }

  const speakerById = new Map(document.speakers.map((speaker) => [speaker.id, speaker]))
  const speakerIndexById = new Map(document.speakers.map((speaker, index) => [speaker.id, index]))

  return (
    <div aria-label="Synchronized Transcript" className="flex flex-col gap-2" role="region">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {isSeekDisabled
            ? "Original audio is unavailable for synchronized seeking."
            : "Select a timestamp or word to seek the original audio."}
        </p>
        {currentSegmentId ? (
          <Button
            disabled={isFollowing && !prefersReducedMotion}
            onClick={returnToCurrent}
            size="sm"
            type="button"
            variant="secondary"
          >
            <LocateFixed aria-hidden="true" data-icon="inline-start" />
            {isFollowing && !prefersReducedMotion ? "Following Current" : "Return To Current"}
          </Button>
        ) : null}
      </div>
      <ScrollArea
        className="h-80 rounded-md border border-border bg-card/70"
        onKeyDown={handleManualScrollKey}
        onPointerDown={handleScrollbarPointer}
        onTouchMove={() => setIsFollowing(false)}
        onWheel={() => setIsFollowing(false)}
      >
        <ol className="flex flex-col gap-2 p-3">
          {document.segments.map((segment) => {
            const speaker = speakerById.get(segment.speakerId)
            const speakerIndex = speakerIndexById.get(segment.speakerId) ?? 0
            const position = playbackPosition(segment, currentTimeSeconds)
            const isCurrent = segment.id === currentSegmentId
            return (
              <li key={segment.id}>
                <article
                  aria-current={isCurrent ? "true" : undefined}
                  className={cn(
                    "flex flex-col gap-2 rounded-md border border-transparent p-3 transition-colors",
                    position === "past" && "text-muted-foreground",
                    position === "current" && "border-primary/40 bg-primary/10 text-foreground",
                    position === "future" && "text-muted-foreground/70",
                  )}
                  data-playback-state={position}
                  ref={isCurrent ? currentSegmentRef : undefined}
                >
                  <header className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full bg-[var(--speaker-color)]"
                      style={speakerStyle(speakerIndex)}
                    />
                    <span className="text-xs font-medium text-foreground">
                      {speaker?.label ?? "Unknown Speaker"}
                    </span>
                    <Button
                      aria-label={`Seek to ${speaker?.label ?? "Unknown Speaker"} at ${formatRecordingDuration(segment.startSeconds)}`}
                      className="h-auto px-1.5 py-0.5 font-mono text-xs tabular-nums"
                      disabled={isSeekDisabled}
                      onClick={() => onSeek(segment.startSeconds)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {formatRecordingDuration(segment.startSeconds)}
                    </Button>
                  </header>
                  {hasCompleteWordAlignment(segment) ? (
                    <p className="flex flex-wrap gap-x-1 gap-y-0.5 text-sm leading-6">
                      {segment.words.map((word) => (
                        <SynchronizedWord
                          currentTimeSeconds={currentTimeSeconds}
                          isSeekDisabled={isSeekDisabled}
                          key={word.id}
                          onSeek={onSeek}
                          word={word}
                        />
                      ))}
                    </p>
                  ) : (
                    <Button
                      aria-label={`Seek to transcript segment: ${segment.text}`}
                      className="h-auto justify-start whitespace-normal px-1 py-0 text-left font-normal leading-6"
                      disabled={isSeekDisabled}
                      onClick={() => onSeek(segment.startSeconds)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {segment.text}
                    </Button>
                  )}
                </article>
              </li>
            )
          })}
        </ol>
      </ScrollArea>
    </div>
  )
}

const MANUAL_SCROLL_KEYS = new Set([" ", "ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp"])

function hasCompleteWordAlignment(
  segment: TranscriptSegment,
): segment is TranscriptSegment & { words: TranscriptWord[] } {
  if (!segment.words?.length) {
    return false
  }
  const alignedText = segment.words.map((word) => word.text).join("")
  return comparableTranscriptText(alignedText) === comparableTranscriptText(segment.text)
}

function comparableTranscriptText(value: string) {
  return value.replace(/\s/g, "")
}

function SynchronizedWord({
  currentTimeSeconds,
  isSeekDisabled,
  onSeek,
  word,
}: {
  currentTimeSeconds: number | null
  isSeekDisabled: boolean
  onSeek: (positionSeconds: number) => void
  word: TranscriptWord
}) {
  const position = playbackPosition(word, currentTimeSeconds)
  return (
    <Button
      aria-current={position === "current" ? "true" : undefined}
      aria-label={`Seek to ${word.text} at ${formatRecordingDuration(word.startSeconds)}`}
      className={cn(
        "h-auto px-1 py-0 font-normal leading-6",
        position === "past" && "text-muted-foreground",
        position === "current" && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
        position === "future" && "text-muted-foreground/70",
      )}
      data-playback-state={position}
      disabled={isSeekDisabled}
      onClick={() => onSeek(word.startSeconds)}
      size="sm"
      type="button"
      variant="ghost"
    >
      {word.text}
    </Button>
  )
}

function segmentAtTime(segments: TranscriptSegment[], currentTimeSeconds: number | null) {
  if (currentTimeSeconds === null) {
    return null
  }
  return segments.find(
    (segment) => currentTimeSeconds >= segment.startSeconds && currentTimeSeconds < segment.endSeconds,
  )
}

function playbackPosition(
  range: Pick<TranscriptSegment | TranscriptWord, "endSeconds" | "startSeconds">,
  currentTimeSeconds: number | null,
): PlaybackPosition {
  if (currentTimeSeconds === null || currentTimeSeconds < range.startSeconds) {
    return "future"
  }
  if (currentTimeSeconds >= range.endSeconds) {
    return "past"
  }
  return "current"
}

function speakerStyle(index: number) {
  return { "--speaker-color": `var(--chart-${(index % 5) + 1})` } as CSSProperties
}

function scrollToSegment(element: HTMLElement | null) {
  if (typeof element?.scrollIntoView === "function") {
    element.scrollIntoView({ block: "nearest", behavior: "auto" })
  }
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  )

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handleChange = () => setPrefersReducedMotion(query.matches)
    handleChange()
    query.addEventListener("change", handleChange)
    return () => query.removeEventListener("change", handleChange)
  }, [])

  return prefersReducedMotion
}
