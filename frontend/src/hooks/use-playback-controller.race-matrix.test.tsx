import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PlaybackControllerProvider, usePlaybackController, usePlaybackOwner } from "./use-playback-controller"
import type { PlaybackSource } from "@/lib/voice-ui-contracts"

const source: PlaybackSource = {
  id: "generated-1",
  kind: "generatedAudio",
  label: "Generated audio",
  url: "/api/generated-audio/1/audio",
}

const replacement: PlaybackSource = {
  id: "preview-1",
  kind: "voicePreview",
  label: "Voice preview",
  url: "/api/voices/preview/audio",
}

function deferred<T>() {
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((_, rejectPromise) => {
    reject = rejectPromise
  })
  return { promise, reject }
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <PlaybackControllerProvider>{children}</PlaybackControllerProvider>
}

function Owner() {
  const controller = usePlaybackOwner("transcript")
  return <button onClick={() => controller.dispatch({ source: replacement, type: "replaceSource" })}>Dispatch Source</button>
}

function ActiveSource() {
  return <output data-testid="active-source">{usePlaybackController().snapshot.source?.id ?? "none"}</output>
}

function expectEmptySnapshot(snapshot: ReturnType<typeof usePlaybackController>["snapshot"]) {
  expect(snapshot).toEqual({
    activeRange: null,
    currentTimeSeconds: 0,
    durationSeconds: null,
    error: null,
    loadState: "idle",
    playbackRate: 1,
    source: null,
    status: "idle",
  })
}

describe("Playback controller race matrix", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each([
    {
      name: "replacement then immediate play uses one load and the replacement source",
      run: async () => {
        const { result } = renderHook(() => usePlaybackController(), { wrapper })
        vi.mocked(HTMLMediaElement.prototype.load).mockClear()

        act(() => {
          result.current.dispatch({ source, type: "replaceSource" })
          result.current.dispatch({ type: "play" })
        })

        await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce())
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalledOnce()
        expect(result.current.snapshot.source).toEqual(source)
      },
    },
    {
      name: "pause and retry invalidates an earlier rejected play request",
      run: async () => {
        const firstPlay = deferred<void>()
        const retryPlay = deferred<void>()
        vi.mocked(HTMLMediaElement.prototype.play)
          .mockReturnValueOnce(firstPlay.promise)
          .mockReturnValueOnce(retryPlay.promise)
        const { result } = renderHook(() => usePlaybackController(), { wrapper })

        act(() => {
          result.current.dispatch({ source, type: "replaceSource" })
          result.current.dispatch({ type: "play" })
          result.current.dispatch({ type: "pause" })
          result.current.dispatch({ type: "play" })
        })
        await act(async () => firstPlay.reject(new Error("Blocked")))
        expect(result.current.snapshot.error).toBeNull()
        await act(async () => retryPlay.reject(new Error("Blocked")))
        expect(result.current.snapshot.status).toBe("error")
      },
    },
    {
      name: "clear during loading ignores queued metadata and time events",
      run: () => {
        const { result } = renderHook(() => usePlaybackController(), { wrapper })
        const audio = document.querySelector("audio")
        if (!audio) {
          throw new Error("Expected the shared media element.")
        }
        act(() => {
          result.current.dispatch({ source, type: "replaceSource" })
          result.current.dispatch({ type: "clear" })
        })
        Object.defineProperty(audio, "duration", { configurable: true, value: 45 })
        Object.defineProperty(audio, "currentTime", { configurable: true, value: 12, writable: true })
        fireEvent.loadedMetadata(audio)
        fireEvent.durationChange(audio)
        fireEvent.timeUpdate(audio)
        expectEmptySnapshot(result.current.snapshot)
      },
    },
    {
      name: "a different source identity sharing a URL resets the lifecycle",
      run: () => {
        const sameUrl = { ...replacement, id: "preview-2", url: source.url }
        const { result } = renderHook(() => usePlaybackController(), { wrapper })
        const audio = document.querySelector("audio")
        if (!audio) {
          throw new Error("Expected the shared media element.")
        }
        Object.defineProperty(audio, "duration", { configurable: true, value: 30 })
        act(() => result.current.dispatch({ source, type: "replaceSource" }))
        fireEvent.loadedMetadata(audio)
        act(() => result.current.dispatch({ source: sameUrl, type: "replaceSource" }))
        expect(result.current.snapshot).toMatchObject({
          currentTimeSeconds: 0,
          durationSeconds: null,
          loadState: "loading",
          source: sameUrl,
        })
      },
    },
    {
      name: "owner dispatch source is cleared when that owner unmounts",
      run: () => {
        const { rerender } = render(
          <PlaybackControllerProvider>
            <ActiveSource />
            <Owner />
          </PlaybackControllerProvider>
        )
        fireEvent.click(screen.getByRole("button", { name: "Dispatch Source" }))
        expect(screen.getByTestId("active-source")).toHaveTextContent(replacement.id)
        rerender(
          <PlaybackControllerProvider>
            <ActiveSource />
          </PlaybackControllerProvider>
        )
        expect(screen.getByTestId("active-source")).toHaveTextContent("none")
      },
    },
    {
      name: "error followed by pause preserves the error state",
      run: () => {
        const { result } = renderHook(() => usePlaybackController(), { wrapper })
        const audio = document.querySelector("audio")
        if (!audio) {
          throw new Error("Expected the shared media element.")
        }
        act(() => result.current.dispatch({ source, type: "replaceSource" }))
        fireEvent.error(audio)
        fireEvent.pause(audio)
        expect(result.current.snapshot).toMatchObject({ error: "Unable to load this audio.", status: "error" })
      },
    },
  ])("$name", async ({ run }) => {
    await run()
  })
})
