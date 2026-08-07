import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import type {
  PlaybackController,
  PlaybackIntent,
  PlaybackSnapshot,
  PlaybackSource,
} from "@/lib/voice-ui-contracts"

const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  currentTimeSeconds: 0,
  durationSeconds: null,
  error: null,
  loadState: "idle",
  playbackRate: 1,
  source: null,
  status: "idle",
}

type PlaybackRange = { endSeconds: number; startSeconds: number }
type PlaybackRequest = { request: number; sourceGeneration: number; sourceId: string }

type PlaybackControllerContextValue = {
  clearOwner: (ownerId: string) => void
  controller: PlaybackController
  replaceOwnerSource: (ownerId: string, source: PlaybackSource | null) => void
}

type PlaybackOwnerController = PlaybackController & {
  replaceSource: (source: PlaybackSource | null) => void
}

const PlaybackControllerContext = createContext<PlaybackControllerContextValue | null>(null)

function hasCurrentSource(snapshot: PlaybackSnapshot): snapshot is PlaybackSnapshot & { source: PlaybackSource } {
  return snapshot.source !== null
}

function isCurrentPlaybackRequest({ request, sourceGeneration, sourceId }: PlaybackRequest, {
  playRequest,
  snapshot,
  sourceGeneration: currentSourceGeneration,
}: {
  playRequest: number
  snapshot: PlaybackSnapshot
  sourceGeneration: number
}) {
  return (
    request === playRequest &&
    sourceGeneration === currentSourceGeneration &&
    snapshot.source?.id === sourceId
  )
}

/**
 * Owns Voice Studio's single active HTML media element. Feature hooks retain
 * URL creation and revocation; this controller never revokes a source URL.
 */
export function PlaybackControllerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeOwnerIdRef = useRef<string | null>(null)
  const rangeRef = useRef<PlaybackRange | null>(null)
  const playRequestRef = useRef(0)
  const sourceGenerationRef = useRef(0)
  const snapshotRef = useRef<PlaybackSnapshot>(EMPTY_SNAPSHOT)
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(EMPTY_SNAPSHOT)

  const updateSnapshot = useCallback((update: (current: PlaybackSnapshot) => PlaybackSnapshot) => {
    const nextSnapshot = update(snapshotRef.current)
    snapshotRef.current = nextSnapshot
    setSnapshot(nextSnapshot)
  }, [])

  const updateCurrentSource = useCallback(
    (update: (current: PlaybackSnapshot & { source: PlaybackSource }) => PlaybackSnapshot) => {
      updateSnapshot((current) => (hasCurrentSource(current) ? update(current) : current))
    },
    [updateSnapshot]
  )

  const clear = useCallback(() => {
    const audio = audioRef.current
    rangeRef.current = null
    activeOwnerIdRef.current = null
    playRequestRef.current += 1
    sourceGenerationRef.current += 1
    if (audio) {
      audio.pause()
      audio.playbackRate = EMPTY_SNAPSHOT.playbackRate
      audio.removeAttribute("src")
      audio.load()
    }
    snapshotRef.current = EMPTY_SNAPSHOT
    setSnapshot(EMPTY_SNAPSHOT)
  }, [])

  const replaceSource = useCallback(
    (source: PlaybackSource | null, ownerId: string | null) => {
      if (!source) {
        clear()
        return
      }
      const audio = audioRef.current
      if (!audio) {
        return
      }
      rangeRef.current = null
      activeOwnerIdRef.current = ownerId
      playRequestRef.current += 1
      sourceGenerationRef.current += 1
      audio.pause()
      audio.playbackRate = snapshotRef.current.playbackRate
      audio.src = source.url
      audio.load()
      const nextSnapshot: PlaybackSnapshot = {
        currentTimeSeconds: 0,
        durationSeconds: null,
        error: null,
        loadState: "loading",
        playbackRate: snapshotRef.current.playbackRate,
        source,
        status: "paused",
      }
      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
    },
    [clear]
  )

  const pause = useCallback(() => {
    playRequestRef.current += 1
    audioRef.current?.pause()
  }, [])

  const play = useCallback(async () => {
    const audio = audioRef.current
    const source = snapshotRef.current.source
    if (!audio || !source) {
      return
    }
    const request: PlaybackRequest = {
      request: playRequestRef.current + 1,
      sourceGeneration: sourceGenerationRef.current,
      sourceId: source.id,
    }
    playRequestRef.current = request.request
    updateSnapshot((current) => ({ ...current, error: null }))
    try {
      await audio.play()
    } catch {
      if (
        isCurrentPlaybackRequest(request, {
          playRequest: playRequestRef.current,
          snapshot: snapshotRef.current,
          sourceGeneration: sourceGenerationRef.current,
        })
      ) {
        rangeRef.current = null
        updateSnapshot((current) => ({
          ...current,
          error: "Unable to play this audio in the browser.",
          status: "error",
        }))
      }
    }
  }, [updateSnapshot])

  const seek = useCallback(
    (positionSeconds: number) => {
      const audio = audioRef.current
      const currentSnapshot = snapshotRef.current
      if (!audio || !currentSnapshot.source || !Number.isFinite(positionSeconds)) {
        return
      }
      const duration = currentSnapshot.durationSeconds
      const nextPosition = duration === null ? Math.max(0, positionSeconds) : clamp(positionSeconds, 0, duration)
      audio.currentTime = nextPosition
      updateSnapshot((current) => ({ ...current, currentTimeSeconds: nextPosition }))
    },
    [updateSnapshot]
  )

  const setPlaybackRate = useCallback(
    (playbackRate: number) => {
      if (!Number.isFinite(playbackRate)) {
        return
      }
      const nextPlaybackRate = clamp(playbackRate, 0.5, 2)
      const audio = audioRef.current
      if (audio) {
        audio.playbackRate = nextPlaybackRate
      }
      updateSnapshot((current) => ({ ...current, playbackRate: nextPlaybackRate }))
    },
    [updateSnapshot]
  )

  const playRange = useCallback(
    (startSeconds: number, endSeconds: number) => {
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
        return
      }
      const duration = snapshotRef.current.durationSeconds
      const start = duration === null ? Math.max(0, startSeconds) : clamp(startSeconds, 0, duration)
      const end = duration === null ? Math.max(0, endSeconds) : clamp(endSeconds, 0, duration)
      if (end <= start) {
        return
      }
      rangeRef.current = { endSeconds: end, startSeconds: start }
      seek(start)
      void play()
    },
    [play, seek]
  )

  const dispatch = useCallback(
    (intent: PlaybackIntent) => {
      switch (intent.type) {
        case "clear":
          clear()
          return
        case "pause":
          pause()
          return
        case "play":
          void play()
          return
        case "replaceSource":
          replaceSource(intent.source, null)
          return
        case "seek":
          seek(intent.positionSeconds)
          return
        case "setPlaybackRate":
          setPlaybackRate(intent.playbackRate)
          return
        case "skip":
          seek((audioRef.current?.currentTime ?? snapshotRef.current.currentTimeSeconds) + intent.seconds)
          return
        case "toggle":
          if (audioRef.current?.paused === false) {
            pause()
          } else {
            void play()
          }
          return
        case "playRange":
          playRange(intent.startSeconds, intent.endSeconds)
      }
    },
    [clear, pause, play, playRange, replaceSource, seek, setPlaybackRate]
  )

  const clearOwner = useCallback(
    (ownerId: string) => {
      if (activeOwnerIdRef.current === ownerId) {
        clear()
      }
    },
    [clear]
  )

  const replaceOwnerSource = useCallback(
    (ownerId: string, source: PlaybackSource | null) => {
      if (source) {
        replaceSource(source, ownerId)
      } else {
        clearOwner(ownerId)
      }
    },
    [clearOwner, replaceSource]
  )

  useEffect(() => {
    const audio = audioRef.current
    return () => {
      if (audio) {
        audio.pause()
        audio.removeAttribute("src")
        audio.load()
      }
    }
  }, [])

  const value = useMemo<PlaybackControllerContextValue>(
    () => ({ clearOwner, controller: { dispatch, snapshot }, replaceOwnerSource }),
    [clearOwner, dispatch, replaceOwnerSource, snapshot]
  )

  return (
    <PlaybackControllerContext.Provider value={value}>
      <audio
        aria-hidden="true"
        onCanPlay={() =>
          updateCurrentSource((current) =>
            current.loadState === "loading" ? { ...current, loadState: "ready" } : current
          )
        }
        onDurationChange={(event) => {
          const duration = event.currentTarget.duration
          updateCurrentSource((current) => ({
            ...current,
            durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
          }))
        }}
        onEnded={() => {
          rangeRef.current = null
          updateCurrentSource((current) => ({ ...current, status: "ended" }))
        }}
        onError={() => {
          rangeRef.current = null
          updateCurrentSource((current) => ({
            ...current,
            error: "Unable to load this audio.",
            loadState: "error",
            status: "error",
          }))
        }}
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration
          updateCurrentSource((current) => ({
            ...current,
            durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
            loadState: "ready",
          }))
        }}
        onPause={() =>
          updateCurrentSource((current) =>
            current.status === "ended" || current.status === "error"
              ? current
              : { ...current, status: "paused" }
          )
        }
        onPlay={() => updateCurrentSource((current) => ({ ...current, status: "playing" }))}
        onRateChange={(event) => {
          const playbackRate = event.currentTarget.playbackRate
          if (Number.isFinite(playbackRate)) {
            updateCurrentSource((current) => ({ ...current, playbackRate: clamp(playbackRate, 0.5, 2) }))
          }
        }}
        onTimeUpdate={(event) => {
          const currentTimeSeconds = event.currentTarget.currentTime
          const range = rangeRef.current
          if (!hasCurrentSource(snapshotRef.current)) {
            return
          }
          if (range && currentTimeSeconds >= range.endSeconds) {
            event.currentTarget.currentTime = range.endSeconds
            event.currentTarget.pause()
            rangeRef.current = null
            updateCurrentSource((current) => ({ ...current, currentTimeSeconds: range.endSeconds, status: "paused" }))
            return
          }
          updateCurrentSource((current) => ({ ...current, currentTimeSeconds }))
        }}
        preload="metadata"
        ref={audioRef}
      />
      {children}
    </PlaybackControllerContext.Provider>
  )
}

// This module intentionally exports the provider and its colocated consumer hooks.
// eslint-disable-next-line react-refresh/only-export-components
export function usePlaybackController(): PlaybackController {
  const context = useContext(PlaybackControllerContext)
  if (!context) {
    throw new Error("usePlaybackController must be used inside PlaybackControllerProvider.")
  }
  return context.controller
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHasPlaybackController() {
  return useContext(PlaybackControllerContext) !== null
}

/**
 * Registers a workflow as the source owner. Replacing or unmounting that
 * workflow clears only its active playback source, leaving other owners alone.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePlaybackOwner(ownerId: string): PlaybackOwnerController {
  const context = useContext(PlaybackControllerContext)
  if (!context) {
    throw new Error("usePlaybackOwner must be used inside PlaybackControllerProvider.")
  }
  const { clearOwner, controller, replaceOwnerSource } = context

  useEffect(() => () => clearOwner(ownerId), [clearOwner, ownerId])

  const replaceSource = useCallback(
    (source: PlaybackSource | null) => replaceOwnerSource(ownerId, source),
    [ownerId, replaceOwnerSource]
  )

  return useMemo(
    () => ({
      ...controller,
      dispatch: (intent: PlaybackIntent) => {
        if (intent.type === "replaceSource") {
          replaceOwnerSource(ownerId, intent.source)
          return
        }
        controller.dispatch(intent)
      },
      replaceSource,
    }),
    [controller, ownerId, replaceOwnerSource, replaceSource]
  )
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}
