import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PlaybackControllerProvider, usePlaybackController, usePlaybackOwner } from "./use-playback-controller"
import type { PlaybackSource } from "@/lib/voice-ui-contracts"

const firstSource: PlaybackSource = {
  id: "generated-1",
  kind: "generatedAudio",
  label: "Generated audio",
  url: "/api/generated-audio/1/audio",
}

const secondSource: PlaybackSource = {
  id: "preview-1",
  kind: "voicePreview",
  label: "Voice preview",
  url: "/api/voices/preview/audio",
}

function deferred<T>() {
  let reject: (reason?: unknown) => void = () => undefined
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <PlaybackControllerProvider>{children}</PlaybackControllerProvider>
}

function Owner({ ownerId, source }: { ownerId: string; source: PlaybackSource }) {
  const controller = usePlaybackOwner(ownerId)
  return (
    <>
      <button onClick={() => controller.replaceSource(source)}>{ownerId}</button>
      <button onClick={() => controller.dispatch({ source, type: "replaceSource" })}>Dispatch {ownerId}</button>
      <button onClick={() => controller.replaceSource(null)}>Clear {ownerId}</button>
    </>
  )
}

function ActiveSource() {
  const controller = usePlaybackController()
  return <output data-testid="active-source">{controller.snapshot.source?.id ?? "none"}</output>
}

describe("usePlaybackController", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("uses one media element for loading, playback, seek, skip, and source replacement", async () => {
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media element.")
    }
    Object.defineProperty(audio, "duration", { configurable: true, value: 30 })

    act(() => result.current.dispatch({ source: firstSource, type: "replaceSource" }))
    expect(result.current.snapshot).toMatchObject({ loadState: "loading", source: firstSource, status: "paused" })
    expect(audio.src).toContain(firstSource.url)

    fireEvent.loadedMetadata(audio)
    expect(result.current.snapshot).toMatchObject({ durationSeconds: 30, loadState: "ready" })

    act(() => result.current.dispatch({ type: "play" }))
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    fireEvent.play(audio)
    fireEvent.timeUpdate(audio, { target: { currentTime: 10 } })
    expect(result.current.snapshot).toMatchObject({ currentTimeSeconds: 10, status: "playing" })

    act(() => result.current.dispatch({ seconds: 30, type: "skip" }))
    expect(audio.currentTime).toBe(30)
    expect(result.current.snapshot.currentTimeSeconds).toBe(30)

    act(() => result.current.dispatch({ positionSeconds: -4, type: "seek" }))
    expect(audio.currentTime).toBe(0)

    act(() => result.current.dispatch({ source: secondSource, type: "replaceSource" }))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(result.current.snapshot).toMatchObject({ currentTimeSeconds: 0, source: secondSource, status: "paused" })
  })

  it("uses current media time for rapid skips and plays a replacement selected in the same event", async () => {
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media element.")
    }
    Object.defineProperty(audio, "duration", { configurable: true, value: 60 })
    Object.defineProperty(audio, "currentTime", { configurable: true, value: 10, writable: true })

    act(() => {
      result.current.dispatch({ source: firstSource, type: "replaceSource" })
      result.current.dispatch({ type: "play" })
    })
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    expect(result.current.snapshot.source).toEqual(firstSource)

    Object.defineProperty(audio, "currentTime", { configurable: true, value: 10, writable: true })
    act(() => {
      result.current.dispatch({ seconds: 5, type: "skip" })
      result.current.dispatch({ seconds: 5, type: "skip" })
    })
    expect(audio.currentTime).toBe(20)
  })

  it("keeps the requested playback rate in the controlled snapshot", () => {
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media element.")
    }

    act(() => result.current.dispatch({ playbackRate: 1.5, type: "setPlaybackRate" }))
    expect(audio.playbackRate).toBe(1.5)
    expect(result.current.snapshot.playbackRate).toBe(1.5)

    act(() => result.current.dispatch({ playbackRate: 8, type: "setPlaybackRate" }))
    expect(audio.playbackRate).toBe(2)
    expect(result.current.snapshot.playbackRate).toBe(2)

    act(() => result.current.dispatch({ type: "clear" }))
    expect(audio.playbackRate).toBe(1)
    expect(result.current.snapshot.playbackRate).toBe(1)
  })

  it("loads a replacement once when replacement and play happen in the same event", async () => {
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    vi.mocked(HTMLMediaElement.prototype.load).mockClear()

    act(() => {
      result.current.dispatch({ source: firstSource, type: "replaceSource" })
      result.current.dispatch({ type: "play" })
    })

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1)
    expect(result.current.snapshot.source).toEqual(firstSource)
  })

  it("pauses at the end of a bounded segment", async () => {
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media element.")
    }
    Object.defineProperty(audio, "duration", { configurable: true, value: 30 })

    act(() => result.current.dispatch({ source: firstSource, type: "replaceSource" }))
    fireEvent.loadedMetadata(audio)
    act(() => result.current.dispatch({ endSeconds: 12, startSeconds: 8, type: "playRange" }))
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    expect(audio.currentTime).toBe(8)

    Object.defineProperty(audio, "currentTime", { configurable: true, value: 12, writable: true })
    fireEvent.timeUpdate(audio)
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(result.current.snapshot).toMatchObject({ currentTimeSeconds: 12, status: "paused" })
  })

  it("reports autoplay rejection and media loading errors as controlled state", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("Blocked"))
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media element.")
    }

    act(() => result.current.dispatch({ source: firstSource, type: "replaceSource" }))
    act(() => result.current.dispatch({ type: "play" }))
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ error: "Unable to play this audio in the browser.", status: "error" }))

    fireEvent.error(audio)
    expect(result.current.snapshot).toMatchObject({ error: "Unable to load this audio.", loadState: "error", status: "error" })

    fireEvent.pause(audio)
    expect(result.current.snapshot).toMatchObject({ error: "Unable to load this audio.", status: "error" })
  })

  it("ignores a stale play rejection after replacement or clear", async () => {
    const firstPlay = deferred<void>()
    const secondPlay = deferred<void>()
    vi.mocked(HTMLMediaElement.prototype.play)
      .mockReturnValueOnce(firstPlay.promise)
      .mockReturnValueOnce(secondPlay.promise)
    const { result } = renderHook(() => usePlaybackController(), { wrapper })

    act(() => {
      result.current.dispatch({ source: firstSource, type: "replaceSource" })
      result.current.dispatch({ type: "play" })
      result.current.dispatch({ source: secondSource, type: "replaceSource" })
    })
    await act(async () => firstPlay.reject(new Error("Blocked")))
    expect(result.current.snapshot).toMatchObject({ error: null, source: secondSource, status: "paused" })

    act(() => result.current.dispatch({ type: "play" }))
    act(() => result.current.dispatch({ type: "clear" }))
    await act(async () => secondPlay.reject(new Error("Blocked")))
    expect(result.current.snapshot).toEqual({
      currentTimeSeconds: 0,
      durationSeconds: null,
      error: null,
      loadState: "idle",
      playbackRate: 1,
      source: null,
      status: "idle",
    })
  })

  it("invalidates an earlier play request after pause and retry on the same source", async () => {
    const firstPlay = deferred<void>()
    const retryPlay = deferred<void>()
    vi.mocked(HTMLMediaElement.prototype.play)
      .mockReturnValueOnce(firstPlay.promise)
      .mockReturnValueOnce(retryPlay.promise)
    const { result } = renderHook(() => usePlaybackController(), { wrapper })

    act(() => {
      result.current.dispatch({ source: firstSource, type: "replaceSource" })
      result.current.dispatch({ type: "play" })
      result.current.dispatch({ type: "pause" })
      result.current.dispatch({ type: "play" })
    })
    await act(async () => firstPlay.reject(new Error("Blocked")))
    expect(result.current.snapshot).toMatchObject({ error: null, source: firstSource, status: "paused" })

    await act(async () => retryPlay.reject(new Error("Blocked")))
    expect(result.current.snapshot).toMatchObject({
      error: "Unable to play this audio in the browser.",
      source: firstSource,
      status: "error",
    })
  })

  it("does not publish playing after a queued play is cleared", async () => {
    const queuedPlay = deferred<void>()
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(queuedPlay.promise)
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media element.")
    }

    act(() => {
      result.current.dispatch({ source: firstSource, type: "replaceSource" })
      result.current.dispatch({ type: "play" })
      result.current.dispatch({ type: "clear" })
    })
    fireEvent.play(audio)
    await act(async () => queuedPlay.resolve())
    expect(result.current.snapshot).toEqual({
      currentTimeSeconds: 0,
      durationSeconds: null,
      error: null,
      loadState: "idle",
      playbackRate: 1,
      source: null,
      status: "idle",
    })
  })

  it("keeps the empty snapshot after clear despite late media events", () => {
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media element.")
    }

    act(() => {
      result.current.dispatch({ source: firstSource, type: "replaceSource" })
      result.current.dispatch({ type: "clear" })
    })
    Object.defineProperty(audio, "duration", { configurable: true, value: 45 })
    Object.defineProperty(audio, "currentTime", { configurable: true, value: 12, writable: true })
    fireEvent.canPlay(audio)
    fireEvent.durationChange(audio)
    fireEvent.loadedMetadata(audio)
    fireEvent.play(audio)
    fireEvent.timeUpdate(audio)
    fireEvent.pause(audio)
    fireEvent.ended(audio)

    expect(audio.getAttribute("src")).toBeNull()
    expect(result.current.snapshot).toEqual({
      currentTimeSeconds: 0,
      durationSeconds: null,
      error: null,
      loadState: "idle",
      playbackRate: 1,
      source: null,
      status: "idle",
    })
  })

  it("resets and reloads when a new source identity reuses the same URL", () => {
    const sourceWithSharedUrl = { ...secondSource, id: "preview-2", url: firstSource.url }
    const { result } = renderHook(() => usePlaybackController(), { wrapper })
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared media element.")
    }
    Object.defineProperty(audio, "duration", { configurable: true, value: 30 })

    act(() => result.current.dispatch({ source: firstSource, type: "replaceSource" }))
    fireEvent.loadedMetadata(audio)
    act(() => result.current.dispatch({ source: sourceWithSharedUrl, type: "replaceSource" }))

    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2)
    expect(result.current.snapshot).toMatchObject({
      currentTimeSeconds: 0,
      durationSeconds: null,
      loadState: "loading",
      source: sourceWithSharedUrl,
    })
  })

  it("clears active playback when its owning workflow unmounts without clearing another owner", () => {
    const { rerender } = render(
      <PlaybackControllerProvider>
        <ActiveSource />
        <Owner key="prepare-audio" ownerId="prepare-audio" source={firstSource} />
        <Owner key="transcript" ownerId="transcript" source={secondSource} />
      </PlaybackControllerProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "prepare-audio" }))
    fireEvent.click(screen.getByRole("button", { name: "transcript" }))
    expect(screen.getByTestId("active-source")).toHaveTextContent(secondSource.id)
    fireEvent.click(screen.getByRole("button", { name: "Clear prepare-audio" }))
    expect(screen.getByTestId("active-source")).toHaveTextContent(secondSource.id)

    rerender(
      <PlaybackControllerProvider>
        <ActiveSource />
        <Owner key="transcript" ownerId="transcript" source={secondSource} />
      </PlaybackControllerProvider>
    )
    expect(screen.getByTestId("active-source")).toHaveTextContent(secondSource.id)

    rerender(
      <PlaybackControllerProvider>
        <ActiveSource />
      </PlaybackControllerProvider>
    )
    expect(screen.getByTestId("active-source")).toHaveTextContent("none")
  })

  it("clears an owner source dispatched through the standard playback controller on unmount", () => {
    const { rerender } = render(
      <PlaybackControllerProvider>
        <ActiveSource />
        <Owner ownerId="transcript" source={secondSource} />
      </PlaybackControllerProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Dispatch transcript" }))
    expect(screen.getByTestId("active-source")).toHaveTextContent(secondSource.id)

    rerender(
      <PlaybackControllerProvider>
        <ActiveSource />
      </PlaybackControllerProvider>
    )
    expect(screen.getByTestId("active-source")).toHaveTextContent("none")
  })
})
