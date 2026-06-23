import { act, renderHook, waitFor } from "@testing-library/react"
import type { FormEvent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_VOICE_PRESET_ID } from "@/lib/voice-presets"
import type {
  SampleProcessingJobResponse,
  SampleProcessingOptionsResponse,
  SpeakerSeparationResult,
  VoiceAsset,
} from "@/types"

import { useSampleProcessing } from "./use-sample-processing"

const sourceVoice: VoiceAsset = {
  id: "default",
  name: "Default voice",
  filePath: "default/default-voice.mp3",
  contentType: "audio/mpeg",
  sha256: "default-hash",
  source: "default",
  createdAt: "2026-05-28T00:00:00+00:00",
  sampleMode: "excerpt",
  windowStartSeconds: null,
  windowDurationSeconds: null,
  sourceFilePath: null,
  sourceContentType: null,
  sourceSha256: null,
  voicePresetId: "animatedDialogue",
  processingSteps: [],
}

const sampleProcessingOptions: SampleProcessingOptionsResponse = {
  engine: "pyannote-community-1+faster-whisper",
  operations: [
    {
      id: "separateSpeakers",
      label: "Separate Speakers",
      description: "Split speakers.",
      enabled: true,
      defaultProcessingPresetId: null,
      processingPresets: [],
    },
    {
      id: "isolateVoice",
      label: "Isolate Voice",
      description: "Isolate voice.",
      enabled: true,
      defaultProcessingPresetId: "balanced",
      processingPresets: [
        {
          id: "balanced",
          label: "Balanced",
          description: "Balanced isolation.",
        },
      ],
    },
  ],
}

const speakerSeparationResult: SpeakerSeparationResult = {
  kind: "speakerSeparation",
  speakers: [
    {
      id: "speaker-1",
      label: "Speaker 1",
      assignedName: "Morgan",
      transcriptItemIds: ["item-1"],
      result: {
        path: "job-1/speaker-1.wav",
        filename: "speaker-1.wav",
        contentType: "audio/wav",
        sha256: "speaker-1-hash",
      },
    },
    {
      id: "speaker-2",
      label: "Speaker 2",
      assignedName: null,
      transcriptItemIds: ["item-2"],
      result: {
        path: "job-1/speaker-2.wav",
        filename: "speaker-2.wav",
        contentType: "audio/wav",
        sha256: "speaker-2-hash",
      },
    },
  ],
  transcript: {
    items: [
      {
        id: "item-1",
        text: "Hello.",
        startSeconds: 0,
        endSeconds: 1,
        speakerId: "speaker-1",
      },
      {
        id: "item-2",
        text: "Hi.",
        startSeconds: 1.2,
        endSeconds: 2,
        speakerId: "speaker-2",
      },
    ],
  },
}

const speakerJob: SampleProcessingJobResponse = {
  job: {
    id: "job-1",
    operationId: "separateSpeakers",
    operationLabel: "Separate Speakers",
    status: "success",
    processingPresetId: null,
    processingPresetLabel: null,
    sourceName: "Default voice",
    sourceFilename: "source.wav",
    sourceContentType: "audio/wav",
    sourceSha256: "source-hash",
    sourcePreference: "original",
    engine: "pyannote-community-1+faster-whisper",
    createdAt: "2026-06-23T00:00:00+00:00",
    updatedAt: "2026-06-23T00:00:01+00:00",
    error: null,
    result: speakerSeparationResult,
  },
}

const reassignedSpeakerJob: SampleProcessingJobResponse = {
  job: {
    ...speakerJob.job,
    result: {
      ...speakerSeparationResult,
      speakers: [
        {
          ...speakerSeparationResult.speakers[0],
          transcriptItemIds: ["item-1", "item-2"],
        },
        {
          ...speakerSeparationResult.speakers[1],
          transcriptItemIds: [],
        },
      ],
      transcript: {
        items: [
          speakerSeparationResult.transcript.items[0],
          {
            ...speakerSeparationResult.transcript.items[1],
            speakerId: "speaker-1",
          },
        ],
      },
    },
  },
}

function okJson(payload: unknown, status = 200) {
  return Promise.resolve(jsonResponse(payload, status))
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function formEvent() {
  return { preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>
}

describe("useSampleProcessing speaker separation state", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("initializes speaker state and patches transcript assignments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(sampleProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(speakerJob, 202)
        }
        if (path === "/api/sample-processing/jobs/job-1/speaker-assignments" && init?.method === "PATCH") {
          return okJson(reassignedSpeakerJob)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    await act(async () => {
      result.current.setOperationId("separateSpeakers")
    })
    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    expect(result.current.isSpeakerSeparationJob).toBe(true)
    expect(result.current.resultUrl).toBeNull()
    expect(result.current.speakerSourceUrl).toBe("/api/sample-processing/jobs/job-1/source")
    expect(result.current.speakerResultUrls).toEqual({
      "speaker-1": "/api/sample-processing/jobs/job-1/speakers/speaker-1/result",
      "speaker-2": "/api/sample-processing/jobs/job-1/speakers/speaker-2/result",
    })
    expect(result.current.speakerNameAssignments).toEqual({
      "speaker-1": "Morgan",
      "speaker-2": "Speaker 2",
    })
    expect(result.current.speakerVoicePresetIds).toEqual({
      "speaker-1": "animatedDialogue",
      "speaker-2": "animatedDialogue",
    })
    expect(result.current.selectedSpeakerIds).toEqual(["speaker-1", "speaker-2"])

    await act(async () => {
      await result.current.assignTranscriptItemsToSpeaker(["item-2"], "speaker-1")
    })

    const patchCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url) === "/api/sample-processing/jobs/job-1/speaker-assignments" && init?.method === "PATCH")
    expect(JSON.parse(patchCall?.[1]?.body as string)).toEqual({
      transcriptAssignments: [{ itemId: "item-2", speakerId: "speaker-1" }],
    })
    expect(result.current.assignmentStatus).toBe("success")
    expect(result.current.selectedTranscriptItemIds).toEqual(["item-2"])
    expect(result.current.speakerSeparationResult?.transcript.items[1].speakerId).toBe("speaker-1")
  })

  it("ignores stale speaker assignment responses after reset", async () => {
    let resolvePatch: (response: Response) => void = () => undefined
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(sampleProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(speakerJob, 202)
        }
        if (path === "/api/sample-processing/jobs/job-1/speaker-assignments" && init?.method === "PATCH") {
          return patchResponse
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    await act(async () => {
      result.current.setOperationId("separateSpeakers")
    })
    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    let assignmentPromise: Promise<void> = Promise.resolve()
    act(() => {
      assignmentPromise = result.current.assignTranscriptItemsToSpeaker(["item-2"], "speaker-1")
    })
    await waitFor(() => expect(result.current.assignmentStatus).toBe("loading"))

    act(() => {
      result.current.setOperationId("isolateVoice")
    })
    await act(async () => {
      resolvePatch(jsonResponse(reassignedSpeakerJob))
      await assignmentPromise
    })

    expect(result.current.speakerSeparationResult).toBeNull()
    expect(result.current.assignmentStatus).toBe("idle")
    expect(result.current.selectedTranscriptItemIds).toEqual([])
  })

  it("saves selected speakers and clears stale speaker state on a new run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(sampleProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(speakerJob, 202)
        }
        if (path === "/api/sample-processing/jobs/job-1/speaker-voices" && init?.method === "POST") {
          return okJson({ voices: [{ ...sourceVoice, id: "morgan", name: "Morgan" }] }, 201)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    await act(async () => {
      result.current.setOperationId("separateSpeakers")
      await result.current.handleStartProcessing(formEvent())
    })
    act(() => {
      result.current.handleSpeakerSaveSelectionChange("speaker-2", false)
      result.current.handleSpeakerVoicePresetChange("speaker-1", DEFAULT_VOICE_PRESET_ID)
    })
    await act(async () => {
      await result.current.handleSaveSpeakerVoices()
    })

    const saveCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url) === "/api/sample-processing/jobs/job-1/speaker-voices" && init?.method === "POST")
    expect(JSON.parse(saveCall?.[1]?.body as string)).toEqual({
      voices: [{ speakerId: "speaker-1", name: "Morgan", voicePresetId: "standardNarration" }],
    })
    expect(onVoiceSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "morgan", name: "Morgan" }))
    expect(result.current.speakerSaveStatus).toBe("success")

    act(() => {
      result.current.setOperationId("isolateVoice")
    })

    expect(result.current.speakerSeparationResult).toBeNull()
    expect(result.current.selectedSpeakerIds).toEqual([])
    expect(result.current.speakerNameAssignments).toEqual({})
  })
})
