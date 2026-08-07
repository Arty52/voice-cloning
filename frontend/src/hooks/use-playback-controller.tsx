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
  source: null,
  status: "idle",
}

type PlaybackRange = { endSeconds: number; startSeconds: number }

type PlaybackControllerContextValue = {
  clearOwner: (ownerId: string) => void
  controller: PlaybackController
  replaceOwnerSource: (ownerId: string, source: PlaybackSource | null) => void
}

type PlaybackOwnerController = PlaybackController & {
  replaceSource: (source: PlaybackSource | null) => void
}

const PlaybackControllerContext = createContext<PlaybackControllerContextValue | null>(null)

/**
 * Owns Voice Studio's single active HTML media element. Feature hooks retain
 * URL creation and revocation; this controller never revokes a source URL.
 */
export function PlaybackControllerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeOwnerIdRef = useRef<string | null>(null)
  const rangeRef = useRef<PlaybackRange | null>(null)
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(EMPTY_SNAPSHOT)

  const updateSnapshot = useCallback((update: (current: PlaybackSnapshot) => PlaybackSnapshot) => {
    setSnapshot((current) => update(current))
  }, [])

  const clear = useCallback(() => {
    const audio = audioRef.current
    rangeRef.current = null
    activeOwnerIdRef.current = null
    if (audio) {
      audio.pause()
    }
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
      audio.pause()
      setSnapshot({
        currentTimeSeconds: 0,
        durationSeconds: null,
        error: null,
        loadState: "loading",
        source,
        status: "paused",
      })
    },
    [clear]
  )

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const play = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !snapshot.source) {
      return
    }
    updateSnapshot((current) => ({ ...current, error: null }))
    try {
      await audio.play()
    } catch {
      rangeRef.current = null
      updateSnapshot((current) => ({
        ...current,
        error: "Unable to play this audio in the browser.",
        status: "error",
      }))
    }
  }, [snapshot.source, updateSnapshot])

  const seek = useCallback(
    (positionSeconds: number) => {
      const audio = audioRef.current
      if (!audio || !snapshot.source || !Number.isFinite(positionSeconds)) {
        return
      }
      const duration = snapshot.durationSeconds
      const nextPosition = duration === null ? Math.max(0, positionSeconds) : clamp(positionSeconds, 0, duration)
      audio.currentTime = nextPosition
      updateSnapshot((current) => ({ ...current, currentTimeSeconds: nextPosition }))
    },
    [snapshot.durationSeconds, snapshot.source, updateSnapshot]
  )

  const playRange = useCallback(
    (startSeconds: number, endSeconds: number) => {
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
        return
      }
      const duration = snapshot.durationSeconds
      const start = duration === null ? Math.max(0, startSeconds) : clamp(startSeconds, 0, duration)
      const end = duration === null ? Math.max(0, endSeconds) : clamp(endSeconds, 0, duration)
      if (end <= start) {
        return
      }
      rangeRef.current = { endSeconds: end, startSeconds: start }
      seek(start)
      void play()
    },
    [play, seek, snapshot.durationSeconds]
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
        case "skip":
          seek(snapshot.currentTimeSeconds + intent.seconds)
          return
        case "toggle":
          if (snapshot.status === "playing") {
            pause()
          } else {
            void play()
          }
          return
        case "playRange":
          playRange(intent.startSeconds, intent.endSeconds)
      }
    },
    [clear, pause, play, playRange, replaceSource, seek, snapshot.currentTimeSeconds, snapshot.status]
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
    audioRef.current?.load()
  }, [snapshot.source?.url])

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
          updateSnapshot((current) =>
            current.loadState === "loading" ? { ...current, loadState: "ready" } : current
          )
        }
        onDurationChange={(event) => {
          const duration = event.currentTarget.duration
          updateSnapshot((current) => ({
            ...current,
            durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
          }))
        }}
        onEnded={() => {
          rangeRef.current = null
          updateSnapshot((current) => ({ ...current, status: "ended" }))
        }}
        onError={() => {
          rangeRef.current = null
          updateSnapshot((current) => ({
            ...current,
            error: "Unable to load this audio.",
            loadState: "error",
            status: "error",
          }))
        }}
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration
          updateSnapshot((current) => ({
            ...current,
            durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
            loadState: "ready",
          }))
        }}
        onPause={() =>
          updateSnapshot((current) =>
            current.status === "ended" || !current.source ? current : { ...current, status: "paused" }
          )
        }
        onPlay={() => updateSnapshot((current) => ({ ...current, status: "playing" }))}
        onTimeUpdate={(event) => {
          const currentTimeSeconds = event.currentTarget.currentTime
          const range = rangeRef.current
          if (range && currentTimeSeconds >= range.endSeconds) {
            event.currentTarget.currentTime = range.endSeconds
            event.currentTarget.pause()
            rangeRef.current = null
            updateSnapshot((current) => ({ ...current, currentTimeSeconds: range.endSeconds, status: "paused" }))
            return
          }
          updateSnapshot((current) => ({ ...current, currentTimeSeconds }))
        }}
        preload="metadata"
        ref={audioRef}
        src={snapshot.source?.url}
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

  return useMemo(
    () => ({
      ...controller,
      replaceSource: (source: PlaybackSource | null) => replaceOwnerSource(ownerId, source),
    }),
    [controller, ownerId, replaceOwnerSource]
  )
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}
