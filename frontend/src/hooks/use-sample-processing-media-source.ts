import { useMemo, useRef, useState } from "react"

import * as api from "@/lib/api"
import type {
  AsyncStatus,
  SampleProcessingMediaSource,
  SampleProcessingMediaSourceChapter,
} from "@/types"

export type SampleProcessingManualRange = {
  startSeconds: number
  endSeconds: number
}

export type SampleProcessingMediaSourceRange = {
  startSeconds: number
  endSeconds: number
  label?: string | null
}

export type SampleProcessingMediaPreview = {
  label: string
  src: string
} | null

const DEFAULT_MANUAL_RANGE_SECONDS = 120
const FALLBACK_MANUAL_DURATION_SECONDS = 300
const PREVIEW_DURATION_SECONDS = 90

export function useSampleProcessingMediaSource() {
  const [source, setSource] = useState<SampleProcessingMediaSource | null>(null)
  const [status, setStatus] = useState<AsyncStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([])
  const [manualRange, setManualRange] = useState<SampleProcessingManualRange>({
    startSeconds: 0,
    endSeconds: DEFAULT_MANUAL_RANGE_SECONDS,
  })
  const [preview, setPreview] = useState<SampleProcessingMediaPreview>(null)
  const requestIdRef = useRef(0)
  const sourceIdRef = useRef<string | null>(null)

  const hasChapters = (source?.chapters.length ?? 0) > 0
  const manualDurationSeconds = manualDurationForSource(source)
  const selectedChapters = useMemo(() => {
    if (!source) {
      return []
    }
    const selectedIds = new Set(selectedChapterIds)
    return source.chapters.filter((chapter) => selectedIds.has(chapter.id))
  }, [selectedChapterIds, source])
  const selectedRanges = useMemo<SampleProcessingMediaSourceRange[]>(() => {
    if (!source) {
      return []
    }
    if (source.chapters.length > 0) {
      return selectedChapters.map(chapterToRange)
    }
    return [
      {
        startSeconds: manualRange.startSeconds,
        endSeconds: manualRange.endSeconds,
        label: "Selected Range",
      },
    ]
  }, [manualRange.endSeconds, manualRange.startSeconds, selectedChapters, source])
  const selectedDurationSeconds = selectedRanges.reduce(
    (totalSeconds, range) => totalSeconds + Math.max(0, range.endSeconds - range.startSeconds),
    0
  )

  async function uploadSource(file: File | null) {
    const previousSourceId = sourceIdRef.current
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setPreview(null)
    if (!file) {
      sourceIdRef.current = null
      setSource(null)
      setSelectedChapterIds([])
      setStatus("idle")
      setError(null)
      void cleanupSource(previousSourceId)
      return
    }

    sourceIdRef.current = null
    setSource(null)
    setSelectedChapterIds([])
    setStatus("loading")
    setError(null)
    void cleanupSource(previousSourceId)

    try {
      const payload = await api.uploadSampleProcessingSource(file)
      if (requestIdRef.current !== requestId) {
        void cleanupSource(payload.source.id)
        return
      }
      sourceIdRef.current = payload.source.id
      setSource(payload.source)
      setSelectedChapterIds([])
      setManualRange(defaultManualRange(payload.source))
      setStatus("success")
    } catch (caught) {
      if (requestIdRef.current !== requestId) {
        return
      }
      setStatus("error")
      setError(caught instanceof Error ? caught.message : "Unable to inspect this media source.")
    }
  }

  function setChapterSelected(chapterId: string, selected: boolean) {
    setPreview(null)
    setSelectedChapterIds((current) => {
      const ids = new Set(current)
      if (selected) {
        ids.add(chapterId)
      } else {
        ids.delete(chapterId)
      }
      return Array.from(ids)
    })
  }

  function setManualRangeSeconds(range: SampleProcessingManualRange) {
    setPreview(null)
    setManualRange(normalizeManualRange(range, manualDurationSeconds))
  }

  function showPreview(range: SampleProcessingMediaSourceRange, label: string) {
    if (!source) {
      setPreview(null)
      return
    }
    const durationSeconds = Math.min(PREVIEW_DURATION_SECONDS, Math.max(0.1, range.endSeconds - range.startSeconds))
    setPreview({
      label,
      src: api.sampleProcessingSourcePreviewUrl(source.id, range.startSeconds, durationSeconds),
    })
  }

  async function deleteCurrentSource() {
    const sourceId = sourceIdRef.current
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    sourceIdRef.current = null
    setSource(null)
    setSelectedChapterIds([])
    setPreview(null)
    setStatus("idle")
    setError(null)
    await cleanupSource(sourceId)
  }

  return {
    deleteCurrentSource,
    error,
    hasChapters,
    manualDurationSeconds,
    manualRange,
    preview,
    selectedChapterIds,
    selectedChapters,
    selectedDurationSeconds,
    selectedRanges,
    setChapterSelected,
    setManualRangeSeconds,
    showPreview,
    source,
    status,
    uploadSource,
  }
}

function chapterToRange(chapter: SampleProcessingMediaSourceChapter): SampleProcessingMediaSourceRange {
  return {
    startSeconds: chapter.startSeconds,
    endSeconds: chapter.endSeconds,
    label: chapter.title,
  }
}

function defaultManualRange(source: SampleProcessingMediaSource): SampleProcessingManualRange {
  const durationSeconds = manualDurationForSource(source)
  return {
    startSeconds: 0,
    endSeconds: Math.min(durationSeconds, DEFAULT_MANUAL_RANGE_SECONDS),
  }
}

function manualDurationForSource(source: SampleProcessingMediaSource | null) {
  return Math.max(1, source?.durationSeconds ?? FALLBACK_MANUAL_DURATION_SECONDS)
}

function normalizeManualRange(range: SampleProcessingManualRange, durationSeconds: number) {
  const startSeconds = clampSeconds(range.startSeconds, 0, durationSeconds)
  const endSeconds = clampSeconds(range.endSeconds, 0, durationSeconds)
  if (endSeconds <= startSeconds) {
    return {
      startSeconds: Math.max(0, Math.min(startSeconds, durationSeconds - 1)),
      endSeconds: Math.min(durationSeconds, Math.max(startSeconds + 1, endSeconds)),
    }
  }
  return { startSeconds, endSeconds }
}

function clampSeconds(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

async function cleanupSource(sourceId: string | null) {
  if (!sourceId) {
    return
  }
  try {
    await api.deleteSampleProcessingSource(sourceId)
  } catch {
    // Cleanup is best effort; the next source/job should not be blocked by stale staged media.
  }
}
