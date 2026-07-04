import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  GeneratedAudioScriptSnapshot,
  GeneratedResult,
  SpeechJob,
  VoiceAsset,
  VoiceProvider,
} from "@/types"

import { useMultiVoiceSpeechGeneration } from "./use-multi-voice-speech-generation"

type GenerateMultiVoiceSpeechInput = Parameters<
  ReturnType<typeof useMultiVoiceSpeechGeneration>["generateSpeech"]
>[0]

const defaultVoice: VoiceAsset = {
  id: "narrator",
  name: "Narrator",
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
  voicePresetId: "standardNarration",
  voiceSettingsByProvider: {},
  processingSteps: [],
}

const provider: VoiceProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  docsUrl: "https://example.test/docs",
  links: [],
  manageKeyUrl: "https://example.test/key",
  sample: {
    maxSelectedSourceAudioBytes: 1024 * 1024 * 1024,
    maxSourceUploadBytes: 1024 * 1024 * 1024,
    maxUploadBytes: 10 * 1024 * 1024,
    maxWindowSeconds: 120,
    recommendedMaxSeconds: 120,
    recommendedMinSeconds: 60,
    targetSampleRateHz: 16000,
  },
  serverKeyConfigured: false,
  tuning: {
    controls: [
      {
        defaultValue: 0.5,
        description: "Controls stability.",
        id: "stability",
        label: "Stability",
        type: "slider",
      },
    ],
    defaultValues: { stability: 0.5 },
    presets: [],
  },
}

const runningJob: SpeechJob = {
  activeSegmentId: "segment-one",
  createdAt: "2026-06-23T00:00:00.000Z",
  defaultVoiceId: "narrator",
  error: null,
  id: "job-1",
  resultSha256: null,
  segmentGapMs: 250,
  segments: [
    {
      assignmentKind: "assigned",
      cacheState: null,
      characterCount: null,
      error: null,
      generationCount: 0,
      id: "segment-one",
      index: 0,
      requestId: null,
      resultSha256: null,
      status: "running",
      text: "Hello ",
      voiceId: "narrator",
      voiceName: "Narrator",
      voiceSettings: { stability: 0.42 },
    },
    {
      assignmentKind: "default",
      cacheState: null,
      characterCount: null,
      error: null,
      generationCount: 0,
      id: "segment-two",
      index: 1,
      requestId: null,
      resultSha256: null,
      status: "pending",
      text: "there.",
      voiceId: "narrator",
      voiceName: "Narrator",
      voiceSettings: { stability: 0.42 },
    },
  ],
  status: "running",
  text: "Hello there.",
  updatedAt: "2026-06-23T00:00:00.000Z",
}

const successJob: SpeechJob = {
  ...runningJob,
  activeSegmentId: null,
  resultSha256: "combined-hash",
  segments: runningJob.segments.map((segment, index) => ({
    ...segment,
    cacheState: index === 0 ? "miss" : "hit",
    characterCount: segment.text.length,
    generationCount: 1,
    requestId: `request-${index + 1}`,
    resultSha256: `segment-${index + 1}-hash`,
    status: "success",
  })),
  status: "success",
  updatedAt: "2026-06-23T00:00:01.000Z",
}

const regeneratedJob: SpeechJob = {
  ...successJob,
  resultSha256: "combined-hash-2",
  segments: successJob.segments.map((segment) =>
    segment.id === "segment-one"
      ? {
          ...segment,
          generationCount: 2,
          resultSha256: "segment-one-hash-2",
          voiceId: "villain",
          voiceName: "Villain",
          voiceSettings: { stability: 0.8 },
        }
      : segment
  ),
  updatedAt: "2026-06-23T00:00:02.000Z",
}

const voiceRegeneratedJob: SpeechJob = {
  ...successJob,
  resultSha256: "combined-hash-voice",
  segments: successJob.segments.map((segment, index) => ({
    ...segment,
    generationCount: 2,
    resultSha256: `voice-segment-${index + 1}-hash`,
    voiceSettings: { stability: 0.86 },
  })),
  updatedAt: "2026-06-23T00:00:03.000Z",
}

const dialogueSuccessJob: SpeechJob = {
  ...successJob,
  id: "dialogue-job",
  resultSha256: "dialogue-combined-hash",
  segments: [
    {
      ...successJob.segments[0],
      id: "dialogue-block-1",
      text: "Hello.",
      voiceId: "narrator",
      voiceName: "Narrator",
      voiceSettings: null,
    },
    {
      ...successJob.segments[1],
      id: "dialogue-block-2",
      text: "\nHi.",
      voiceId: "villain",
      voiceName: "Villain",
      voiceSettings: { stability: 0.8 },
    },
  ],
}

const dialogueRegeneratedJob: SpeechJob = {
  ...dialogueSuccessJob,
  resultSha256: "dialogue-combined-hash-2",
  segments: dialogueSuccessJob.segments.map((segment) =>
    segment.id === "dialogue-block-1"
      ? {
          ...segment,
          generationCount: 2,
          resultSha256: "dialogue-block-1-hash-2",
          voiceId: "villain",
          voiceName: "Villain",
          voiceSettings: { stability: 0.91 },
        }
      : segment
  ),
  updatedAt: "2026-06-23T00:00:04.000Z",
}

const canceledJob: SpeechJob = {
  ...runningJob,
  activeSegmentId: null,
  error: "Speech generation was canceled.",
  segments: runningJob.segments.map((segment) => ({
    ...segment,
    error: segment.status === "success" ? segment.error : "Speech generation was canceled.",
    status: segment.status === "success" ? segment.status : "canceled",
  })),
  status: "canceled",
}

const generatedResult: GeneratedResult = {
  appVoiceId: "narrator",
  cacheState: "multi-voice",
  characterCount: 12,
  contentType: "audio/mpeg",
  createdAt: "2026-06-23T00:00:02.000Z",
  generatedAt: "Jun 23, 2026",
  generationElapsedMs: 10,
  id: "generated-1",
  modelId: "eleven_flash_v2_5",
  multiVoiceMetadata: null,
  requestId: null,
  sha256: "generated-1-hash",
  sizeBytes: 12,
  tuningMetadata: null,
  scriptSnapshot: null,
  url: "blob:generated-1",
  voiceId: "narrator",
  voiceName: "Multi-Voice",
}

const rangeScriptSnapshot: GeneratedAudioScriptSnapshot = {
  version: 1,
  mode: "range",
  text: "Hello there.",
  sourceVoiceId: "narrator",
  assignments: [
    {
      id: "assignment-1",
      start: 0,
      end: 6,
      text: "Hello ",
      sourceText: "Hello there.",
      voiceId: "narrator",
      voiceName: "Narrator",
    },
  ],
  dialogueBlocks: [],
  speakerMappings: [],
  segmentGapMs: 0,
}

const rangeRegenerationScriptSnapshot: GeneratedAudioScriptSnapshot = {
  ...rangeScriptSnapshot,
  assignments: [
    {
      ...rangeScriptSnapshot.assignments[0],
      id: "segment-one",
    },
  ],
}

const dialogueScriptSnapshot: GeneratedAudioScriptSnapshot = {
  version: 1,
  mode: "dialogue",
  text: "Narrator: Hello.\nVillain: Hi.",
  sourceVoiceId: "narrator",
  assignments: [],
  dialogueBlocks: [
    {
      id: "dialogue-block-1",
      speakerLabel: "Narrator",
      text: "Hello.",
      voiceId: null,
      voiceName: null,
      voiceSettings: null,
    },
    {
      id: "dialogue-block-2",
      speakerLabel: "Villain",
      text: "Hi.",
      voiceId: "villain",
      voiceName: "Villain",
      voiceSettings: { stability: 0.8 },
    },
  ],
  speakerMappings: [
    { speakerLabel: "Narrator", voiceId: "narrator" },
    { speakerLabel: "Villain", voiceId: "villain" },
  ],
  segmentGapMs: null,
}

function generationInput(overrides: Partial<GenerateMultiVoiceSpeechInput> = {}) {
  return {
    backendDefaultModelId: "eleven_multilingual_v2",
    canUseProvider: true,
    defaultVoice,
    models: [
      {
        canUseSpeakerBoost: true,
        canUseStyle: true,
        characterCostMultiplier: 1,
        description: "Fast model.",
        maxCharactersRequestFreeUser: 5000,
        maxCharactersRequestSubscribedUser: 5000,
        maximumTextLengthPerRequest: 5000,
        modelId: "eleven_flash_v2_5",
        name: "Flash",
      },
    ],
    provider,
    providerId: "elevenlabs",
    providerKey: "browser-secret",
    segments: [
      {
        assignmentId: "segment-one",
        assignmentKind: "assigned" as const,
        clientSegmentId: "segment-one",
        end: 6,
        start: 0,
        text: "Hello ",
        voiceId: "narrator",
        voiceName: "Narrator",
        voiceSettings: { stability: 0.42 },
      },
      {
        assignmentId: null,
        assignmentKind: "default" as const,
        clientSegmentId: "segment-two",
        end: 12,
        start: 6,
        text: "there.",
        voiceId: "narrator",
        voiceName: "Narrator",
        voiceSettings: { stability: 0.42 },
      },
    ],
    selectedModelId: "eleven_flash_v2_5",
    selectedTuningPresetId: "custom",
    storageLimitBytes: 100,
    text: "Hello there.",
    tuning: { stability: 0.42 },
    ...overrides,
  }
}

function okJson(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  )
}

function okAudio(content = "combined") {
  return Promise.resolve(
    new Response(new Blob([content], { type: "audio/mpeg" }), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    })
  )
}

describe("useMultiVoiceSpeechGeneration", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("creates, polls, and persists a successful multi-voice speech job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: runningJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1" && !init) {
          return okJson({ job: successJob })
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio("combined")
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech(generationInput({ scriptSnapshot: rangeScriptSnapshot }))
    })

    expect(result.current.status).toBe("success")
    expect(result.current.job?.status).toBe("success")
    expect(result.current.resultUrl).toBe("/api/speech/jobs/job-1/result")
    expect(result.current.segmentResultUrls).toEqual({
      "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result",
      "segment-two": "/api/speech/jobs/job-1/segments/segment-two/result",
    })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      defaultVoiceId: "narrator",
      modelId: "eleven_flash_v2_5",
      providerId: "elevenlabs",
      segments: [
        expect.objectContaining({ clientSegmentId: "segment-one", voiceSettings: { stability: 0.42 } }),
        expect.objectContaining({ clientSegmentId: "segment-two", voiceSettings: { stability: 0.42 } }),
      ],
      text: "Hello there.",
      voiceSettings: { stability: 0.42 },
    })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).not.toHaveProperty("segmentGapMs")
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Voice-Provider-Key": "browser-secret",
    })
    expect(persistGeneratedAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheState: "multi-voice",
        characterCount: 12,
        modelId: "eleven_flash_v2_5",
        multiVoiceMetadata: expect.objectContaining({
          jobId: "job-1",
          resultSha256: "combined-hash",
          segmentCount: 2,
        }),
        scriptSnapshot: rangeScriptSnapshot,
        voiceId: "narrator",
        voiceName: "Multi-Voice",
      }),
      100
    )
  })

  it("forwards an explicit gapless multi-voice speech job option", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: successJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio("combined")
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech(generationInput({ segmentGapMs: 0 }))
    })

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      segmentGapMs: 0,
    })
  })

  it("submits nominal assigned voice speed instead of relying on job-level tuning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: successJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio("combined")
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech(
        generationInput({
          defaultVoice: {
            ...defaultVoice,
            id: "skippy",
            name: "Skippy",
          },
          segments: [
            {
              assignmentId: null,
              assignmentKind: "default",
              clientSegmentId: "segment-skippy",
              end: 14,
              start: 0,
              text: "Skippy opens.",
              voiceId: "skippy",
              voiceName: "Skippy",
              voiceSettings: null,
            },
            {
              assignmentId: "segment-court",
              assignmentKind: "assigned",
              clientSegmentId: "segment-court",
              end: 29,
              start: 14,
              text: "\nCourt replies.",
              voiceId: "court",
              voiceName: "Court",
              voiceSettings: { speed: 1, stability: 0.4, style: 0.35 },
            },
          ],
          text: "Skippy opens.\nCourt replies.",
          tuning: { speed: 1.04, stability: 0.4, style: 0.35 },
        })
      )
    })

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      defaultVoiceId: "skippy",
      segments: [
        expect.objectContaining({ clientSegmentId: "segment-skippy", voiceSettings: null }),
        expect.objectContaining({
          clientSegmentId: "segment-court",
          voiceSettings: { speed: 1, stability: 0.4, style: 0.35 },
        }),
      ],
      voiceSettings: { speed: 1.04, stability: 0.4, style: 0.35 },
    })
  })

  it("persists dialogue script snapshots with multi-voice speech jobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: successJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio("combined")
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech(generationInput({ scriptSnapshot: dialogueScriptSnapshot }))
    })

    expect(persistGeneratedAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptSnapshot: dialogueScriptSnapshot,
      }),
      100
    )
  })

  it("cancels a running job", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: runningJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1" && !init) {
          return okJson({ job: runningJob })
        }
        if (path === "/api/speech/jobs/job-1/cancel" && init?.method === "POST") {
          return okJson({ job: canceledJob })
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    let pendingGeneration: Promise<GeneratedResult | null> | null = null
    act(() => {
      pendingGeneration = result.current.generateSpeech(generationInput())
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe("processing")

    await act(async () => {
      await result.current.cancelGeneration()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
      await pendingGeneration
    })

    expect(result.current.status).toBe("canceled")
    expect(result.current.job?.status).toBe("canceled")
    expect(persistGeneratedAudio).not.toHaveBeenCalled()
  })

  it("persists a job that completes while cancellation is requested", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: runningJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1" && !init) {
          return okJson({ job: runningJob })
        }
        if (path === "/api/speech/jobs/job-1/cancel" && init?.method === "POST") {
          return okJson({ job: successJob })
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio("combined")
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    let pendingGeneration: Promise<GeneratedResult | null> | null = null
    act(() => {
      pendingGeneration = result.current.generateSpeech(generationInput())
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe("processing")

    await act(async () => {
      await result.current.cancelGeneration()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
      await pendingGeneration
    })

    expect(result.current.status).toBe("success")
    expect(result.current.job?.status).toBe("success")
    expect(persistGeneratedAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheState: "multi-voice",
        multiVoiceMetadata: expect.objectContaining({ resultSha256: "combined-hash" }),
      }),
      100
    )
  })

  it("regenerates a segment and persists refreshed combined audio metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: successJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio("combined")
        }
        if (path === "/api/speech/jobs/job-1/segments/segment-one/regenerate" && init?.method === "POST") {
          return okJson({ job: runningJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1" && !init) {
          return okJson({ job: regeneratedJob })
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech(generationInput({ scriptSnapshot: rangeRegenerationScriptSnapshot }))
    })
    await act(async () => {
      await result.current.regenerateSegment({
        providerKey: "browser-secret",
        segmentId: "segment-one",
        storageLimitBytes: 80,
        voiceId: "villain",
        voiceSettings: { stability: 0.8 },
      })
    })

    const regenerateCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url).includes("/regenerate") && init?.method === "POST")
    expect(regenerateCall?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Voice-Provider-Key": "browser-secret",
    })
    expect(regenerateCall?.[1]?.body).toBe(JSON.stringify({ voiceId: "villain", voiceSettings: { stability: 0.8 } }))
    expect(persistGeneratedAudio).toHaveBeenCalledTimes(2)
    expect(persistGeneratedAudio).toHaveBeenLastCalledWith(
      expect.objectContaining({
        multiVoiceMetadata: expect.objectContaining({
          resultSha256: "combined-hash-2",
          segments: expect.arrayContaining([
            expect.objectContaining({
              generationCount: 2,
              id: "segment-one",
              resultSha256: "segment-one-hash-2",
              voiceId: "villain",
              voiceName: "Villain",
              voiceSettings: { stability: 0.8 },
            }),
          ]),
        }),
        scriptSnapshot: expect.objectContaining({
          assignments: [
            expect.objectContaining({
              id: "segment-one",
              voiceId: "villain",
              voiceName: "Villain",
            }),
          ],
        }),
      }),
      80
    )
  })

  it("regenerates a dialogue segment and persists a refreshed script snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: dialogueSuccessJob }, 202)
        }
        if (path === "/api/speech/jobs/dialogue-job/result" && !init) {
          return okAudio("dialogue-combined")
        }
        if (path === "/api/speech/jobs/dialogue-job/segments/dialogue-block-1/regenerate" && init?.method === "POST") {
          return okJson({ job: dialogueRegeneratedJob }, 202)
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech(
        generationInput({
          scriptSnapshot: dialogueScriptSnapshot,
          segments: [
            {
              assignmentId: "dialogue-block-1",
              assignmentKind: "assigned",
              clientSegmentId: "dialogue-block-1",
              end: 6,
              start: 0,
              text: "Hello.",
              voiceId: "narrator",
              voiceName: "Narrator",
              voiceSettings: null,
            },
            {
              assignmentId: "dialogue-block-2",
              assignmentKind: "assigned",
              clientSegmentId: "dialogue-block-2",
              end: 10,
              start: 6,
              text: "\nHi.",
              voiceId: "villain",
              voiceName: "Villain",
              voiceSettings: { stability: 0.8 },
            },
          ],
          text: "Hello.\nHi.",
        })
      )
    })
    await act(async () => {
      await result.current.regenerateSegment({
        providerKey: "browser-secret",
        segmentId: "dialogue-block-1",
        voiceId: "villain",
        voiceSettings: { stability: 0.91 },
      })
    })

    expect(persistGeneratedAudio).toHaveBeenCalledTimes(2)
    expect(persistGeneratedAudio).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scriptSnapshot: expect.objectContaining({
          dialogueBlocks: expect.arrayContaining([
            expect.objectContaining({
              id: "dialogue-block-1",
              voiceId: "villain",
              voiceName: "Villain",
              voiceSettings: { stability: 0.91 },
            }),
          ]),
        }),
      }),
      100
    )
  })

  it("regenerates all segments for a voice and persists refreshed combined audio metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: successJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio("combined")
        }
        if (path === "/api/speech/jobs/job-1/voices/narrator/regenerate" && init?.method === "POST") {
          return okJson({ job: runningJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1" && !init) {
          return okJson({ job: voiceRegeneratedJob })
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech(generationInput())
    })
    await act(async () => {
      await result.current.regenerateVoiceSegments({
        providerKey: "browser-secret",
        storageLimitBytes: 80,
        voiceId: "narrator",
        voiceSettings: { stability: 0.86 },
      })
    })

    const regenerateCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url).includes("/voices/narrator/regenerate") && init?.method === "POST")
    expect(regenerateCall?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Voice-Provider-Key": "browser-secret",
    })
    expect(regenerateCall?.[1]?.body).toBe(JSON.stringify({ voiceSettings: { stability: 0.86 } }))
    expect(persistGeneratedAudio).toHaveBeenCalledTimes(2)
    expect(persistGeneratedAudio).toHaveBeenLastCalledWith(
      expect.objectContaining({
        multiVoiceMetadata: expect.objectContaining({
          resultSha256: "combined-hash-voice",
          segments: [
            expect.objectContaining({
              generationCount: 2,
              id: "segment-one",
              resultSha256: "voice-segment-1-hash",
              voiceSettings: { stability: 0.86 },
            }),
            expect.objectContaining({
              generationCount: 2,
              id: "segment-two",
              resultSha256: "voice-segment-2-hash",
              voiceSettings: { stability: 0.86 },
            }),
          ],
        }),
      }),
      80
    )
  })

  it("preserves the previous successful job when segment regeneration fails to start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          return okJson({ job: successJob }, 202)
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio("combined")
        }
        if (path === "/api/speech/jobs/job-1/segments/segment-one/regenerate" && init?.method === "POST") {
          return Promise.reject(new Error("Bad provider key."))
        }
        return okJson({})
      })
    )
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useMultiVoiceSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech(generationInput())
    })
    await act(async () => {
      await result.current.regenerateSegment({
        providerKey: "bad-key",
        segmentId: "segment-one",
        voiceId: "villain",
      })
    })

    expect(result.current.status).toBe("error")
    expect(result.current.error).toBe("Bad provider key.")
    expect(result.current.job?.status).toBe("success")
    expect(result.current.resultUrl).toBe("/api/speech/jobs/job-1/result")
    expect(persistGeneratedAudio).toHaveBeenCalledTimes(1)
  })
})
