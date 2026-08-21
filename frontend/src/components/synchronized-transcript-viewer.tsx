import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual"
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  memo,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
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
  const [focusedSegmentIndex, setFocusedSegmentIndex] = useState<number | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const segmentTimeIndex = useMemo(
    () => buildSegmentTimeIndex(document.segments),
    [document.segments],
  )
  const currentSegmentIndex = useMemo(
    () => segmentIndexAtTime(document.segments, segmentTimeIndex, currentTimeSeconds),
    [currentTimeSeconds, document.segments, segmentTimeIndex],
  )
  const currentSegmentId =
    currentSegmentIndex >= 0 ? document.segments[currentSegmentIndex]?.id ?? null : null
  const shouldVirtualize = document.segments.length > LONG_TRANSCRIPT_THRESHOLD
  const [scrollViewport, setScrollViewport] = useState<HTMLDivElement | null>(null)
  const currentSegmentRef = useRef<HTMLElement | null>(null)
  const onSeekRef = useRef(onSeek)
  useEffect(() => {
    onSeekRef.current = onSeek
  }, [onSeek])
  const handleSeek = useCallback((positionSeconds: number) => onSeekRef.current(positionSeconds), [])
  const handleCurrentElement = useCallback((element: HTMLElement | null) => {
    if (element) {
      currentSegmentRef.current = element
    }
  }, [])
  const getScrollElement = useCallback(() => scrollViewport, [scrollViewport])
  const getSegmentKey = useCallback(
    (index: number) => document.segments[index]?.id ?? index,
    [document.segments],
  )
  const estimateSegmentSize = useCallback(
    (index: number) => estimateSegmentHeight(document.segments[index]),
    [document.segments],
  )
  const extractSegmentRange = useCallback(
    (range: Range) =>
      includePinnedIndex(defaultRangeExtractor(range), focusedSegmentIndex, range.count),
    [focusedSegmentIndex],
  )
  // TanStack Virtual intentionally owns mutable measurement state; this viewer
  // keeps that instance local and memoizes the stable transcript rows itself.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: document.segments.length,
    enabled: shouldVirtualize,
    estimateSize: estimateSegmentSize,
    gap: 8,
    getItemKey: getSegmentKey,
    getScrollElement,
    initialRect: TRANSCRIPT_VIEWPORT_RECT,
    overscan: 4,
    paddingEnd: 12,
    paddingStart: 12,
    rangeExtractor: extractSegmentRange,
  })

  useEffect(() => {
    if (isFollowing && currentSegmentId && !prefersReducedMotion) {
      if (shouldVirtualize && scrollViewport) {
        const frameId = window.requestAnimationFrame(() => {
          rowVirtualizer.scrollToIndex(currentSegmentIndex, { align: "auto" })
        })
        return () => window.cancelAnimationFrame(frameId)
      }
      scrollToSegment(currentSegmentRef.current)
    }
    return undefined
  }, [
    currentSegmentId,
    currentSegmentIndex,
    isFollowing,
    prefersReducedMotion,
    rowVirtualizer,
    scrollViewport,
    shouldVirtualize,
  ])

  function returnToCurrent() {
    setIsFollowing(true)
    if (shouldVirtualize && currentSegmentIndex >= 0) {
      rowVirtualizer.scrollToIndex(currentSegmentIndex, { align: "auto" })
    } else {
      scrollToSegment(currentSegmentRef.current)
    }
  }

  function handleSegmentBlur(index: number, event: FocusEvent<HTMLLIElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setFocusedSegmentIndex((current) => (current === index ? null : current))
    }
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

  function renderSegment(segment: TranscriptSegment) {
    const speaker = speakerById.get(segment.speakerId)
    const speakerIndex = speakerIndexById.get(segment.speakerId) ?? 0
    const position = playbackPosition(segment, currentTimeSeconds)
    const wordBoundary = wordBoundaryAtTime(segment, position, currentTimeSeconds)
    return (
      <TranscriptSegmentRow
        currentWordId={wordBoundary.currentWordId}
        isCanonicalCurrent={segment.id === currentSegmentId}
        isSeekDisabled={isSeekDisabled}
        onCurrentElement={handleCurrentElement}
        onSeek={handleSeek}
        pastWordCount={wordBoundary.pastWordCount}
        position={position}
        segment={segment}
        speakerIndex={speakerIndex}
        speakerLabel={speaker?.label ?? "Unknown Speaker"}
      />
    )
  }

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
        viewportRef={setScrollViewport}
      >
        {shouldVirtualize ? (
          <ol
            aria-label={`${document.segments.length} Transcript Segments`}
            className="relative list-none p-0"
            data-virtualized="true"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const segment = document.segments[virtualRow.index]
              if (!segment) {
                return null
              }
              return (
                <li
                  aria-posinset={virtualRow.index + 1}
                  aria-setsize={document.segments.length}
                  className="absolute left-0 top-0 w-full px-3"
                  data-index={virtualRow.index}
                  key={virtualRow.key}
                  onBlurCapture={(event) => handleSegmentBlur(virtualRow.index, event)}
                  onFocusCapture={() => setFocusedSegmentIndex(virtualRow.index)}
                  ref={rowVirtualizer.measureElement}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {renderSegment(segment)}
                </li>
              )
            })}
          </ol>
        ) : (
          <ol className="flex flex-col gap-2 p-3">
            {document.segments.map((segment) => (
              <li key={segment.id}>{renderSegment(segment)}</li>
            ))}
          </ol>
        )}
      </ScrollArea>
    </div>
  )
}

const MANUAL_SCROLL_KEYS = new Set([" ", "ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp"])
const LONG_TRANSCRIPT_THRESHOLD = 80
const TRANSCRIPT_VIEWPORT_RECT = { height: 320, width: 768 }

function estimateSegmentHeight(segment: TranscriptSegment | undefined) {
  const estimatedLines = Math.max(1, Math.ceil((segment?.text.length ?? 0) / 48))
  return 72 + estimatedLines * 24
}

function includePinnedIndex(indexes: number[], pinnedIndex: number | null, itemCount: number) {
  if (
    pinnedIndex === null ||
    pinnedIndex < 0 ||
    pinnedIndex >= itemCount ||
    indexes.includes(pinnedIndex)
  ) {
    return indexes
  }
  return [...indexes, pinnedIndex].sort((left, right) => left - right)
}

const TranscriptSegmentRow = memo(function TranscriptSegmentRow({
  currentWordId,
  isCanonicalCurrent,
  isSeekDisabled,
  onCurrentElement,
  onSeek,
  pastWordCount,
  position,
  segment,
  speakerIndex,
  speakerLabel,
}: {
  currentWordId: string | null
  isCanonicalCurrent: boolean
  isSeekDisabled: boolean
  onCurrentElement: (element: HTMLElement | null) => void
  onSeek: (positionSeconds: number) => void
  pastWordCount: number
  position: PlaybackPosition
  segment: TranscriptSegment
  speakerIndex: number
  speakerLabel: string
}) {
  return (
    <article
      aria-current={isCanonicalCurrent ? "true" : undefined}
      className={cn(
        "flex flex-col gap-2 rounded-md border border-transparent p-3 transition-colors motion-reduce:transition-none",
        position === "past" && "text-muted-foreground",
        position === "current" && "border-primary/40 bg-primary/10 text-foreground",
        position === "future" && "text-muted-foreground/70",
      )}
      data-playback-state={position}
      ref={isCanonicalCurrent ? onCurrentElement : undefined}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-[var(--speaker-color)]"
          style={speakerStyle(speakerIndex)}
        />
        <span className="text-xs font-medium text-foreground">{speakerLabel}</span>
        <Button
          aria-label={`Seek to ${speakerLabel} at ${formatRecordingDuration(segment.startSeconds)}`}
          className="h-auto px-1.5 py-0.5 font-mono text-xs tabular-nums motion-reduce:transition-none"
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
          {segment.words.map((word, index) => (
            <SynchronizedWord
              isSeekDisabled={isSeekDisabled}
              key={word.id}
              onSeek={onSeek}
              position={word.id === currentWordId ? "current" : index < pastWordCount ? "past" : "future"}
              word={word}
            />
          ))}
        </p>
      ) : (
        <Button
          aria-label={`Seek to transcript segment: ${segment.text}`}
          className="h-auto justify-start whitespace-normal px-1 py-0 text-left font-normal leading-6 motion-reduce:transition-none"
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
  )
})

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
  isSeekDisabled,
  onSeek,
  position,
  word,
}: {
  isSeekDisabled: boolean
  onSeek: (positionSeconds: number) => void
  position: PlaybackPosition
  word: TranscriptWord
}) {
  return (
    <Button
      aria-current={position === "current" ? "true" : undefined}
      aria-label={`Seek to ${word.text} at ${formatRecordingDuration(word.startSeconds)}`}
      className={cn(
        "h-auto px-1 py-0 font-normal leading-6 motion-reduce:transition-none",
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

function wordBoundaryAtTime(
  segment: TranscriptSegment,
  segmentPosition: PlaybackPosition,
  currentTimeSeconds: number | null,
) {
  if (!segment.words?.length || currentTimeSeconds === null || segmentPosition !== "current") {
    return { currentWordId: null, pastWordCount: segmentPosition === "past" ? segment.words?.length ?? 0 : 0 }
  }
  let pastWordCount = 0
  let currentWordId: string | null = null
  for (const word of segment.words) {
    if (currentTimeSeconds >= word.endSeconds) {
      pastWordCount += 1
    } else if (currentTimeSeconds >= word.startSeconds) {
      currentWordId = word.id
      break
    } else {
      break
    }
  }
  return { currentWordId, pastWordCount }
}

function buildSegmentTimeIndex(segments: TranscriptSegment[]) {
  const prefixMaxEndSeconds: number[] = []
  let maxEndSeconds = Number.NEGATIVE_INFINITY
  for (const segment of segments) {
    maxEndSeconds = Math.max(maxEndSeconds, segment.endSeconds)
    prefixMaxEndSeconds.push(maxEndSeconds)
  }
  return prefixMaxEndSeconds
}

function segmentIndexAtTime(
  segments: TranscriptSegment[],
  prefixMaxEndSeconds: number[],
  currentTimeSeconds: number | null,
) {
  if (currentTimeSeconds === null) {
    return -1
  }
  let low = 0
  let high = prefixMaxEndSeconds.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((prefixMaxEndSeconds[middle] ?? Number.NEGATIVE_INFINITY) > currentTimeSeconds) {
      high = middle
    } else {
      low = middle + 1
    }
  }
  for (let index = low; index < segments.length; index += 1) {
    const segment = segments[index]
    if (!segment || segment.startSeconds > currentTimeSeconds) {
      break
    }
    if (currentTimeSeconds < segment.endSeconds) {
      return index
    }
  }
  return -1
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
  const viewport = element?.closest("[data-radix-scroll-area-viewport]")
  if (!(element instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
    return
  }
  const elementRect = element.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  let nextScrollTop = viewport.scrollTop
  if (elementRect.top < viewportRect.top) {
    nextScrollTop -= viewportRect.top - elementRect.top
  } else if (elementRect.bottom > viewportRect.bottom) {
    nextScrollTop += elementRect.bottom - viewportRect.bottom
  }
  if (typeof viewport.scrollTo === "function") {
    viewport.scrollTo({ behavior: "auto", top: nextScrollTop })
  } else {
    viewport.scrollTop = nextScrollTop
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
