import type { ReactNode } from "react"

import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PlaybackControllerProvider, usePlaybackController } from "./use-playback-controller"
import { useTranscriptPlayback } from "./use-transcript-playback"

const wrapper = ({ children }: { children: ReactNode }) => (
  <PlaybackControllerProvider>{children}</PlaybackControllerProvider>
)

const initialOptions: Parameters<typeof useTranscriptPlayback>[0] = {
  isActive: true,
  jobId: "job-1",
  sourceLabel: "Planning Session",
  sourceUrl: "/api/sample-processing/jobs/job-1/source",
  speakerLabels: { "speaker-1": "Morgan" },
  speakerResultUrls: {
    "speaker-1": "/api/sample-processing/jobs/job-1/speakers/speaker-1/result",
  },
}

function useHarness(options: Parameters<typeof useTranscriptPlayback>[0]) {
  return { controller: usePlaybackController(), playback: useTranscriptPlayback(options) }
}

describe("useTranscriptPlayback", () => {
  it("owns source and speaker previews through the shared controller", () => {
    const { result } = renderHook((options) => useHarness(options), { initialProps: initialOptions, wrapper })

    act(() => {
      expect(result.current.playback.activate("speaker:speaker-1")).toBe(true)
    })
    expect(result.current.controller.snapshot.source).toMatchObject({
      id: "transcript:job-1:speaker:speaker-1",
      kind: "transcriptSource",
    })

    act(() => {
      expect(result.current.playback.playTranscriptItem({ endSeconds: 3, startSeconds: 1 })).toBe(true)
    })
    expect(result.current.controller.snapshot.source).toMatchObject({ id: "transcript:job-1:source" })
    expect(result.current.controller.snapshot.activeRange).toEqual({ endSeconds: 3, startSeconds: 1 })
  })

  it("clears playback when the transcript closes or its active source disappears", () => {
    const { result, rerender } = renderHook((options) => useHarness(options), { initialProps: initialOptions, wrapper })

    act(() => {
      result.current.playback.activate("speaker:speaker-1")
    })
    rerender({ ...initialOptions, speakerResultUrls: {} })
    expect(result.current.controller.snapshot.source).toBeNull()

    rerender(initialOptions)
    act(() => {
      result.current.playback.playTranscriptItem({ endSeconds: 3, startSeconds: 1 })
    })
    rerender({ ...initialOptions, isActive: false })
    expect(result.current.controller.snapshot.source).toBeNull()
  })
})
