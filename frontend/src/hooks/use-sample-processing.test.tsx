import { act, renderHook, waitFor } from "@testing-library/react"
import type { FormEvent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_VOICE_PRESET_ID } from "@/lib/voice-presets"
import type {
  PreparedSamplesResult,
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
  voiceSettingsByProvider: {},
  processingSteps: [],
}

const retainedSourceVoice: VoiceAsset = {
  ...sourceVoice,
  sourceFilePath: "sources/default-recording.wav",
  sourceContentType: "audio/wav",
  sourceSha256: "source-hash",
}

const sampleProcessingOptions: SampleProcessingOptionsResponse = {
  engine: "pyannote-community-1+faster-whisper",
  recommendedWorkflowOrder: ["isolateVoice", "separateSpeakers", "trimSilence"],
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

const stackProcessingOptions: SampleProcessingOptionsResponse = {
  engine: "fake-stack",
  recommendedWorkflowOrder: ["isolateVoice", "separateSpeakers", "trimSilence"],
  operations: [
    {
      id: "trimSilence",
      label: "Trim Silence",
      description: "Trim silence.",
      enabled: true,
      defaultProcessingPresetId: "trimBalanced",
      processingPresets: [
        {
          id: "trimBalanced",
          label: "Balanced",
          description: "Balanced trimming.",
        },
        {
          id: "trimAggressive",
          label: "Aggressive",
          description: "Aggressive trimming.",
        },
      ],
    },
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
        {
          id: "clean",
          label: "Clean",
          description: "Clean isolation.",
        },
      ],
    },
  ],
}

const prepareProcessingOptions: SampleProcessingOptionsResponse = {
  engine: "demucs+pyannote-community-1+ffmpeg",
  recommendedWorkflowOrder: ["prepareVoice", "isolateVoice", "separateSpeakers", "trimSilence"],
  operations: [
    {
      id: "prepareVoice",
      label: "Prepare Voice",
      description: "Rank provider-ready samples.",
      enabled: true,
      defaultProcessingPresetId: null,
      processingPresets: [],
    },
    ...stackProcessingOptions.operations,
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
    workflowMode: "single",
    steps: [
      {
        id: "job-1",
        operationId: "separateSpeakers",
        operationLabel: "Separate Speakers",
        status: "success",
        engine: "pyannote-community-1+faster-whisper",
        processingPresetId: null,
        processingPresetLabel: null,
        startedAt: "2026-06-23T00:00:00+00:00",
        completedAt: "2026-06-23T00:00:01+00:00",
        error: null,
        sourceSha256: "source-hash",
        resultSha256: "speaker-result-hash",
      },
    ],
    activeStepId: null,
    createdAt: "2026-06-23T00:00:00+00:00",
    updatedAt: "2026-06-23T00:00:01+00:00",
    error: null,
    result: speakerSeparationResult,
  },
}

const runningStackJob: SampleProcessingJobResponse = {
  job: {
    id: "job-stack",
    operationId: "trimSilence",
    operationLabel: "Trim Silence",
    status: "running",
    processingPresetId: "balanced",
    processingPresetLabel: "Balanced",
    sourceName: "Upload",
    sourceFilename: "upload.wav",
    sourceContentType: "audio/wav",
    sourceSha256: "source-hash",
    sourcePreference: "original",
    engine: "fake-stack",
    workflowMode: "stack",
    steps: [
      {
        id: "job-stack-step-1",
        operationId: "isolateVoice",
        operationLabel: "Isolate Voice",
        status: "running",
        engine: "fake-isolate",
        processingPresetId: "balanced",
        processingPresetLabel: "Balanced",
        startedAt: "2026-06-23T00:00:00+00:00",
        completedAt: null,
        error: null,
        sourceSha256: "source-hash",
        resultSha256: null,
      },
      {
        id: "job-stack-step-2",
        operationId: "trimSilence",
        operationLabel: "Trim Silence",
        status: "pending",
        engine: "fake-trim",
        processingPresetId: "trimBalanced",
        processingPresetLabel: "Balanced",
        startedAt: null,
        completedAt: null,
        error: null,
        sourceSha256: null,
        resultSha256: null,
      },
    ],
    activeStepId: "job-stack-step-1",
    createdAt: "2026-06-23T00:00:00+00:00",
    updatedAt: "2026-06-23T00:00:00+00:00",
    error: null,
    result: null,
  },
}

const successfulStackJob: SampleProcessingJobResponse = {
  job: {
    ...runningStackJob.job,
    status: "success",
    activeStepId: null,
    updatedAt: "2026-06-23T00:00:01+00:00",
    steps: runningStackJob.job.steps.map((step) => ({
      ...step,
      status: "success",
      completedAt: "2026-06-23T00:00:01+00:00",
      resultSha256: `${step.operationId}-hash`,
    })),
    result: {
      filename: "result.wav",
      contentType: "audio/wav",
      sha256: "result-hash",
    },
  },
}

const preparedSamplesResult: PreparedSamplesResult = {
  kind: "preparedSamples",
  warnings: ["Speaker detection unavailable; returned single-speaker candidates."],
  candidates: [
    {
      candidateId: "candidate-1",
      rank: 1,
      score: 91.2,
      speakerId: "speaker-1",
      speakerLabel: "Speaker 1",
      sourceWindow: {
        startSeconds: 12,
        endSeconds: 91,
        durationSeconds: 79,
      },
      durationSeconds: 77.3,
      sampleRateHz: 16000,
      contentType: "audio/wav",
      sha256: "candidate-1-hash",
      warnings: [],
      result: {
        path: "job-prepare/candidate-1.wav",
        filename: "candidate-1.wav",
        contentType: "audio/wav",
        sha256: "candidate-1-hash",
      },
    },
    {
      candidateId: "candidate-2",
      rank: 1,
      score: 84.6,
      speakerId: "speaker-2",
      speakerLabel: "Speaker 2",
      sourceWindow: {
        startSeconds: 104,
        endSeconds: 176,
        durationSeconds: 72,
      },
      durationSeconds: 70.5,
      sampleRateHz: 16000,
      contentType: "audio/wav",
      sha256: "candidate-2-hash",
      warnings: ["Clipping detected in this window."],
      result: {
        path: "job-prepare/candidate-2.wav",
        filename: "candidate-2.wav",
        contentType: "audio/wav",
        sha256: "candidate-2-hash",
      },
    },
  ],
}

const preparedSamplesJob: SampleProcessingJobResponse = {
  job: {
    id: "job-prepare",
    operationId: "prepareVoice",
    operationLabel: "Prepare Voice",
    status: "success",
    processingPresetId: null,
    processingPresetLabel: null,
    sourceName: "Default voice",
    sourceFilename: "source.wav",
    sourceContentType: "audio/wav",
    sourceSha256: "source-hash",
    sourcePreference: "original",
    engine: "demucs+pyannote-community-1+ffmpeg",
    workflowMode: "single",
    steps: [
      {
        id: "job-prepare",
        operationId: "prepareVoice",
        operationLabel: "Prepare Voice",
        status: "success",
        engine: "demucs+pyannote-community-1+ffmpeg",
        processingPresetId: null,
        processingPresetLabel: null,
        startedAt: "2026-06-23T00:00:00+00:00",
        completedAt: "2026-06-23T00:00:01+00:00",
        error: null,
        sourceSha256: "source-hash",
        resultSha256: "prepared-result-hash",
      },
    ],
    activeStepId: null,
    createdAt: "2026-06-23T00:00:00+00:00",
    updatedAt: "2026-06-23T00:00:01+00:00",
    error: null,
    result: preparedSamplesResult,
  },
}

const runningPrepareJob: SampleProcessingJobResponse = {
  job: {
    ...preparedSamplesJob.job,
    status: "running",
    sourceSizeBytes: 3_355_443,
    estimatedDurationRangeSeconds: {
      minSeconds: 75,
      maxSeconds: 210,
    },
    steps: [
      {
        ...preparedSamplesJob.job.steps[0],
        status: "running",
        completedAt: null,
        resultSha256: null,
      },
    ],
    activeStepId: "job-prepare",
    progressPhases: [
      {
        id: "job-prepare-phase-clean-voice",
        label: "Clean Voice",
        status: "success",
        startedAt: "2026-06-23T00:00:00+00:00",
        completedAt: "2026-06-23T00:00:10+00:00",
        error: null,
        detail: null,
      },
      {
        id: "job-prepare-phase-detect-speech",
        label: "Detect Speech Regions",
        status: "running",
        startedAt: "2026-06-23T00:00:10+00:00",
        completedAt: null,
        error: null,
        detail: "Speaker 1",
      },
    ],
    activeProgressPhaseId: "job-prepare-phase-detect-speech",
    result: null,
  },
}

const canceledPrepareJob: SampleProcessingJobResponse = {
  job: {
    ...runningPrepareJob.job,
    status: "canceled",
    error: "Sample processing was canceled.",
    activeStepId: null,
    activeProgressPhaseId: null,
    progressPhases: (runningPrepareJob.job.progressPhases ?? []).map((phase) =>
      phase.status === "running"
        ? {
            ...phase,
            status: "canceled",
            completedAt: "2026-06-23T00:00:11+00:00",
            error: "Sample processing was canceled.",
          }
        : phase
    ),
  },
}

const canceledStackJob: SampleProcessingJobResponse = {
  job: {
    ...runningStackJob.job,
    status: "canceled",
    activeStepId: null,
    error: "Sample processing was canceled.",
    steps: runningStackJob.job.steps.map((step) => ({
      ...step,
      status: step.id === "job-stack-step-1" ? "canceled" : step.status,
      completedAt: step.id === "job-stack-step-1" ? "2026-06-23T00:00:01+00:00" : step.completedAt,
      error: step.id === "job-stack-step-1" ? "Sample processing was canceled." : step.error,
    })),
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

describe("useSampleProcessing stacked workflow state", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it("exposes saved voice metadata for source selection presentation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/sample-processing/options" && !init) {
          return okJson(stackProcessingOptions)
        }
        return okJson({})
      })
    )
    const voices = [sourceVoice, { ...sourceVoice, id: "clone", name: "Clone", filePath: "voices/clone.wav" }]
    const { result } = renderHook(() => useSampleProcessing({ onVoiceSaved: vi.fn(), selectedVoice: sourceVoice, voices }))

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))

    expect(result.current.sourceVoices).toEqual(voices)
    expect(result.current.voiceOptions).toEqual([
      { label: "Default voice", value: "default" },
      { label: "Clone", value: "clone" },
    ])
  })

  it("keeps one-step jobs on the legacy operation fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(stackProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(successfulStackJob, 202)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: retainedSourceVoice, voices: [retainedSourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST")
    const body = createCall?.[1]?.body as FormData
    expect(body.get("operationId")).toBe("isolateVoice")
    expect(body.get("workflowSteps")).toBeNull()
    expect(body.get("sourceVoiceId")).toBe("default")
    expect(body.get("sourcePreference")).toBe("original")
    expect(result.current.status).toBe("success")
  })

  it("uses the active sample when the source voice has no retained original recording", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(stackProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(successfulStackJob, 202)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    expect(result.current.sourcePreference).toBe("original")
    expect(result.current.canUseOriginalRecording).toBe(false)
    expect(result.current.effectiveSourcePreference).toBe("active")
    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST")
    const body = createCall?.[1]?.body as FormData
    expect(body.get("sourcePreference")).toBe("active")
    expect(result.current.status).toBe("success")
    const processedJob = result.current.job

    act(() => {
      result.current.setSourcePreference("active")
    })

    expect(result.current.sourcePreference).toBe("original")
    expect(result.current.effectiveSourcePreference).toBe("active")
    expect(result.current.status).toBe("success")
    expect(result.current.job).toBe(processedJob)
  })

  it("submits selected stack steps in recommended order from an upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(stackProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(successfulStackJob, 202)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const sourceFile = new File(["source"], "conversation.wav", { type: "audio/wav" })
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    act(() => {
      result.current.setWorkflowStepSelected("separateSpeakers", true)
    })
    act(() => {
      result.current.setWorkflowStepSelected("trimSilence", true)
    })
    act(() => {
      result.current.setProcessingPresetIdForOperation("trimSilence", "trimAggressive")
      result.current.handleSourceModeChange("upload")
      result.current.handleSourceFileSelect(sourceFile)
    })
    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST")
    const body = createCall?.[1]?.body as FormData
    expect(body.get("operationId")).toBeNull()
    expect(JSON.parse(body.get("workflowSteps") as string)).toEqual([
      { operationId: "isolateVoice", processingPresetId: "balanced" },
      { operationId: "separateSpeakers", processingPresetId: null },
      { operationId: "trimSilence", processingPresetId: "trimAggressive" },
    ])
    expect(body.get("sourceFile")).toBe(sourceFile)
    expect(result.current.selectedOperationIds).toEqual(["isolateVoice", "separateSpeakers", "trimSilence"])
  })

  it("resets a selected stack when a single operation is selected again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/sample-processing/options") {
          return okJson(stackProcessingOptions)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    act(() => {
      result.current.setWorkflowStepSelected("trimSilence", true)
    })
    expect(result.current.selectedOperationIds).toEqual(["isolateVoice", "trimSilence"])

    act(() => {
      result.current.setOperationId("isolateVoice")
    })

    expect(result.current.selectedOperationIds).toEqual(["isolateVoice"])
  })

  it("does not select unavailable stack steps", async () => {
    const optionsWithDisabledTrim: SampleProcessingOptionsResponse = {
      ...stackProcessingOptions,
      operations: stackProcessingOptions.operations.map((operation) =>
        operation.id === "trimSilence" ? { ...operation, enabled: false } : operation
      ),
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(optionsWithDisabledTrim)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    act(() => {
      result.current.setWorkflowStepSelected("trimSilence", true)
    })

    expect(result.current.selectedOperationIds).toEqual(["isolateVoice"])
    expect(result.current.selectedWorkflowSteps.map((step) => step.operationId)).toEqual(["isolateVoice"])
  })

  it("tracks active step progress and cancels a running job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(stackProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(runningStackJob, 202)
        }
        if (path === "/api/sample-processing/jobs/job-stack" && !init) {
          return okJson(runningStackJob)
        }
        if (path === "/api/sample-processing/jobs/job-stack/cancel" && init?.method === "POST") {
          return okJson(canceledStackJob)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    act(() => {
      result.current.setWorkflowStepSelected("trimSilence", true)
    })
    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    expect(result.current.status).toBe("processing")
    expect(result.current.activeStep?.operationId).toBe("isolateVoice")
    expect(result.current.canCancel).toBe(true)

    await act(async () => {
      await result.current.handleCancelProcessing()
    })

    expect(result.current.status).toBe("canceled")
    expect(result.current.job?.status).toBe("canceled")
    expect(result.current.canSave).toBe(false)
    expect(result.current.canCancel).toBe(false)
  })

  it("keeps speaker stack results on speaker-specific preview URLs", async () => {
    const speakerStackJob: SampleProcessingJobResponse = {
      job: {
        ...speakerJob.job,
        workflowMode: "stack",
        steps: [
          {
            ...runningStackJob.job.steps[0],
            status: "success",
            completedAt: "2026-06-23T00:00:01+00:00",
            resultSha256: "isolate-hash",
          },
          {
            id: "job-1-step-2",
            operationId: "separateSpeakers",
            operationLabel: "Separate Speakers",
            status: "success",
            engine: "fake-separate",
            processingPresetId: null,
            processingPresetLabel: null,
            startedAt: "2026-06-23T00:00:01+00:00",
            completedAt: "2026-06-23T00:00:02+00:00",
            error: null,
            sourceSha256: "isolate-hash",
            resultSha256: "speaker-result-hash",
          },
        ],
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(stackProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(speakerStackJob, 202)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: sourceVoice, voices: [sourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    act(() => {
      result.current.setWorkflowStepSelected("separateSpeakers", true)
    })
    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    expect(result.current.isSpeakerSeparationJob).toBe(true)
    expect(result.current.resultUrl).toBeNull()
    expect(result.current.speakerSourceUrl).toBe("/api/sample-processing/jobs/job-1/source")
    expect(result.current.speakerResultUrls["speaker-1"]).toBe(
      "/api/sample-processing/jobs/job-1/speakers/speaker-1/result"
    )
  })

  it("starts Easy Prepare jobs and saves selected ranked candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(prepareProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(preparedSamplesJob, 202)
        }
        if (path === "/api/sample-processing/jobs/job-prepare/candidate-voices" && init?.method === "POST") {
          return okJson({ voices: [{ ...sourceVoice, id: "candidate-1", name: "Prepared Lead" }] }, 201)
        }
        return okJson({})
      })
    )
    const onVoiceSaved = vi.fn()
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved, selectedVoice: retainedSourceVoice, voices: [retainedSourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    expect(result.current.isPrepareVoiceSelected).toBe(true)
    expect(result.current.prepareCleanVoice).toBe(true)
    expect(result.current.prepareDetectSpeakers).toBe(true)

    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST")
    const body = createCall?.[1]?.body as FormData
    expect(body.get("operationId")).toBe("prepareVoice")
    expect(body.get("workflowSteps")).toBeNull()
    expect(body.get("processingPresetId")).toBeNull()
    expect(body.get("cleanVoice")).toBe("true")
    expect(body.get("detectSpeakers")).toBe("true")
    expect(body.get("trimCandidates")).toBe("true")
    expect(body.get("sourcePreference")).toBe("original")

    await waitFor(() => expect(result.current.selectedCandidateIds).toEqual(["candidate-1", "candidate-2"]))
    expect(result.current.isPreparedSamplesJob).toBe(true)
    expect(result.current.resultUrl).toBeNull()
    expect(result.current.candidateResultUrls).toEqual({
      "candidate-1": "/api/sample-processing/jobs/job-prepare/candidates/candidate-1/result",
      "candidate-2": "/api/sample-processing/jobs/job-prepare/candidates/candidate-2/result",
    })
    expect(result.current.candidateNameAssignments).toEqual({
      "candidate-1": "Default voice Speaker 1",
      "candidate-2": "Default voice Speaker 2",
    })

    act(() => {
      result.current.handleCandidateSaveSelectionChange("candidate-2", false)
      result.current.handleCandidateNameChange("candidate-1", "Prepared Lead")
      result.current.handleCandidateVoicePresetChange("candidate-1", DEFAULT_VOICE_PRESET_ID)
    })
    await act(async () => {
      await result.current.handleSaveCandidateVoices()
    })

    const saveCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url) === "/api/sample-processing/jobs/job-prepare/candidate-voices" && init?.method === "POST")
    expect(JSON.parse(saveCall?.[1]?.body as string)).toEqual({
      voices: [{ candidateId: "candidate-1", name: "Prepared Lead", voicePresetId: "standardNarration" }],
    })
    expect(onVoiceSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "candidate-1", name: "Prepared Lead" }))
    expect(result.current.candidateSaveStatus).toBe("success")
  })

  it("estimates Easy Prepare upload time and persists running jobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(prepareProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(runningPrepareJob, 202)
        }
        if (path === "/api/sample-processing/jobs/job-prepare" && !init) {
          return okJson(runningPrepareJob)
        }
        if (path === "/api/sample-processing/jobs/job-prepare/cancel" && init?.method === "POST") {
          return okJson(canceledPrepareJob)
        }
        return okJson({})
      })
    )
    const sourceFile = new File(["source"], "conversation.mp3", { type: "audio/mpeg" })
    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved: vi.fn(), selectedVoice: retainedSourceVoice, voices: [retainedSourceVoice] })
    )

    await waitFor(() => expect(result.current.optionsStatus).toBe("success"))
    act(() => {
      result.current.handleSourceModeChange("upload")
      result.current.handleSourceFileSelect(sourceFile)
    })

    expect(result.current.prepareEstimateRangeSeconds).not.toBeNull()

    await act(async () => {
      await result.current.handleStartProcessing(formEvent())
    })

    expect(result.current.status).toBe("processing")
    expect(result.current.prepareEstimateRangeSeconds).toEqual({ minSeconds: 75, maxSeconds: 210 })
    expect(result.current.activeProgressPhase?.label).toBe("Detect Speech Regions")
    expect(window.localStorage.getItem("voice-cloning.activeSampleProcessingJobId.v1")).toBe("job-prepare")

    await act(async () => {
      await result.current.handleCancelProcessing()
    })

    expect(result.current.status).toBe("canceled")
    expect(window.localStorage.getItem("voice-cloning.activeSampleProcessingJobId.v1")).toBeNull()
  })

  it("rehydrates an active Easy Prepare job from local storage", async () => {
    window.localStorage.setItem("voice-cloning.activeSampleProcessingJobId.v1", "job-prepare")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(prepareProcessingOptions)
        }
        if (path === "/api/sample-processing/jobs/job-prepare" && !init) {
          return okJson(runningPrepareJob)
        }
        return okJson({})
      })
    )

    const { result } = renderHook(() =>
      useSampleProcessing({ onVoiceSaved: vi.fn(), selectedVoice: retainedSourceVoice, voices: [retainedSourceVoice] })
    )

    await waitFor(() => expect(result.current.activeProgressPhase?.label).toBe("Detect Speech Regions"))

    expect(result.current.status).toBe("processing")
    expect(result.current.job?.id).toBe("job-prepare")
    expect(result.current.prepareEstimateRangeSeconds).toEqual({ minSeconds: 75, maxSeconds: 210 })
    expect(window.localStorage.getItem("voice-cloning.activeSampleProcessingJobId.v1")).toBe("job-prepare")
  })
})

describe("useSampleProcessing speaker separation state", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
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
      await result.current.assignTranscriptItemsToSpeaker([" item-2 ", "item-2", " "], "speaker-1")
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

  it("ignores stale speaker save responses after reset", async () => {
    let resolveSave: (response: Response) => void = () => undefined
    const saveResponse = new Promise<Response>((resolve) => {
      resolveSave = resolve
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
        if (path === "/api/sample-processing/jobs/job-1/speaker-voices" && init?.method === "POST") {
          return saveResponse
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

    let savePromise: Promise<void> = Promise.resolve()
    act(() => {
      savePromise = result.current.handleSaveSpeakerVoices()
    })
    await waitFor(() => expect(result.current.speakerSaveStatus).toBe("loading"))

    act(() => {
      result.current.setOperationId("isolateVoice")
    })
    await act(async () => {
      resolveSave(jsonResponse({ voices: [{ ...sourceVoice, id: "morgan", name: "Morgan" }] }, 201))
      await savePromise
    })

    expect(onVoiceSaved).not.toHaveBeenCalled()
    expect(result.current.speakerSaveStatus).toBe("idle")
    expect(result.current.speakerSeparationResult).toBeNull()
  })
})
