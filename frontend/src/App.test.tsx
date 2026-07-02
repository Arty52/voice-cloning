import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App"
import { TooltipProvider } from "./components/ui/tooltip"
import { MAX_SPEECH_TEXT_LENGTH } from "./constants"
import { VOICE_PROVIDER_KEY_HEADER } from "./lib/api"
import {
  BYTES_PER_MEBIBYTE,
  GENERATED_AUDIO_DB_NAME,
  listGeneratedAudio,
  saveGeneratedAudio,
} from "./lib/generated-audio-storage"
import { NATURAL_HANDOFFS_STORAGE_KEY } from "./lib/natural-handoffs-preference"
import { PROVIDER_KEYS_STORAGE_KEY } from "./lib/provider-keys"
import type { ProvidersResponse } from "./types"

const audioBlob = new Blob(["fake audio"], { type: "audio/mpeg" })
const formatTestNumber = (value: number) => new Intl.NumberFormat().format(value)
const ACTIVE_SAMPLE_PROCESSING_JOB_STORAGE_KEY = "voice-cloning.activeSampleProcessingJobId.v1"
let scrollIntoView: ReturnType<typeof vi.fn>

const defaultVoice = {
  id: "default",
  name: "Default voice",
  filePath: "default/default-voice.mp3",
  contentType: "audio/mpeg",
  sha256: "default-hash",
  source: "default" as const,
  createdAt: "2026-05-28T00:00:00+00:00",
  sampleMode: "excerpt" as const,
  windowStartSeconds: null,
  windowDurationSeconds: null,
  sourceFilePath: null,
  sourceContentType: null,
  sourceSha256: null,
  voicePresetId: "standardNarration" as const,
  voiceSettingsByProvider: {},
  processingSteps: [],
}

const retainedSourceVoice = {
  ...defaultVoice,
  sourceFilePath: "sources/default-recording.wav",
  sourceContentType: "audio/wav",
  sourceSha256: "source-hash",
}

const voiceCloneVoice = {
  id: "voice-clone-01",
  name: "Voice_Clone_01",
  filePath: "voice-clone-01.mp3",
  contentType: "audio/mpeg",
  sha256: "voice-clone-01-hash",
  source: "upload" as const,
  createdAt: "2026-05-28T00:00:00+00:00",
  sampleMode: "excerpt" as const,
  windowStartSeconds: null,
  windowDurationSeconds: null,
  sourceFilePath: null,
  sourceContentType: null,
  sourceSha256: null,
  voicePresetId: "standardNarration" as const,
  voiceSettingsByProvider: {},
  processingSteps: [],
}

const subscription = {
  available: true,
  error: null,
  tier: "starter",
  status: "active",
  characterCount: 1000,
  characterLimit: 10000,
  remainingCharacters: 9000,
  canExtendCharacterLimit: true,
  maxCreditLimitExtension: 10000,
  nextCharacterCountResetUnix: 1770000000,
}

const multilingualModel = {
  modelId: "eleven_multilingual_v2",
  name: "Eleven Multilingual v2",
  description: "Stable narration.",
  canUseStyle: true,
  canUseSpeakerBoost: true,
  characterCostMultiplier: 1,
  maxCharactersRequestFreeUser: 2500,
  maxCharactersRequestSubscribedUser: 10000,
  maximumTextLengthPerRequest: 10000,
}

const flashModel = {
  modelId: "eleven_flash_v2_5",
  name: "Eleven Flash v2.5",
  description: "Fast speech.",
  canUseStyle: false,
  canUseSpeakerBoost: true,
  characterCostMultiplier: 0.5,
  maxCharactersRequestFreeUser: 2500,
  maxCharactersRequestSubscribedUser: 40000,
  maximumTextLengthPerRequest: 40000,
}

const elevenLabsTuning = {
  controls: [
    {
      id: "stability",
      label: "Stability",
      description:
        "Lower values allow more expressive, variable delivery. Higher values keep the voice consistent but can flatten emotion.",
      type: "slider" as const,
      defaultValue: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      id: "similarityBoost",
      label: "Similarity",
      description:
        "Higher values stay closer to the cloned voice. If the source has noise, clicks, or artifacts, very high similarity can preserve them.",
      type: "slider" as const,
      defaultValue: 0.75,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      id: "style",
      label: "Style",
      description:
        "Zero is the most natural and consistent. Higher values exaggerate the speaker's style and may add latency or artifacts.",
      type: "slider" as const,
      defaultValue: 0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      id: "speed",
      label: "Speed",
      description:
        "One point zero is the baseline pace. Move toward 0.7 to slow down or 1.2 to speed up; extremes can reduce quality.",
      type: "slider" as const,
      defaultValue: 1,
      min: 0.7,
      max: 1.2,
      step: 0.01,
    },
    {
      id: "useSpeakerBoost",
      label: "Speaker Boost",
      description: "Boosts similarity to the selected speaker when the selected model supports it.",
      type: "toggle" as const,
      defaultValue: true,
    },
  ],
  presets: [
    {
      id: "standard",
      label: "Standard Narration",
      description: "Balanced clone similarity for steady narration.",
      voicePresetId: "standardNarration" as const,
      values: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true },
    },
    {
      id: "animated",
      label: "Animated Dialogue",
      description: "More expressive delivery for character reads.",
      voicePresetId: "animatedDialogue" as const,
      values: { stability: 0.4, similarityBoost: 0.75, style: 0.35, speed: 1, useSpeakerBoost: true },
    },
  ],
  defaultValues: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true },
}

const providersResponse: ProvidersResponse = {
  defaultProviderId: "elevenlabs",
  voicePresets: [
    {
      id: "standardNarration",
      label: "Standard Narration",
      description: "Balanced clone similarity for steady narration.",
    },
    {
      id: "animatedDialogue",
      label: "Animated Dialogue",
      description: "More expressive delivery for character reads.",
    },
  ],
  providers: [
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      serverKeyConfigured: true,
      manageKeyUrl: "https://elevenlabs.io/app/subscription/api",
      docsUrl: "https://elevenlabs.io/docs/api-reference/authentication",
      links: [
        {
          label: "API Requests",
          href: "https://elevenlabs.io/app/developers/analytics/api-requests",
        },
        {
          label: "Models",
          href: "https://elevenlabs.io/docs/api-reference/models/list",
        },
      ],
      sample: {
        maxSelectedSourceAudioBytes: 1024 * 1024 * 1024,
        maxSourceUploadBytes: 1024 * 1024 * 1024,
        maxUploadBytes: 10 * 1024 * 1024,
        maxWindowSeconds: 120,
        recommendedMinSeconds: 60,
        recommendedMaxSeconds: 120,
        targetSampleRateHz: 16000,
      },
      tuning: elevenLabsTuning,
    },
  ],
}

const sampleProcessingOptions = {
  engine: "demucs",
  recommendedWorkflowOrder: ["isolateVoice", "separateSpeakers", "trimSilence"],
  operations: [
    {
      id: "isolateVoice" as const,
      label: "Isolate Voice",
      description: "Separate the vocal stem from music or background audio with Demucs.",
      enabled: true,
      defaultProcessingPresetId: "balanced" as const,
      processingPresets: [
        {
          id: "fast" as const,
          label: "Fast",
          description: "Quickest preview with lighter separation quality.",
        },
        {
          id: "balanced" as const,
          label: "Balanced",
          description: "Default vocal isolation quality and runtime.",
        },
        {
          id: "clean" as const,
          label: "Clean",
          description: "Balanced isolation with conservative cleanup for background residue.",
        },
        {
          id: "maxIsolation" as const,
          label: "Max Isolation",
          description: "Slower, strongest separation attempt for difficult tracks.",
        },
      ],
    },
    {
      id: "trimSilence" as const,
      label: "Trim Silence",
      description: "Remove leading, trailing, and long interior empty sections with FFmpeg.",
      enabled: true,
      defaultProcessingPresetId: "trimBalanced" as const,
      processingPresets: [
        {
          id: "trimLight" as const,
          label: "Light",
          description: "Conservative trimming for only quieter or longer empty regions.",
        },
        {
          id: "trimBalanced" as const,
          label: "Balanced",
          description: "Default silence trimming with a small amount of preserved room tone.",
        },
        {
          id: "trimAggressive" as const,
          label: "Aggressive",
          description: "Tighter trimming for shorter or louder empty regions.",
        },
      ],
    },
    {
      id: "separateSpeakers" as const,
      label: "Separate Speakers",
      description: "Split a track into speaker-specific samples.",
      enabled: false,
      defaultProcessingPresetId: null,
      processingPresets: [],
    },
  ],
}

const successfulSampleProcessingJob = {
  job: {
    id: "job-1",
    operationId: "isolateVoice" as const,
    operationLabel: "Isolate Voice",
    status: "success" as const,
    processingPresetId: "balanced" as const,
    processingPresetLabel: "Balanced",
    sourceName: "Default voice",
    sourceSha256: "default-hash",
    sourcePreference: "original" as const,
    engine: "demucs",
    workflowMode: "single" as const,
    steps: [
      {
        id: "job-1",
        operationId: "isolateVoice" as const,
        operationLabel: "Isolate Voice",
        status: "success" as const,
        engine: "demucs",
        processingPresetId: "balanced" as const,
        processingPresetLabel: "Balanced",
        startedAt: "2026-06-19T00:00:00+00:00",
        completedAt: "2026-06-19T00:00:01+00:00",
        error: null,
        sourceSha256: "default-hash",
        resultSha256: "processed-hash",
      },
    ],
    activeStepId: null,
    createdAt: "2026-06-19T00:00:00+00:00",
    updatedAt: "2026-06-19T00:00:01+00:00",
    error: null,
    result: {
      filename: "result.wav",
      contentType: "audio/wav",
      sha256: "processed-hash",
    },
  },
}

const successfulSpeakerSeparationJob = {
  job: {
    id: "job-1",
    operationId: "separateSpeakers" as const,
    operationLabel: "Separate Speakers",
    status: "success" as const,
    processingPresetId: null,
    processingPresetLabel: null,
    sourceName: "Default voice",
    sourceFilename: "source.wav",
    sourceContentType: "audio/wav",
    sourceSha256: "source-hash",
    sourcePreference: "original" as const,
    engine: "pyannote-community-1+faster-whisper",
    workflowMode: "single" as const,
    steps: [
      {
        id: "job-1",
        operationId: "separateSpeakers" as const,
        operationLabel: "Separate Speakers",
        status: "success" as const,
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
    result: {
      kind: "speakerSeparation" as const,
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
    },
  },
}

const renamedSpeakerSeparationJob = {
  job: {
    ...successfulSpeakerSeparationJob.job,
    result: {
      ...successfulSpeakerSeparationJob.job.result,
      speakers: [
        {
          ...successfulSpeakerSeparationJob.job.result.speakers[0],
          assignedName: "Mina",
        },
        successfulSpeakerSeparationJob.job.result.speakers[1],
      ],
    },
  },
}

const reassignedSpeakerSeparationJob = {
  job: {
    ...successfulSpeakerSeparationJob.job,
    result: {
      ...successfulSpeakerSeparationJob.job.result,
      speakers: [
        {
          ...successfulSpeakerSeparationJob.job.result.speakers[0],
          assignedName: "Mina",
          transcriptItemIds: ["item-1", "item-2"],
        },
        {
          ...successfulSpeakerSeparationJob.job.result.speakers[1],
          transcriptItemIds: [],
        },
      ],
      transcript: {
        items: [
          successfulSpeakerSeparationJob.job.result.transcript.items[0],
          {
            ...successfulSpeakerSeparationJob.job.result.transcript.items[1],
            speakerId: "speaker-1",
          },
        ],
      },
    },
  },
}

function processedVoiceFrom(init?: RequestInit) {
  const payload = typeof init?.body === "string" ? (JSON.parse(init.body) as { name?: string; voicePresetId?: string }) : {}
  return {
    ...voiceCloneVoice,
    id: "default-voice-isolated",
    name: payload.name || "Default voice Isolated",
    filePath: "default-voice-isolated.wav",
    contentType: "audio/wav",
    sha256: "processed-hash",
    voicePresetId: payload.voicePresetId === "animatedDialogue" ? ("animatedDialogue" as const) : ("standardNarration" as const),
    processingSteps: [
      {
        id: "job-1",
        label: "Isolate Voice",
        operationId: "isolateVoice" as const,
        createdAt: "2026-06-19T00:00:01+00:00",
        sourceSha256: "default-hash",
        resultSha256: "processed-hash",
        engine: "demucs",
      },
    ],
  }
}

function savedSpeakerVoiceFrom(init?: RequestInit) {
  const payload =
    typeof init?.body === "string"
      ? (JSON.parse(init.body) as { voices?: { name?: string; speakerId?: string; voicePresetId?: string }[] })
      : {}
  const voice = payload.voices?.[0]
  return {
    ...voiceCloneVoice,
    id: "speaker-voice-01",
    name: voice?.name || "Speaker 1",
    filePath: "speaker-1.wav",
    contentType: "audio/wav",
    sha256: "speaker-1-hash",
    voicePresetId: voice?.voicePresetId === "animatedDialogue" ? ("animatedDialogue" as const) : ("standardNarration" as const),
    processingSteps: [
      {
        id: "job-1",
        label: "Separate Speakers",
        operationId: "separateSpeakers" as const,
        createdAt: "2026-06-23T00:00:01+00:00",
        sourceSha256: "source-hash",
        resultSha256: "speaker-1-hash",
        engine: "pyannote-community-1+faster-whisper",
        speakerId: voice?.speakerId || "speaker-1",
        speakerLabel: "Speaker 1",
      },
    ],
  }
}

function okJson(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
}

function okNoContent() {
  return Promise.resolve(new Response(null, { status: 204 }))
}

function okAudio(headers: Record<string, string> = {}, body: Blob = audioBlob) {
  return Promise.resolve(
    new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "X-App-Voice-Id": "default",
        "X-Character-Count": "54",
        "X-Request-Id": "req_test_123",
        "X-Voice-Cache": "miss",
        "X-Voice-Id": "voice-123",
        ...headers,
      },
    })
  )
}

function sampleProcessingMediaSourceFrom(init?: RequestInit) {
  const body = init?.body instanceof FormData ? init.body : null
  const sourceFile = body?.get("sourceFile")
  const filename = sourceFile instanceof File ? sourceFile.name : "source.wav"
  const contentType = sourceFile instanceof File ? sourceFile.type || "audio/wav" : "audio/wav"
  const sizeBytes = sourceFile instanceof File ? sourceFile.size : 6
  const isVideo = contentType.startsWith("video/")

  return {
    source: {
      id: "source-1",
      filename,
      contentType,
      mediaKind: isVideo ? "video" as const : "audio" as const,
      sizeBytes,
      sha256: "source-hash",
      durationSeconds: 240,
      sampleRateHz: isVideo ? 48000 : 44100,
      audioStreams: isVideo
        ? [
            {
              index: 1,
              codecName: "aac",
              sampleRateHz: 48000,
              channels: 2,
              channelLayout: "stereo",
              language: "eng",
              title: "Main Audio",
            },
          ]
        : [],
      selectedAudioStream: isVideo
        ? {
            index: 1,
            codecName: "aac",
            sampleRateHz: 48000,
            channels: 2,
            channelLayout: "stereo",
            language: "eng",
            title: "Main Audio",
          }
        : null,
      selectedAudioStreamIndex: isVideo ? 1 : null,
      chapters: [],
      warnings: [],
    },
  }
}

function chapteredSampleProcessingMediaSource() {
  return {
    source: {
      id: "source-book",
      filename: "book.m4b",
      contentType: "audio/mp4",
      mediaKind: "audio" as const,
      sizeBytes: 16777216,
      sha256: "book-hash",
      durationSeconds: 900,
      sampleRateHz: 44100,
      audioStreams: [],
      selectedAudioStream: null,
      selectedAudioStreamIndex: null,
      chapters: [
        {
          id: "chapter-1",
          title: "Chapter 1",
          startSeconds: 0,
          endSeconds: 120,
          durationSeconds: 120,
        },
        {
          id: "chapter-2",
          title: "Chapter 2",
          startSeconds: 120,
          endSeconds: 240,
          durationSeconds: 120,
        },
      ],
      warnings: [],
    },
  }
}

function speechJobFromSubmitted(
  submittedJob: {
    defaultVoiceId: string
    segmentGapMs?: number
    segments: Array<{
      assignmentKind: string
      clientSegmentId: string
      text: string
      voiceId: string
      voiceSettings?: Record<string, unknown> | null
    }>
    text: string
    voiceSettings?: Record<string, unknown> | null
  } | null,
  overrides: {
    generationCount?: number
    resultSha256?: string
    voiceSettings?: Record<string, unknown> | null
  } = {}
) {
  const job = submittedJob ?? {
    defaultVoiceId: "default",
    segments: [],
    text: "",
    voiceSettings: null,
  }
  return {
    activeSegmentId: null,
    createdAt: "2026-06-23T00:00:00.000Z",
    defaultVoiceId: job.defaultVoiceId,
    error: null,
    id: "job-1",
    resultSha256: overrides.resultSha256 ?? "combined-hash",
    segmentGapMs: job.segmentGapMs ?? 250,
    segments: job.segments.map((segment, index) => ({
      assignmentKind: segment.assignmentKind,
      cacheState: "miss",
      characterCount: segment.text.length,
      error: null,
      generationCount: overrides.generationCount ?? 1,
      id: segment.clientSegmentId,
      index,
      requestId: `request-${index + 1}`,
      resultSha256: `segment-${index + 1}-hash`,
      status: "success",
      text: segment.text,
      voiceId: segment.voiceId,
      voiceName: segment.voiceId === "voice-clone-01" ? "Voice_Clone_01" : "Default voice",
      voiceSettings:
        overrides.voiceSettings !== undefined
          ? overrides.voiceSettings
          : segment.voiceSettings ?? job.voiceSettings ?? null,
    })),
    status: "success",
    text: job.text,
    updatedAt: "2026-06-23T00:00:01.000Z",
  }
}

function runningSpeechJobFromSubmitted(
  submittedJob: NonNullable<Parameters<typeof speechJobFromSubmitted>[0]> | null,
  overrides: { activeSegmentId?: string | null } = {}
) {
  const job = speechJobFromSubmitted(submittedJob)
  const activeSegmentId = "activeSegmentId" in overrides ? overrides.activeSegmentId : (job.segments[0]?.id ?? null)
  return {
    ...job,
    activeSegmentId,
    resultSha256: null,
    segments: job.segments.map((segment, index) => ({
      ...segment,
      resultSha256: null,
      status: index === 0 ? ("running" as const) : ("pending" as const),
    })),
    status: "running" as const,
  }
}

function deferredResponse() {
  let resolve: (value: Response) => void = () => undefined
  const promise = new Promise<Response>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function expectAbortSignal(signal: AbortSignal | null, aborted: boolean) {
  expect(signal).not.toBeNull()
  expect(signal?.aborted).toBe(aborted)
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    request.onblocked = () => reject(new Error(`Unable to delete ${name}; database is blocked.`))
  })
}

function generatedAudioInput(overrides: Partial<Parameters<typeof saveGeneratedAudio>[0]> = {}) {
  return {
    appVoiceId: "default",
    blob: audioBlob,
    cacheState: "miss",
    characterCount: 54,
    modelId: "eleven_multilingual_v2",
    requestId: "req_test_123",
    voiceId: "voice-123",
    voiceName: "Default voice",
    ...overrides,
  }
}

function renderApp() {
  return render(
    <TooltipProvider>
      <App />
    </TooltipProvider>
  )
}

function mockWorkflowViewport(isMobile: boolean) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: isMobile ? 390 : 1024,
  })
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: isMobile,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  })
}

function scopedPanelByHeading(name: string) {
  const heading = screen.getByRole("heading", { name })
  const panel = heading.closest("section, form")
  expect(panel).not.toBeNull()
  return within(panel as HTMLElement)
}

function prepareAudioPanel() {
  const panel = document.querySelector('[data-section-id="prepare"]')
  expect(panel).not.toBeNull()
  return within(panel as HTMLElement)
}

function expectHiddenAudioInputDoesNotWidenPage(inputId: string) {
  const input = document.querySelector(`#${inputId}`)
  expect(input).not.toBeNull()
  expect(input).toHaveClass("sr-only", "size-px", "border-0", "p-0")
  expect(input).not.toHaveClass("h-10")
  expect(input).not.toHaveClass("w-full")
}

function selectAddVoiceWorkflow() {
  if (!screen.queryByRole("form", { name: "Add Voice" })) {
    act(() => {
      fireEvent.click(prepareAudioPanel().getByRole("button", { name: /upload ready voice sample/i }))
    })
  }
}

function selectSampleProcessingWorkflow(sourceMode: "upload" | "voice" = "voice") {
  const isRevealed = Boolean(screen.queryByRole("heading", { name: "Sample Processing" }))
  if (!isRevealed) {
    act(() => {
      fireEvent.click(prepareAudioPanel().getByRole("button", { name: /process source media/i }))
    })
  }
  const panel = scopedPanelByHeading("Sample Processing")
  if (sourceMode === "voice" && !isRevealed) {
    const savedVoiceButton = panel.queryByRole("radio", { name: "Saved Voice" })
    if (savedVoiceButton && savedVoiceButton.getAttribute("aria-checked") !== "true") {
      act(() => {
        fireEvent.click(savedVoiceButton)
      })
    }
  }
  return panel
}

function addVoicePanel() {
  selectAddVoiceWorkflow()
  return within(screen.getByRole("form", { name: "Add Voice" }))
}

function voiceLibraryPanel() {
  return scopedPanelByHeading("Voice Library")
}

function voiceLibraryRow(name: string) {
  return within(voiceLibraryPanel().getByRole("group", { name: `${name} Voice` }))
}

function sampleProcessingPanel() {
  return selectSampleProcessingWorkflow()
}

function sampleProcessingPresetSelect(label: string) {
  return sampleProcessingPanel().getByRole("button", {
    name: (accessibleName) => accessibleName.startsWith(`${label}:`),
  })
}

async function chooseSampleProcessingPreset(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  optionName: string
) {
  await user.click(sampleProcessingPresetSelect(label))
  await user.click(screen.getByRole("menuitemradio", { name: optionName }))
}

function expectVoicePresetSelection(control: HTMLElement, selected: boolean) {
  expectSubtleSelectorSelection(control, selected)
}

function expectElementBefore(before: Element, after: Element) {
  expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

function expectSubtleSelectorSelection(control: HTMLElement, selected: boolean) {
  expect(control).toHaveAttribute("aria-checked", String(selected))
  if (selected) {
    expect(control).toHaveClass("aria-checked:border-primary/60")
    expect(control).toHaveClass("aria-checked:bg-primary/10")
    expect(control).toHaveClass("aria-checked:text-foreground")
    expect(control).toHaveClass("aria-checked:ring-primary/30")
    expect(control).not.toHaveClass("aria-checked:bg-primary")
    expect(control).not.toHaveClass("aria-checked:text-primary-foreground")
  }
}

function workflowCardLink(workflowMap: HTMLElement, hash: string) {
  const link = within(workflowMap)
    .getAllByRole("link")
    .find((candidate) => candidate.getAttribute("href") === hash)
  expect(link).toBeDefined()
  return link as HTMLAnchorElement
}

function voiceTuningPanel() {
  return scopedPanelByHeading("Voice Tuning")
}

function selectedVoiceTuningPanel() {
  return voiceTuningPanel()
}

async function openSelectedVoiceTuningPanel(user: ReturnType<typeof userEvent.setup>) {
  const panel = selectedVoiceTuningPanel()
  await user.click(panel.getByRole("button", { name: "Show Voice Tuning" }))
  return selectedVoiceTuningPanel()
}

function latestGeneratedAudioPanel() {
  return scopedPanelByHeading("Latest Generated Audio")
}

function generatedAudioArchivePanel() {
  return scopedPanelByHeading("Generated Audio Archive")
}

function uploadedVoiceFrom(init?: RequestInit) {
  const voicePresetId = init?.body instanceof FormData ? init.body.get("voicePresetId") : null
  return {
    ...voiceCloneVoice,
    voicePresetId: voicePresetId === "animatedDialogue" ? "animatedDialogue" : "standardNarration",
  }
}

function stubDecodedAudio(durationSeconds = 3, sampleRate = 48000) {
  const channelData = new Float32Array(Math.ceil(durationSeconds * sampleRate)).fill(0.25)
  class FakeAudioContext {
    state = "running"

    close = vi.fn(async () => {
      this.state = "closed"
    })

    decodeAudioData = vi.fn(async () => ({
      duration: durationSeconds,
      getChannelData: () => channelData,
      numberOfChannels: 1,
      sampleRate,
    }))
  }
  vi.stubGlobal("AudioContext", FakeAudioContext)
}

function stubDeferredDecodedAudio(durationSeconds = 3, sampleRate = 48000) {
  const channelData = new Float32Array(Math.ceil(durationSeconds * sampleRate)).fill(0.25)
  const audioBuffer = {
    duration: durationSeconds,
    getChannelData: () => channelData,
    numberOfChannels: 1,
    sampleRate,
  }
  let resolveDecode: (value: typeof audioBuffer) => void = () => undefined
  const decodePromise = new Promise<typeof audioBuffer>((resolve) => {
    resolveDecode = resolve
  })
  class FakeAudioContext {
    state = "running"

    close = vi.fn(async () => {
      this.state = "closed"
    })

    decodeAudioData = vi.fn(() => decodePromise)
  }
  vi.stubGlobal("AudioContext", FakeAudioContext)
  return {
    resolve: () => resolveDecode(audioBuffer),
  }
}

function stubAudioDecodeFailure() {
  class FakeAudioContext {
    state = "running"

    close = vi.fn(async () => {
      this.state = "closed"
    })

    decodeAudioData = vi.fn(async () => {
      throw new Error("decode failed")
    })
  }
  vi.stubGlobal("AudioContext", FakeAudioContext)
}

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.split("?")[0]
    if (path === "/api/providers" && !init) {
      return okJson(providersResponse)
    }
    if (path === "/api/voices" && !init) {
      return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
    }
    if (path === "/api/subscription" && !init) {
      return okJson(subscription)
    }
    if (path === "/api/models" && !init) {
      return okJson({
        available: true,
        error: null,
        defaultModelId: "eleven_multilingual_v2",
        models: [multilingualModel, flashModel],
      })
    }
    if (path === "/api/sample-processing/options" && !init) {
      return okJson(sampleProcessingOptions)
    }
    if (path === "/api/sample-processing/sources" && init?.method === "POST") {
      return okJson(sampleProcessingMediaSourceFrom(init))
    }
    if (path === "/api/sample-processing/sources/source-1" && init?.method === "DELETE") {
      return okNoContent()
    }
    if (path === "/api/sample-processing/sources/source-1/preview" && !init) {
      return okAudio()
    }
    if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ ...successfulSampleProcessingJob, job: { ...successfulSampleProcessingJob.job, status: "running" } }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        })
      )
    }
    if (path === "/api/sample-processing/jobs/job-1" && !init) {
      return okJson(successfulSampleProcessingJob)
    }
    if (path === "/api/sample-processing/jobs/job-1/voice" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ voice: processedVoiceFrom(init) }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
    }
    if (path === "/api/voices" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ voice: uploadedVoiceFrom(init) }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
    }
    if (path === "/api/voices/default" && init?.method === "PUT") {
      return okJson({ defaultVoiceId: "voice-clone-01", voices: [defaultVoice, voiceCloneVoice] })
    }
    if (path === "/api/speech" && init?.method === "POST") {
      return okAudio()
    }
    return okJson({})
  })
}

function mockFetchWithProviders(
  nextProvidersResponse: Omit<ProvidersResponse, "voicePresets"> & Partial<Pick<ProvidersResponse, "voicePresets">>
) {
  const resolvedProvidersResponse: ProvidersResponse = {
    ...nextProvidersResponse,
    voicePresets: nextProvidersResponse.voicePresets ?? providersResponse.voicePresets,
  }
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.split("?")[0]
    if (path === "/api/providers" && !init) {
      return okJson(resolvedProvidersResponse)
    }
    if (path === "/api/voices" && !init) {
      return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
    }
    if (path === "/api/subscription" && !init) {
      return okJson(subscription)
    }
    if (path === "/api/models" && !init) {
      return okJson({
        available: true,
        error: null,
        defaultModelId: "eleven_multilingual_v2",
        models: [multilingualModel, flashModel],
      })
    }
    if (path === "/api/sample-processing/options" && !init) {
      return okJson(sampleProcessingOptions)
    }
    if (path === "/api/sample-processing/sources" && init?.method === "POST") {
      return okJson(sampleProcessingMediaSourceFrom(init))
    }
    if (path === "/api/sample-processing/sources/source-1" && init?.method === "DELETE") {
      return okNoContent()
    }
    if (path === "/api/sample-processing/sources/source-1/preview" && !init) {
      return okAudio()
    }
    if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ ...successfulSampleProcessingJob, job: { ...successfulSampleProcessingJob.job, status: "running" } }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        })
      )
    }
    if (path === "/api/sample-processing/jobs/job-1" && !init) {
      return okJson(successfulSampleProcessingJob)
    }
    if (path === "/api/sample-processing/jobs/job-1/voice" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ voice: processedVoiceFrom(init) }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
    }
    if (path === "/api/voices" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ voice: uploadedVoiceFrom(init) }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
    }
    if (path === "/api/speech" && init?.method === "POST") {
      return okAudio()
    }
    return okJson({})
  })
}

describe("App", () => {
  vi.setConfig({ testTimeout: 15_000 })

  afterAll(() => {
    vi.resetConfig()
  })

  beforeEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
    localStorage.clear()
    window.history.replaceState(null, "", window.location.pathname)
    mockWorkflowViewport(false)
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      value: 320,
    })
    scrollIntoView = vi.fn(function (this: HTMLElement) {
      return undefined
    })
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        callback(performance.now())
        return 0
      }),
    })
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", mockFetch())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("loads voices and auto-expands long text", async () => {
    const user = userEvent.setup()
    renderApp()

    const textarea = await screen.findByLabelText(/text to speak/i)
    await user.clear(textarea)
    await user.type(textarea, "This is a long text input that should expand the textarea.")

    await waitFor(() => expect(textarea).toHaveStyle({ height: "320px" }))
    expect(await screen.findByText("default/default-voice.mp3")).toBeInTheDocument()
  })

  it("lands on overview with the desktop workflow sidebar active", async () => {
    renderApp()

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument()
    expect(
      screen.getByText("Choose a voice, generate a short preview, and manage local setup from one workspace.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("complementary", { name: "Workflow Sidebar" })).toBeInTheDocument()
    expect(screen.queryByText("Friend-Friendly Tour")).not.toBeInTheDocument()
    const workflowNav = within(screen.getByRole("navigation", { name: "Workflow Sections" }))
    expect(await workflowNav.findByText("Start Here")).toBeInTheDocument()
    expect((await workflowNav.findAllByText("Ready")).length).toBeGreaterThan(0)
    expect(document.querySelector('[data-section-id="overview"]')).not.toHaveClass("hidden")
    expect(document.querySelector('[data-section-id="voices"]')).toHaveClass("hidden")
    expect(document.querySelector('[data-section-id="provider"]')).toHaveClass("hidden")
  })

  it("navigates from overview workflow cards to active sections", async () => {
    const user = userEvent.setup()
    renderApp()

    const workflowMap = await screen.findByRole("list", { name: "Voice Studio Workflow" })

    await user.click(workflowCardLink(workflowMap, "#voices"))

    await waitFor(() => expect(window.location.hash).toBe("#voices"))
    expect(screen.getByRole("button", { name: "Voices" })).toHaveAttribute("aria-current", "page")
    expect(document.querySelector('[data-section-id="voices"]')).not.toHaveClass("hidden")
    expect(document.querySelector('[data-section-id="overview"]')).toHaveClass("hidden")

    await user.click(screen.getByRole("button", { name: "Overview" }))
    const refreshedWorkflowMap = await screen.findByRole("list", { name: "Voice Studio Workflow" })
    await user.click(workflowCardLink(refreshedWorkflowMap, "#generate"))

    await waitFor(() => expect(window.location.hash).toBe("#generate"))
    expect(screen.getByRole("button", { name: "Generate Speech" })).toHaveAttribute("aria-current", "page")
    expect(document.querySelector('[data-section-id="generate"]')).not.toHaveClass("hidden")
    expect(document.querySelector('[data-section-id="overview"]')).toHaveClass("hidden")
  })

  it("switches desktop workflow sections through stable hashes", async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole("button", { name: "Generate Speech" }))

    expect(window.location.hash).toBe("#generate")
    expect(screen.getByRole("button", { name: "Generate Speech" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("heading", { level: 2, name: "Generate Speech" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Voices" })).not.toHaveAttribute("aria-current")
  })

  it("links from the generate source row to voice selection", async () => {
    window.history.replaceState(null, "", "/#generate")
    const user = userEvent.setup()
    renderApp()

    const generateSection = document.querySelector('[data-section-id="generate"]')
    expect(generateSection).not.toHaveClass("hidden")
    expect(await within(generateSection as HTMLElement).findByText("Default voice")).toBeInTheDocument()

    const changeVoiceLink = await screen.findByRole("link", { name: "Change Voice" })
    expect(changeVoiceLink).toHaveAttribute("href", "#voices")

    await user.click(changeVoiceLink)

    await waitFor(() => expect(window.location.hash).toBe("#voices"))
    expect(screen.getByRole("button", { name: "Voices" })).toHaveAttribute("aria-current", "page")
    expect(document.querySelector('[data-section-id="voices"]')).not.toHaveClass("hidden")
    expect(document.querySelector('[data-section-id="generate"]')).toHaveClass("hidden")
  })

  it("keeps voice assignments active after a safe edit inside assigned text", async () => {
    window.history.replaceState(null, "", "/#generate")
    let createJobBody: {
      defaultVoiceId: string
      segmentGapMs?: number
      segments: Array<{
        assignmentKind: string
        clientSegmentId: string
        text: string
        voiceId: string
        voiceSettings?: Record<string, unknown> | null
      }>
      text: string
      voiceSettings?: Record<string, unknown> | null
    } | null = null
    let regenerateSegmentBody: {
      voiceId: string | null
      voiceSettings?: Record<string, unknown> | null
    } | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        if (path === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (path === "/api/models" && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          const submittedJob = JSON.parse(String(init.body)) as NonNullable<typeof createJobBody>
          createJobBody = submittedJob
          return okJson(
            {
              job: {
                activeSegmentId: null,
                createdAt: "2026-06-23T00:00:00.000Z",
                defaultVoiceId: submittedJob.defaultVoiceId,
                error: null,
                id: "job-1",
                resultSha256: "combined-hash",
                segmentGapMs: submittedJob.segmentGapMs ?? 250,
                segments: submittedJob.segments.map((segment, index) => ({
                  assignmentKind: segment.assignmentKind,
                  cacheState: "miss",
                  characterCount: segment.text.length,
                  error: null,
                  generationCount: 1,
                  id: segment.clientSegmentId,
                  index,
                  requestId: `request-${index + 1}`,
                  resultSha256: `segment-${index + 1}-hash`,
                  status: "success",
                  text: segment.text,
                  voiceId: segment.voiceId,
                  voiceName: segment.voiceId === "voice-clone-01" ? "Voice_Clone_01" : "Default voice",
                  voiceSettings: segment.voiceSettings ?? submittedJob.voiceSettings ?? null,
                })),
                status: "success",
                text: submittedJob.text,
                updatedAt: "2026-06-23T00:00:01.000Z",
              },
            }
          )
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio()
        }
        if (
          path.startsWith("/api/speech/jobs/job-1/segments/") &&
          path.endsWith("/regenerate") &&
          init?.method === "POST"
        ) {
          regenerateSegmentBody = JSON.parse(String(init.body))
          return okJson({
            job: {
              activeSegmentId: null,
              createdAt: "2026-06-23T00:00:00.000Z",
              defaultVoiceId: createJobBody?.defaultVoiceId ?? "default",
              error: null,
              id: "job-1",
              resultSha256: "combined-hash-2",
              segmentGapMs: createJobBody?.segmentGapMs ?? 250,
              segments: (createJobBody?.segments ?? []).map((segment, index) => ({
                assignmentKind: segment.assignmentKind,
                cacheState: "miss",
                characterCount: segment.text.length,
                error: null,
                generationCount: index === 0 ? 2 : 1,
                id: segment.clientSegmentId,
                index,
                requestId: `request-${index + 1}`,
                resultSha256: `segment-${index + 1}-hash-2`,
                status: "success",
                text: segment.text,
                voiceId: segment.voiceId,
                voiceName: segment.voiceId === "voice-clone-01" ? "Voice_Clone_01" : "Default voice",
                voiceSettings: index === 0 ? regenerateSegmentBody?.voiceSettings : segment.voiceSettings,
              })),
              status: "success",
              text: createJobBody?.text ?? "",
              updatedAt: "2026-06-23T00:00:02.000Z",
            },
          })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const textarea = screen.getByLabelText(/text to speak/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "say helloo world! now" } })
    const assignmentStart = "say ".length
    const assignmentEnd = assignmentStart + "helloo world!".length
    textarea.setSelectionRange(assignmentStart, assignmentEnd)
    fireEvent.select(textarea)

    await user.click(screen.getByRole("button", { name: /^Assign Voice$/i }))
    await user.click(screen.getByRole("button", { name: "Voice_Clone_01" }))
    expect(screen.getByText("helloo world!")).toBeInTheDocument()
    const assignmentsRegion = screen.getByRole("region", { name: /voice assignments/i })
    expect(assignmentsRegion).toHaveTextContent("1 Assignment")
    expect(assignmentsRegion).toHaveTextContent("3 Speech Segments")

    fireEvent.change(textarea, { target: { value: "say hello world! now" } })

    expect(screen.queryByText(/could not be matched/i)).not.toBeInTheDocument()
    expect(screen.getByText("hello world!")).toBeInTheDocument()
    expect(assignmentsRegion).toHaveTextContent("3 Speech Segments")

    const secondAssignmentStart = "say hello world! ".length
    textarea.setSelectionRange(secondAssignmentStart, "say hello world! now".length)
    fireEvent.select(textarea)
    await user.click(screen.getByRole("button", { name: "Assign Selected Text to Voice_Clone_01" }))
    expect(screen.getByText("now")).toBeInTheDocument()
    expect(assignmentsRegion).toHaveTextContent("2 Assignments")
    expect(assignmentsRegion).toHaveTextContent("3 Speech Segments")
    const naturalHandoffs = screen.getByRole("checkbox", { name: "Natural Handoffs" })
    expect(naturalHandoffs).toBeChecked()
    await user.click(naturalHandoffs)
    expect(naturalHandoffs).not.toBeChecked()

    await waitFor(() => expect(screen.getByRole("button", { name: /^Generate$/ })).toBeEnabled())

    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(createJobBody).not.toBeNull())
    expect(createJobBody).toMatchObject({
      segmentGapMs: 0,
      segments: [
        expect.objectContaining({
          assignmentKind: "default",
          text: "say ",
          voiceId: "default",
        }),
        expect.objectContaining({
          assignmentKind: "assigned",
          text: "hello world! ",
          voiceId: "voice-clone-01",
        }),
        expect.objectContaining({
          assignmentKind: "assigned",
          text: "now",
          voiceId: "voice-clone-01",
        }),
      ],
      text: "say hello world! now",
    })

    await user.click(await screen.findByRole("button", { name: /show segments/i }))
    await user.click(screen.getAllByRole("button", { name: /^Tune$/i })[0])
    fireEvent.change(screen.getByRole("slider", { name: /^Speed$/i }), { target: { value: "1.2" } })
    await user.click(screen.getAllByRole("button", { name: /^Regenerate$/i })[0])

    await waitFor(() => expect(regenerateSegmentBody).not.toBeNull())
    expect(regenerateSegmentBody).toMatchObject({
      voiceId: null,
      voiceSettings: expect.objectContaining({
        speed: 1.2,
      }),
    })
  })

  it("loads a saved disabled natural handoffs browser default", async () => {
    localStorage.setItem(NATURAL_HANDOFFS_STORAGE_KEY, "false")
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const textarea = screen.getByLabelText(/text to speak/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "say hello world now" } })
    textarea.setSelectionRange("say ".length, "say hello world".length)
    fireEvent.select(textarea)

    await user.click(screen.getByRole("button", { name: /^Assign Voice$/i }))
    await user.click(screen.getByRole("button", { name: "Default voice" }))

    expect(screen.getByRole("checkbox", { name: "Natural Handoffs" })).not.toBeChecked()
  })

  it("saves natural handoffs browser default changes", async () => {
    const user = userEvent.setup()

    async function showNaturalHandoffsControl() {
      await screen.findByText("default/default-voice.mp3")
      const textarea = screen.getByLabelText(/text to speak/i) as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "say hello world now" } })
      textarea.setSelectionRange("say ".length, "say hello world".length)
      fireEvent.select(textarea)

      await user.click(screen.getByRole("button", { name: /^Assign Voice$/i }))
      await user.click(screen.getByRole("button", { name: "Default voice" }))

      return screen.getByRole("checkbox", { name: "Natural Handoffs" })
    }

    const firstRender = renderApp()
    const initialHandoffs = await showNaturalHandoffsControl()

    expect(initialHandoffs).toBeChecked()
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()

    await user.click(initialHandoffs)
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(localStorage.getItem(NATURAL_HANDOFFS_STORAGE_KEY)).toBe("false")
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()

    firstRender.unmount()

    renderApp()
    const savedHandoffs = await showNaturalHandoffsControl()

    expect(savedHandoffs).not.toBeChecked()

    await user.click(savedHandoffs)
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(localStorage.getItem(NATURAL_HANDOFFS_STORAGE_KEY)).toBe("true")
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
  })

  it("blocks multi-voice generation when an assigned voice is deleted", async () => {
    window.history.replaceState(null, "", "/#generate")
    const createSpeechJob = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        if (path === "/api/voices/voice-clone-01" && init?.method === "DELETE") {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (path === "/api/models" && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (path === "/api/sample-processing/options" && !init) {
          return okJson(sampleProcessingOptions)
        }
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          createSpeechJob(init)
          return okJson({})
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const textarea = screen.getByLabelText(/text to speak/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "default intro assigned line" } })
    textarea.setSelectionRange("default intro ".length, "default intro assigned".length)
    fireEvent.select(textarea)

    await user.click(screen.getByRole("button", { name: /^Assign Voice$/i }))
    await user.click(screen.getByRole("button", { name: "Voice_Clone_01" }))
    expect(screen.getByText("assigned")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: /^Generate$/ })).toBeEnabled())

    await user.click(screen.getByRole("button", { name: "Voices" }))
    await user.click(await screen.findByRole("button", { name: /open actions for voice_clone_01/i }))
    await user.click(screen.getByRole("menuitem", { name: /delete/i }))
    const dialog = screen.getByRole("dialog", { name: /delete voice/i })
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/voices/voice-clone-01", expect.objectContaining({ method: "DELETE" }))
    )
    await user.click(screen.getByRole("button", { name: "Generate Speech" }))

    expect(
      await screen.findByText("Some assigned voices are no longer in the Voice Library. Remove or update those assignments before generating.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Generate$/ })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    expect(createSpeechJob).not.toHaveBeenCalled()
  })

  it("blocks dialogue row generation when edited text exceeds the speech limit", async () => {
    window.history.replaceState(null, "", "/#generate")
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    fireEvent.change(screen.getByLabelText(/text to speak/i), { target: { value: "Skippy: Hello." } })
    await user.click(screen.getByRole("radio", { name: "Dialogue Rows" }))
    await user.click(screen.getByRole("button", { name: "Import Dialogue" }))
    await user.click(screen.getByRole("button", { name: "Map Voice" }))
    await user.click(screen.getByRole("button", { name: "Default voice" }))
    await waitFor(() => expect(screen.getByRole("button", { name: /^Generate$/ })).toBeEnabled())

    fireEvent.change(screen.getByLabelText("Dialogue"), {
      target: { value: "x".repeat(MAX_SPEECH_TEXT_LENGTH + 1) },
    })

    expect(screen.getByText(`${MAX_SPEECH_TEXT_LENGTH + 1}/${MAX_SPEECH_TEXT_LENGTH}`)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Generate$/ })).toBeDisabled()
  })

  it("applies dialogue row tuning to same-voice rows before generation", async () => {
    window.history.replaceState(null, "", "/#generate")
    let createJobBody: {
      defaultVoiceId: string
      segments: Array<{
        assignmentKind: string
        clientSegmentId: string
        text: string
        voiceId: string
        voiceSettings?: Record<string, unknown> | null
      }>
      text: string
      voiceSettings?: Record<string, unknown> | null
    } | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (path === "/api/models" && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          createJobBody = JSON.parse(String(init.body))
          return okJson({ job: speechJobFromSubmitted(createJobBody) })
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio()
        }
        if (path.startsWith("/api/speech/jobs/job-1/segments/") && path.endsWith("/result") && !init) {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    fireEvent.change(screen.getByLabelText(/text to speak/i), {
      target: { value: "Skippy: One.\nSkippy: Two." },
    })
    await user.click(screen.getByRole("radio", { name: "Dialogue Rows" }))
    await user.click(screen.getByRole("button", { name: "Import Dialogue" }))
    await user.click(screen.getByRole("button", { name: "Map Voice" }))
    await user.click(screen.getByRole("button", { name: "Default voice" }))
    await user.click(screen.getByRole("button", { name: "Tune Dialogue Row 1" }))
    fireEvent.change(screen.getByRole("slider", { name: "Speed" }), { target: { value: "1.12" } })
    await user.click(screen.getByRole("button", { name: "Open Dialogue Row 1 Tuning Actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Apply To Same Voice" }))
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(createJobBody).not.toBeNull())
    const submittedJob = createJobBody as unknown as NonNullable<Parameters<typeof speechJobFromSubmitted>[0]>
    expect(submittedJob.segments.map((segment) => segment.voiceSettings)).toEqual([
      {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        speed: 1.12,
        useSpeakerBoost: true,
      },
      {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        speed: 1.12,
        useSpeakerBoost: true,
      },
    ])
  })

  it("shows lifted dialogue pending progress while a speech job runs", async () => {
    window.history.replaceState(null, "", "/#generate")
    let createJobBody: NonNullable<Parameters<typeof speechJobFromSubmitted>[0]> | null = null
    let pollRequested = false
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (path === "/api/models" && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          createJobBody = JSON.parse(String(init.body))
          return okJson({ job: runningSpeechJobFromSubmitted(createJobBody, { activeSegmentId: null }) })
        }
        if (path === "/api/speech/jobs/job-1" && !init) {
          pollRequested = true
          return new Promise<Response>(() => undefined)
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio()
        }
        if (path.startsWith("/api/speech/jobs/job-1/segments/") && path.endsWith("/result") && !init) {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    fireEvent.change(screen.getByLabelText(/text to speak/i), {
      target: { value: "Skippy: One.\nSkippy: Two." },
    })
    await user.click(screen.getByRole("radio", { name: "Dialogue Rows" }))
    await user.click(screen.getByRole("button", { name: "Import Dialogue" }))
    await user.click(screen.getByRole("button", { name: "Map Voice" }))
    await user.click(screen.getByRole("button", { name: "Default voice" }))
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    const pending = await screen.findByRole("status", { name: "Generating Dialogue" })
    expect(pending).toHaveTextContent("Rendering dialogue rows into a combined audio result.")
    expect(pending).toHaveTextContent("2 Segments")
    expect(pending).toHaveTextContent("Active: Segment 1: Default voice")
    expect(pending).toHaveTextContent("Segment 1")
    expect(pending).toHaveTextContent("Running")
    expect(pending).toHaveTextContent("Segment 2")
    expect(pending).toHaveTextContent("Queued")
    const progress = within(pending).getByRole("list", { name: "Generation Progress" })
    expect(within(progress).getAllByRole("listitem")[0]).toHaveClass("border-primary/60")

    await waitFor(() => expect(pollRequested).toBe(true))
  })

  it("saves generated dialogue row tuning to the voice library", async () => {
    window.history.replaceState(null, "", "/#generate")
    let createJobBody: {
      defaultVoiceId: string
      segments: Array<{
        assignmentKind: string
        clientSegmentId: string
        text: string
        voiceId: string
        voiceSettings?: Record<string, unknown> | null
      }>
      text: string
      voiceSettings?: Record<string, unknown> | null
    } | null = null
    let patchVoiceBody: { providerId?: string; voiceSettings?: Record<string, unknown> } | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/voices/default" && init?.method === "PATCH") {
          patchVoiceBody = JSON.parse(String(init.body))
          return okJson({
            defaultVoiceId: "default",
            voices: [
              {
                ...defaultVoice,
                voiceSettingsByProvider: {
                  elevenlabs: patchVoiceBody?.voiceSettings ?? {},
                },
              },
            ],
          })
        }
        if (path === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (path === "/api/models" && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          createJobBody = JSON.parse(String(init.body))
          return okJson({ job: speechJobFromSubmitted(createJobBody) })
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio()
        }
        if (path.startsWith("/api/speech/jobs/job-1/segments/") && path.endsWith("/result") && !init) {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    fireEvent.change(screen.getByLabelText(/text to speak/i), { target: { value: "Skippy: Hello." } })
    await user.click(screen.getByRole("radio", { name: "Dialogue Rows" }))
    await user.click(screen.getByRole("button", { name: "Import Dialogue" }))
    await user.click(screen.getByRole("button", { name: "Map Voice" }))
    await user.click(screen.getByRole("button", { name: "Default voice" }))
    await user.click(screen.getByRole("button", { name: "Tune Dialogue Row 1" }))
    fireEvent.change(screen.getByRole("slider", { name: "Speed" }), { target: { value: "1.12" } })
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(createJobBody).not.toBeNull())
    const submittedJob = createJobBody as unknown as NonNullable<Parameters<typeof speechJobFromSubmitted>[0]>
    expect(submittedJob.segments[0].voiceSettings).toEqual({
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speed: 1.12,
      useSpeakerBoost: true,
    })

    await screen.findByRole("heading", { name: "Latest Generated Audio" })
    const latestPanel = latestGeneratedAudioPanel()
    await user.click(latestPanel.getByRole("button", { name: /show segments/i }))
    expect(latestPanel.queryByRole("button", { name: "Save Tuning To Voice" })).not.toBeInTheDocument()
    await user.click(latestPanel.getAllByRole("button", { name: /^Tune$/i })[0])
    await user.click(screen.getByRole("button", { name: "Open Segment 1 Tuning Actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Save Tuning To Voice" }))

    await waitFor(() => expect(patchVoiceBody).not.toBeNull())
    expect(patchVoiceBody).toEqual({
      providerId: "elevenlabs",
      voiceSettings: submittedJob.segments[0].voiceSettings,
    })
  })

  it("regenerates all generated segments for a shared voice", async () => {
    window.history.replaceState(null, "", "/#generate")
    let createJobBody: {
      defaultVoiceId: string
      segments: Array<{
        assignmentKind: string
        clientSegmentId: string
        text: string
        voiceId: string
        voiceSettings?: Record<string, unknown> | null
      }>
      text: string
      voiceSettings?: Record<string, unknown> | null
    } | null = null
    let regenerateVoiceBody: { voiceSettings?: Record<string, unknown> } | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (path === "/api/models" && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (path === "/api/speech/jobs" && init?.method === "POST") {
          createJobBody = JSON.parse(String(init.body))
          return okJson({ job: speechJobFromSubmitted(createJobBody) })
        }
        if (path === "/api/speech/jobs/job-1/voices/default/regenerate" && init?.method === "POST") {
          regenerateVoiceBody = JSON.parse(String(init.body))
          return okJson({
            job: speechJobFromSubmitted(createJobBody, {
              generationCount: 2,
              resultSha256: "combined-hash-2",
              voiceSettings: regenerateVoiceBody?.voiceSettings ?? null,
            }),
          })
        }
        if (path === "/api/speech/jobs/job-1/result" && !init) {
          return okAudio()
        }
        if (path.startsWith("/api/speech/jobs/job-1/segments/") && path.endsWith("/result") && !init) {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    fireEvent.change(screen.getByLabelText(/text to speak/i), {
      target: { value: "Skippy: One.\nSkippy: Two." },
    })
    await user.click(screen.getByRole("radio", { name: "Dialogue Rows" }))
    await user.click(screen.getByRole("button", { name: "Import Dialogue" }))
    await user.click(screen.getByRole("button", { name: "Map Voice" }))
    await user.click(screen.getByRole("button", { name: "Default voice" }))
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    await waitFor(() => expect(createJobBody).not.toBeNull())
    const submittedJob = createJobBody as unknown as NonNullable<Parameters<typeof speechJobFromSubmitted>[0]>
    expect(submittedJob.segments).toHaveLength(2)

    await screen.findByRole("heading", { name: "Latest Generated Audio" })
    const latestPanel = latestGeneratedAudioPanel()
    await user.click(latestPanel.getByRole("button", { name: /show segments/i }))
    await user.click(latestPanel.getAllByRole("button", { name: /^Tune$/i })[0])
    fireEvent.change(screen.getByRole("slider", { name: "Speed" }), { target: { value: "1.08" } })
    expect(latestPanel.queryByRole("button", { name: "Regenerate All For Voice" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open Segment 1 Tuning Actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Regenerate Same Voice Segments" }))

    await waitFor(() => expect(regenerateVoiceBody).not.toBeNull())
    expect(regenerateVoiceBody).toEqual({
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        speed: 1.08,
        useSpeakerBoost: true,
      },
    })
  })

  it("links from the voice library to speech generation", async () => {
    window.history.replaceState(null, "", "/#voices")
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByText("default/default-voice.mp3")).toBeInTheDocument()
    expect(voiceLibraryPanel().queryByText("Selected Preview")).not.toBeInTheDocument()
    expect(voiceLibraryPanel().getByRole("button", { name: "Show Voice Tuning" })).toBeInTheDocument()
    expect(voiceLibraryPanel().queryByRole("radiogroup", { name: "Voice Preset" })).not.toBeInTheDocument()

    const defaultVoiceRow = voiceLibraryRow("Default voice")
    expect(defaultVoiceRow.getByRole("group", { name: "Voice sample preview for Default voice" })).toBeInTheDocument()
    expect(defaultVoiceRow.getByRole("link", { name: "Generate Speech" })).toHaveAttribute("href", "#generate")
    expect(voiceLibraryRow("Voice_Clone_01").queryByRole("link", { name: "Generate Speech" })).not.toBeInTheDocument()

    await user.click(voiceLibraryPanel().getByRole("button", { name: /^Voice_Clone_01/i }))
    expect(voiceLibraryRow("Default voice").queryByRole("group", { name: /Voice sample preview/i })).not.toBeInTheDocument()
    const selectedCloneRow = voiceLibraryRow("Voice_Clone_01")
    expect(selectedCloneRow.getByRole("group", { name: "Voice sample preview for Voice_Clone_01" })).toBeInTheDocument()
    const generateLink = selectedCloneRow.getByRole("link", { name: "Generate Speech" })
    expect(generateLink).toHaveAttribute("href", "#generate")

    await user.click(generateLink)

    await waitFor(() => expect(window.location.hash).toBe("#generate"))
    expect(screen.getByRole("button", { name: "Generate Speech" })).toHaveAttribute("aria-current", "page")
    expect(document.querySelector('[data-section-id="generate"]')).not.toHaveClass("hidden")
    expect(document.querySelector('[data-section-id="voices"]')).toHaveClass("hidden")
  })

  it("links from the voice library to prepare audio for new samples", async () => {
    window.history.replaceState(null, "", "/#voices")
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByText("default/default-voice.mp3")).toBeInTheDocument()
    const addVoiceSampleLink = voiceLibraryPanel().getByRole("link", { name: "Add Voice Sample" })
    expect(addVoiceSampleLink).toHaveAttribute("href", "#prepare")

    await user.click(addVoiceSampleLink)

    await waitFor(() => expect(window.location.hash).toBe("#prepare"))
    expect(screen.getByRole("button", { name: "Prepare Audio" })).toHaveAttribute("aria-current", "page")
    const preparePanel = prepareAudioPanel()
    expect(preparePanel.getByRole("button", { name: /upload ready voice sample/i })).toBeInTheDocument()
    expect(preparePanel.getByRole("button", { name: /process source media/i })).toBeInTheDocument()
    expect(preparePanel.queryByRole("form", { name: "Add Voice" })).not.toBeInTheDocument()
  })

  it("keeps add voice in prepare and out of voices", async () => {
    window.history.replaceState(null, "", "/#voices")
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByText("default/default-voice.mp3")).toBeInTheDocument()
    const voicesSection = document.querySelector('[data-section-id="voices"]') as HTMLElement
    expect(voicesSection).not.toHaveClass("hidden")
    expect(document.querySelector('[data-section-id="prepare"]')).toHaveClass("hidden")
    expect(within(voicesSection).queryByRole("form", { name: "Add Voice" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Prepare Audio" }))
    await waitFor(() => expect(window.location.hash).toBe("#prepare"))

    expect(prepareAudioPanel().queryByRole("form", { name: "Add Voice" })).not.toBeInTheDocument()
    expect(addVoicePanel().getByRole("group", { name: "Audio Drop Zone" })).toBeInTheDocument()
    expect(addVoicePanel().getByRole("textbox", { name: "Voice Name" })).toBeInTheDocument()
  })

  it("keeps empty voice selection separate from add voice", async () => {
    window.history.replaceState(null, "", "/#voices")
    const user = userEvent.setup()
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "", voices: [] })
        }
        return baseFetch(input, init)
      })
    )
    renderApp()

    expect(await voiceLibraryPanel().findByText("No Voices Saved Yet")).toBeInTheDocument()
    expect(voiceLibraryPanel().getByText("Prepare an audio sample before selecting a voice.")).toBeInTheDocument()
    const prepareAudioLink = voiceLibraryPanel().getByRole("link", { name: "Prepare Audio" })
    expect(prepareAudioLink).toHaveAttribute("href", "#prepare")
    const voicesSection = document.querySelector('[data-section-id="voices"]') as HTMLElement
    expect(within(voicesSection).queryByRole("form", { name: "Add Voice" })).not.toBeInTheDocument()

    await user.click(prepareAudioLink)

    await waitFor(() => expect(window.location.hash).toBe("#prepare"))
    const preparePanel = prepareAudioPanel()
    expect(preparePanel.getByRole("button", { name: /upload ready voice sample/i })).toBeInTheDocument()
    expect(preparePanel.queryByRole("form", { name: "Add Voice" })).not.toBeInTheDocument()
  })

  it("closes mobile workflow navigation after selecting a section", async () => {
    mockWorkflowViewport(true)
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole("button", { name: "Toggle Workflow Navigation" }))

    expect(await screen.findByRole("dialog", { name: "Workflow Navigation" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Provider & Usage" }))

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Workflow Navigation" })).not.toBeInTheDocument()
    )
    expect(window.location.hash).toBe("#provider")
    expect(screen.getByRole("heading", { level: 2, name: "Provider & Usage" })).toBeInTheDocument()
  })

  it("shows missing key state and uses a saved browser key for provider requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson({
            ...providersResponse,
            providers: [{ ...providersResponse.providers[0], serverKeyConfigured: false }],
          })
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url.startsWith("/api/subscription")) {
          return okJson(subscription)
        }
        if (url.startsWith("/api/models")) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    const keyInput = await screen.findByLabelText(/ElevenLabs API Key/i)
    expect((await screen.findAllByText("Needs Key")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("Missing Key")).toHaveLength(2)
    expect(screen.getByRole("button", { name: /^Generate$/ })).toBeDisabled()

    await user.type(keyInput, "browser-key")
    await user.click(screen.getByRole("button", { name: /save key/i }))

    expect(JSON.parse(localStorage.getItem(PROVIDER_KEYS_STORAGE_KEY) || "{}")).toEqual({ elevenlabs: "browser-key" })
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/subscription?providerId=elevenlabs",
        expect.objectContaining({
          headers: { [VOICE_PROVIDER_KEY_HEADER]: "browser-key" },
        })
      )
    )

    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    expect(speechCall?.[1]?.headers).toEqual({ [VOICE_PROVIDER_KEY_HEADER]: "browser-key" })
  })

  it("keeps backend provider fallback available when provider settings fail to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: "Provider settings failed." }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            })
          )
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url.startsWith("/api/subscription") && !init) {
          return okJson(subscription)
        }
        if (url.startsWith("/api/models") && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByText("Provider Settings Unavailable")).toBeInTheDocument()
    expect(await screen.findByText("default/default-voice.mp3")).toBeInTheDocument()
    const generateButton = screen.getByRole("button", { name: /^Generate$/ })
    await waitFor(() => expect(generateButton).toBeEnabled())

    await user.click(generateButton)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    expect(speechCall?.[1]?.headers).toBeUndefined()
  })

  it("loads a saved browser key securely with peek copy and clear controls", async () => {
    localStorage.setItem(PROVIDER_KEYS_STORAGE_KEY, JSON.stringify({ elevenlabs: "stored-key" }))
    const user = userEvent.setup()
    if (!window.navigator.clipboard) {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn() },
      })
    }
    const clipboardWrite = vi.spyOn(window.navigator.clipboard, "writeText").mockResolvedValue(undefined)
    renderApp()

    const keyInput = await screen.findByLabelText(/ElevenLabs API Key/i)
    expect(keyInput).toHaveValue("stored-key")
    expect(keyInput).toHaveAttribute("type", "password")

    await user.click(screen.getByRole("button", { name: /peek key/i }))
    expect(keyInput).toHaveAttribute("type", "text")

    const copyButton = screen.getByRole("button", { name: /copy key/i })
    expect(copyButton).toBeEnabled()
    fireEvent.click(copyButton)
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith("stored-key"))
    expect(await screen.findByText("Copied")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /clear key/i }))
    expect(localStorage.getItem(PROVIDER_KEYS_STORAGE_KEY)).toBeNull()
    expect(keyInput).toHaveValue("")
    expect(screen.getByText(".env Fallback")).toBeInTheDocument()
  })

  it("ignores stale metadata responses after saving a browser key", async () => {
    const staleSubscription = deferredResponse()
    const staleModels = deferredResponse()
    const browserSubscription = {
      ...subscription,
      characterCount: 8766,
      remainingCharacters: 1234,
    }
    const browserModel = {
      ...flashModel,
      modelId: "browser_model",
      name: "Browser Model",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url.startsWith("/api/subscription") && init?.headers) {
          return okJson(browserSubscription)
        }
        if (url.startsWith("/api/subscription") && !init) {
          return staleSubscription.promise
        }
        if (url.startsWith("/api/models") && init?.headers) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "browser_model",
            models: [browserModel],
          })
        }
        if (url.startsWith("/api/models") && !init) {
          return staleModels.promise
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByLabelText(/ElevenLabs API Key/i)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/subscription?providerId=elevenlabs", undefined))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/models?providerId=elevenlabs", undefined))

    await user.type(screen.getByLabelText(/ElevenLabs API Key/i), "browser-key")
    await user.click(screen.getByRole("button", { name: /save key/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/subscription?providerId=elevenlabs",
        expect.objectContaining({
          headers: { [VOICE_PROVIDER_KEY_HEADER]: "browser-key" },
        })
      )
    )
    expect(await screen.findByText(`${formatTestNumber(1234)} remaining`)).toBeInTheDocument()
    expect(screen.getByLabelText(/model/i)).toHaveValue("browser_model")

    staleSubscription.resolve(
      new Response(JSON.stringify(subscription), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    staleModels.resolve(
      new Response(
        JSON.stringify({
          available: true,
          error: null,
          defaultModelId: "eleven_multilingual_v2",
          models: [multilingualModel, flashModel],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    )
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(screen.getByText(`${formatTestNumber(1234)} remaining`)).toBeInTheDocument()
    expect(screen.queryByText(`${formatTestNumber(9000)} remaining`)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/model/i)).toHaveValue("browser_model")
  })

  it("shows provider usage details expanded", async () => {
    renderApp()

    const providerSection = document.querySelector('[data-section-id="provider"]')
    expect(providerSection).not.toBeNull()
    const providerPanel = within(providerSection as HTMLElement)
    const costHeading = await providerPanel.findByText("Cost & Quota")
    const providerKeysHeading = providerPanel.getByRole("heading", { level: 2, name: "Provider Keys" })
    expect(providerKeysHeading.compareDocumentPosition(costHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await providerPanel.findByText(`${formatTestNumber(9000)} remaining`)).toBeInTheDocument()
    expect(providerPanel.getByText(`~${formatTestNumber(97)}`)).toBeInTheDocument()
    expect(providerPanel.getByText("No run")).toBeInTheDocument()
    const costQuotaDetails = document.querySelector("#cost-quota-details")
    expect(costQuotaDetails).toBeInTheDocument()
    expect(costQuotaDetails).not.toHaveAttribute("hidden")
    expect(providerPanel.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument()
    expect(providerPanel.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument()
    expect(providerPanel.getByLabelText(/model/i)).toHaveValue("eleven_multilingual_v2")
    expect(providerPanel.getByText(`${formatTestNumber(1000)} / ${formatTestNumber(10000)}`)).toBeInTheDocument()
    expect(providerPanel.getByRole("link", { name: /api requests/i })).toHaveAttribute(
      "href",
      "https://elevenlabs.io/app/developers/analytics/api-requests"
    )
    expect(providerPanel.getByRole("link", { name: /models/i })).toHaveAttribute(
      "href",
      "https://elevenlabs.io/docs/api-reference/models/list"
    )
  })

  it("starts Prepare Audio with workflow choices and reveals one workflow at a time", async () => {
    window.history.replaceState(null, "", "/#prepare")
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const prepareSection = document.querySelector('[data-section-id="prepare"]') as HTMLElement
    const voicesSection = document.querySelector('[data-section-id="voices"]') as HTMLElement
    const preparePanel = within(prepareSection)
    const addVoiceChoice = preparePanel.getByRole("button", { name: /upload ready voice sample/i })
    const processAudioChoice = preparePanel.getByRole("button", { name: /process source media/i })

    expect(prepareSection).not.toHaveClass("hidden")
    expect(voicesSection).toHaveClass("hidden")
    expectElementBefore(addVoiceChoice, processAudioChoice)
    expect(preparePanel.queryByRole("form", { name: "Add Voice" })).not.toBeInTheDocument()
    expect(preparePanel.queryByRole("heading", { name: "Sample Processing" })).not.toBeInTheDocument()

    await user.click(addVoiceChoice)

    expect(preparePanel.getByRole("form", { name: "Add Voice" })).toBeInTheDocument()
    expectHiddenAudioInputDoesNotWidenPage("sample-upload")
    expect(preparePanel.queryByRole("heading", { name: "Sample Processing" })).not.toBeInTheDocument()

    await user.click(processAudioChoice)

    expect(preparePanel.queryByRole("form", { name: "Add Voice" })).not.toBeInTheDocument()
    expect(preparePanel.getByRole("heading", { name: "Sample Processing" })).toBeInTheDocument()
    expect(preparePanel.getByRole("radio", { name: "Audio File" })).toHaveAttribute("aria-checked", "true")
    expectHiddenAudioInputDoesNotWidenPage("sample-processing-file")
    expect(preparePanel.getByRole("group", { name: "Audio Drop Zone" })).toBeInTheDocument()
  })

  it("explains Easy Prepare ranking and exposes cleanup preset controls", async () => {
    window.history.replaceState(null, "", "/#prepare")
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/options" && !init) {
          return okJson({
            ...sampleProcessingOptions,
            engine: "demucs+ffmpeg",
            recommendedWorkflowOrder: ["prepareVoice", ...sampleProcessingOptions.recommendedWorkflowOrder],
            operations: [
              {
                id: "prepareVoice",
                label: "Prepare Voice",
                description: "Rank provider-ready samples.",
                enabled: true,
                defaultProcessingPresetId: null,
                processingPresets: [],
              },
              ...sampleProcessingOptions.operations,
            ],
          })
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const prepareSection = document.querySelector('[data-section-id="prepare"]') as HTMLElement
    await user.click(within(prepareSection).getByRole("button", { name: /process source media/i }))

    expect(
      sampleProcessingPanel().getByText(/Runs selected cleanup first, then detects speech regions, ranks provider-sized windows/i)
    ).toBeInTheDocument()
    expect(sampleProcessingPresetSelect("Isolation Strength")).toHaveAccessibleName("Isolation Strength: Balanced")
    expect(sampleProcessingPresetSelect("Trim Aggressiveness")).toHaveAccessibleName("Trim Aggressiveness: Balanced")

    await chooseSampleProcessingPreset(user, "Isolation Strength", "Max Isolation")
    await chooseSampleProcessingPreset(user, "Trim Aggressiveness", "Aggressive")

    expect(sampleProcessingPresetSelect("Isolation Strength")).toHaveAccessibleName("Isolation Strength: Max Isolation")
    expect(sampleProcessingPresetSelect("Trim Aggressiveness")).toHaveAccessibleName("Trim Aggressiveness: Aggressive")
  })

  it("restores a running Prepare Audio job on #prepare", async () => {
    window.history.replaceState(null, "", "/#prepare")
    localStorage.setItem(ACTIVE_SAMPLE_PROCESSING_JOB_STORAGE_KEY, "job-prepare")
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/options" && !init) {
          return okJson({
            ...sampleProcessingOptions,
            recommendedWorkflowOrder: ["prepareVoice", ...sampleProcessingOptions.recommendedWorkflowOrder],
            operations: [
              {
                id: "prepareVoice",
                label: "Prepare Voice",
                description: "Rank provider-ready samples.",
                enabled: true,
                defaultProcessingPresetId: null,
                processingPresets: [],
              },
              ...sampleProcessingOptions.operations,
            ],
          })
        }
        if (path === "/api/sample-processing/jobs/job-prepare" && !init) {
          return okJson({
            job: {
              ...successfulSampleProcessingJob.job,
              id: "job-prepare",
              operationId: "prepareVoice",
              operationLabel: "Prepare Voice",
              status: "running",
              sourceName: "Long Source",
              sourceFilename: "long-source.mp3",
              sourceContentType: "audio/mpeg",
              sourceSizeBytes: 3_355_443,
              engine: "ffmpeg",
              steps: [],
              activeStepId: null,
              estimatedDurationRangeSeconds: {
                minSeconds: 75,
                maxSeconds: 210,
              },
              progressPhases: [
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
          })
        }
        return baseFetch(input, init)
      })
    )

    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const preparePanel = prepareAudioPanel()

    expect(preparePanel.getByRole("button", { name: /process source media/i })).toHaveAttribute("aria-pressed", "true")
    expect(preparePanel.getByRole("heading", { name: "Sample Processing" })).toBeInTheDocument()
    expect(await preparePanel.findByText("Workflow Progress")).toBeInTheDocument()
    expect(preparePanel.getByText("Active Phase: Detect Speech Regions")).toBeInTheDocument()
    expect(preparePanel.getByText("Estimated Time 1m 15s to 3m 30s")).toBeInTheDocument()
    expect(localStorage.getItem(ACTIVE_SAMPLE_PROCESSING_JOB_STORAGE_KEY)).toBe("job-prepare")
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it("scrolls to sample processing progress when source media processing starts", async () => {
    window.history.replaceState(null, "", "/#prepare")
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/options" && !init) {
          return okJson({
            ...sampleProcessingOptions,
            recommendedWorkflowOrder: ["prepareVoice", ...sampleProcessingOptions.recommendedWorkflowOrder],
            operations: [
              {
                id: "prepareVoice",
                label: "Prepare Voice",
                description: "Rank provider-ready samples.",
                enabled: true,
                defaultProcessingPresetId: null,
                processingPresets: [],
              },
              ...sampleProcessingOptions.operations,
            ],
          })
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(prepareAudioPanel().getByRole("button", { name: /process source media/i }))
    await user.click(sampleProcessingPanel().getByRole("radio", { name: "Saved Voice" }))
    const processButton = sampleProcessingPanel().getByRole("button", { name: "Process Source Media" })
    await waitFor(() => expect(processButton).toBeEnabled())

    await user.click(processButton)

    const progressHeading = await sampleProcessingPanel().findByText("Workflow Progress")
    const progressSection = progressHeading.closest("section")
    expect(progressSection?.parentElement).not.toBeNull()
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      })
    )
    expect(scrollIntoView.mock.contexts).toContain(progressSection?.parentElement)
  })

  it("orders sample processing controls from source to workflow to action", async () => {
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    const sourceLabel = sampleProcessingPanel().getByText("Source")
    const workflowStackLabel = sampleProcessingPanel().getByText("Workflow Stack")
    const startButton = sampleProcessingPanel().getByRole("button", { name: "Start Processing" })

    expectElementBefore(sourceLabel, workflowStackLabel)
    expectElementBefore(workflowStackLabel, startButton)
  })

  it("shows saved voice source cards with compact playback and submits the selected voice", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    expect(sampleProcessingPanel().getByText("Select Voice")).toBeInTheDocument()
    expect(sampleProcessingPanel().getAllByText("Saved Voice")).toHaveLength(1)
    expect(sampleProcessingPanel().queryByRole("button", { name: /Sample Processing Saved Voice/i })).not.toBeInTheDocument()
    const defaultCard = within(sampleProcessingPanel().getByRole("group", { name: "Default voice Source Voice" }))
    const cloneCard = within(sampleProcessingPanel().getByRole("group", { name: "Voice_Clone_01 Source Voice" }))
    expect(defaultCard.getByText("Standard Narration")).toBeInTheDocument()
    expect(defaultCard.getByLabelText("Included default voice")).toBeInTheDocument()
    expect(defaultCard.queryByText("Default")).not.toBeInTheDocument()
    expect(cloneCard.queryByText("Uploaded")).not.toBeInTheDocument()
    expect(cloneCard.getByText("Source: voice-clone-01.mp3")).toBeInTheDocument()
    expect(cloneCard.getByRole("button", { name: "Select Voice_Clone_01" })).toHaveAttribute("aria-pressed", "false")
    expect(document.querySelector('audio[src="/api/voices/voice-clone-01/sample"]')).toHaveAttribute("preload", "none")

    await user.click(cloneCard.getByRole("button", { name: "Play Voice_Clone_01 Preview" }))
    expect(playSpy).toHaveBeenCalled()
    expect(cloneCard.getByRole("button", { name: "Select Voice_Clone_01" })).toHaveAttribute("aria-pressed", "false")
    await user.click(cloneCard.getByRole("button", { name: "Pause Voice_Clone_01 Preview" }))
    expect(pauseSpy).toHaveBeenCalled()

    await user.click(cloneCard.getByRole("button", { name: "Select Voice_Clone_01" }))
    expect(cloneCard.getByRole("button", { name: "Select Voice_Clone_01" })).toHaveAttribute("aria-pressed", "true")

    const startButton = sampleProcessingPanel().getByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("sourceVoiceId")).toBe("voice-clone-01")
  })

  it("keeps compact saved voice previews exclusive and stops them when the carousel unmounts", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    const defaultCard = within(sampleProcessingPanel().getByRole("group", { name: "Default voice Source Voice" }))
    const cloneCard = within(sampleProcessingPanel().getByRole("group", { name: "Voice_Clone_01 Source Voice" }))

    await user.click(defaultCard.getByRole("button", { name: "Play Default voice Preview" }))
    expect(playSpy).toHaveBeenCalledTimes(1)
    expect(defaultCard.getByRole("button", { name: "Pause Default voice Preview" })).toBeInTheDocument()

    await user.click(cloneCard.getByRole("button", { name: "Play Voice_Clone_01 Preview" }))
    expect(playSpy).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(pauseSpy).toHaveBeenCalled())
    expect(defaultCard.getByRole("button", { name: "Play Default voice Preview" })).toBeInTheDocument()
    expect(cloneCard.getByRole("button", { name: "Pause Voice_Clone_01 Preview" })).toBeInTheDocument()

    pauseSpy.mockClear()
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Start Processing" }))
    await waitFor(() => expect(pauseSpy).toHaveBeenCalled())
    await waitFor(() =>
      expect(cloneCard.getByRole("button", { name: "Play Voice_Clone_01 Preview" })).toBeInTheDocument()
    )

    await user.click(cloneCard.getByRole("button", { name: "Play Voice_Clone_01 Preview" }))
    expect(playSpy).toHaveBeenCalledTimes(3)
    expect(cloneCard.getByRole("button", { name: "Pause Voice_Clone_01 Preview" })).toBeInTheDocument()

    pauseSpy.mockClear()
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Use Audio File" }))
    expect(sampleProcessingPanel().getByLabelText("Audio File")).toHaveAttribute("tabindex", "-1")
    await waitFor(() => expect(pauseSpy).toHaveBeenCalled())
  })

  it("contains horizontal wheel gestures inside the saved voice carousel", async () => {
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        return baseFetch(input, init)
      })
    )
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    const carousel = sampleProcessingPanel().getByRole("group", { name: "Select Voice" })
    Object.defineProperties(carousel, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 900 },
    })

    expect(carousel).toHaveClass("overscroll-x-contain")

    carousel.scrollLeft = 0
    const leftBoundaryWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: -80 })
    fireEvent(carousel, leftBoundaryWheel)
    expect(leftBoundaryWheel.defaultPrevented).toBe(true)
    expect(carousel.scrollLeft).toBe(0)

    const rightWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 120 })
    fireEvent(carousel, rightWheel)
    expect(rightWheel.defaultPrevented).toBe(true)
    expect(carousel.scrollLeft).toBe(120)

    carousel.scrollLeft = 580
    const rightBoundaryWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 120 })
    fireEvent(carousel, rightBoundaryWheel)
    expect(rightBoundaryWheel.defaultPrevented).toBe(true)
    expect(carousel.scrollLeft).toBe(580)

    const verticalWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 8, deltaY: 80 })
    fireEvent(carousel, verticalWheel)
    expect(verticalWheel.defaultPrevented).toBe(false)
    expect(carousel.scrollLeft).toBe(580)
  })

  it("switches from the saved voice carousel to audio upload", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Use Audio File" }))

    expect(sampleProcessingPanel().getByLabelText("Audio File")).toHaveAttribute("tabindex", "-1")
    expect(sampleProcessingPanel().queryByText("Process From")).not.toBeInTheDocument()
  })

  it("shows an empty saved voice source state until audio is uploaded", async () => {
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "", voices: [] })
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    expect(await sampleProcessingPanel().findByText("No Saved Voices")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("button", { name: "Start Processing" })).toBeDisabled()

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Use Audio File" }))
    expect(sampleProcessingPanel().getByRole("button", { name: "Start Processing" })).toBeDisabled()
    await user.upload(sampleProcessingPanel().getByLabelText("Audio File"), new File(["source"], "sample.wav", { type: "audio/wav" }))
    await waitFor(() => expect(sampleProcessingPanel().getByRole("button", { name: "Start Processing" })).toBeEnabled())
  })

  it("shows unavailable sample processing state", async () => {
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/options" && !init) {
          return okJson({
            engine: null,
            operations: sampleProcessingOptions.operations.map((operation) => ({ ...operation, enabled: false })),
          })
        }
        return baseFetch(input, init)
      })
    )
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    expect(await sampleProcessingPanel().findByText("Sample Processing Unavailable")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("button", { name: "Start Processing" })).toBeDisabled()
  })

  it("labels deferred speaker work as speaker separation", async () => {
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    expect(await sampleProcessingPanel().findByRole("button", { name: /Clean Up Voice/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(sampleProcessingPanel().getByText("Pull the spoken voice forward and reduce background audio.")).toBeInTheDocument()
    expect(sampleProcessingPanel().queryByText(/^Step \d+$/)).not.toBeInTheDocument()
    expect(sampleProcessingPanel().queryByText("Optional")).not.toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("button", { name: /Tighten Pauses/i })).toHaveClass("flex-1")
    expect(sampleProcessingPanel().getByRole("button", { name: /Tighten Pauses/i })).toHaveClass("justify-start")
    expect(sampleProcessingPanel().getByRole("button", { name: /Tighten Pauses/i })).not.toHaveClass("justify-between")
    const splitSpeakersButton = await sampleProcessingPanel().findByRole("button", { name: /Split Speakers/i })
    expect(splitSpeakersButton).toHaveClass("flex-1")
    expect(splitSpeakersButton).toHaveClass("justify-start")
    expect(splitSpeakersButton).not.toHaveClass("justify-between")
    expect(splitSpeakersButton).toBeDisabled()
    expect(sampleProcessingPanel().getAllByText("Unavailable").length).toBeGreaterThan(0)
  })

  it("switches to an enabled sample processing operation and names the result for that operation", async () => {
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/options" && !init) {
          return okJson({
            engine: "fake",
            operations: sampleProcessingOptions.operations.map((operation) => {
              if (operation.id === "isolateVoice") {
                return { ...operation, enabled: false }
              }
              if (operation.id === "trimSilence") {
                return { ...operation, enabled: true }
              }
              return operation
            }),
          })
        }
        return baseFetch(input, init)
      })
    )

    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    expect(await sampleProcessingPanel().findByRole("button", { name: /Tighten Pauses/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(sampleProcessingPresetSelect("Trim Aggressiveness")).toHaveAccessibleName("Trim Aggressiveness: Balanced")
    const startButton = sampleProcessingPanel().getByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())

    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("operationId")).toBe("trimSilence")
    expect(jobBody.get("processingPresetId")).toBe("trimBalanced")
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Voice Name")).toHaveValue("Default voice Trimmed")
  })

  it("shows process-from copy without relying on tooltip help", async () => {
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [retainedSourceVoice] })
        }
        return baseFetch(input, init)
      })
    )
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    expect(sampleProcessingPanel().getByText("Process From")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("Choose which version of this saved voice to prepare.")).toBeVisible()
    expect(sampleProcessingPanel().queryByRole("button", { name: "Explain Source Preference" })).not.toBeInTheDocument()
    const originalRecording = sampleProcessingPanel().getByRole("button", { name: "Original Recording" })
    expect(originalRecording).toHaveAccessibleDescription(
      "Best for cleanup, splitting speakers, and trimming. Uses the full uploaded source when available."
    )
    expect(originalRecording).toHaveAttribute("aria-pressed", "true")
    expect(sampleProcessingPanel().getByText("Recommended")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("button", { name: "Saved Sample" })).toHaveAccessibleDescription(
      "Best for quick touch-ups. Uses the current library sample."
    )
  })

  it("uses saved sample when the selected voice has no retained original recording", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    const originalRecording = sampleProcessingPanel().getByRole("button", { name: "Original Recording Unavailable" })
    expect(originalRecording).toBeDisabled()
    expect(originalRecording).toHaveAttribute("aria-pressed", "false")
    expect(originalRecording).toHaveAccessibleDescription("This saved voice does not have a retained original recording.")
    expect(sampleProcessingPanel().getByRole("button", { name: "Saved Sample" })).toHaveAttribute("aria-pressed", "true")

    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("sourcePreference")).toBe("active")
  })

  it("processes an existing voice, previews the result, and saves it as a selectable voice", async () => {
    const user = userEvent.setup()
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [retainedSourceVoice] })
        }
        return baseFetch(input, init)
      })
    )
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    expect(sampleProcessingPresetSelect("Isolation Strength")).toHaveAccessibleName("Isolation Strength: Balanced")

    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    expect(jobCall).toBeDefined()
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("operationId")).toBe("isolateVoice")
    expect(jobBody.get("processingPresetId")).toBe("balanced")
    expect(jobBody.get("sourceVoiceId")).toBe("default")
    expect(jobBody.get("sourcePreference")).toBe("original")
    expect(jobBody.get("sourceFile")).toBeNull()

    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Finished In")
    expect(sampleProcessingPanel().getByLabelText("Voice Name")).toHaveValue("Default voice Isolated")

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Add To Voice Library" }))

    const saveCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs/job-1/voice" && init?.method === "POST"
    )
    expect(saveCall).toBeDefined()
    expect(JSON.parse(saveCall?.[1]?.body as string)).toEqual({
      name: "Default voice Isolated",
      voicePresetId: "standardNarration",
    })
    expect(await voiceLibraryPanel().findByText("Default voice Isolated")).toBeInTheDocument()
  })

  it("preserves a saved-voice processing result when returning to Process Source Media", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("radio", { name: "Saved Voice" })).toHaveAttribute("aria-checked", "true")

    const preparePanel = prepareAudioPanel()
    await user.click(preparePanel.getByRole("button", { name: /upload ready voice sample/i }))
    expect(preparePanel.getByRole("form", { name: "Add Voice" })).toBeInTheDocument()

    await user.click(preparePanel.getByRole("button", { name: /process source media/i }))

    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("radio", { name: "Saved Voice" })).toHaveAttribute("aria-checked", "true")
    expect(sampleProcessingPanel().queryByRole("group", { name: "Audio Drop Zone" })).not.toBeInTheDocument()
  })

  it("edits speaker separation transcripts and saves selected speakers", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/options" && !init) {
          return okJson({
            engine: "pyannote-community-1+faster-whisper",
            operations: sampleProcessingOptions.operations.map((operation) =>
              operation.id === "separateSpeakers" ? { ...operation, enabled: true } : operation
            ),
          })
        }
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify(successfulSpeakerSeparationJob), {
              status: 202,
              headers: { "Content-Type": "application/json" },
            })
          )
        }
        if (path === "/api/sample-processing/jobs/job-1/speaker-assignments" && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            speakerNames?: { speakerId: string; name?: string | null }[]
            transcriptAssignments?: { itemId: string; speakerId: string }[]
          }
          return okJson(body.transcriptAssignments ? reassignedSpeakerSeparationJob : renamedSpeakerSeparationJob)
        }
        if (path === "/api/sample-processing/jobs/job-1/speaker-voices" && init?.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify({ voices: [savedSpeakerVoiceFrom(init)] }), {
              status: 201,
              headers: { "Content-Type": "application/json" },
            })
          )
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(await sampleProcessingPanel().findByRole("button", { name: /Split Speakers/i }))
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Start Processing" }))

    expect(await sampleProcessingPanel().findByText("Speaker Streams")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("2 Voices Detected")).toBeInTheDocument()
    const helloText = await sampleProcessingPanel().findByRole("button", { name: "Hello." })
    const hiText = sampleProcessingPanel().getByRole("button", { name: "Hi." })
    expect(helloText.getAttribute("style")).toContain("--speaker-color")
    const speakerOneCard = sampleProcessingPanel().getByLabelText("Speaker 1").closest("article") as HTMLElement
    await user.hover(speakerOneCard)
    expect(helloText.parentElement).toHaveClass("py-1")
    expect(helloText).toHaveClass("lg:-translate-y-0.5")
    expect(helloText).toHaveClass("lg:border-[var(--speaker-color)]")
    expect(hiText).not.toHaveClass("lg:-translate-y-0.5")
    await user.unhover(speakerOneCard)
    expect(helloText).not.toHaveClass("lg:-translate-y-0.5")

    const firstSpeakerNameInput = sampleProcessingPanel().getAllByLabelText("Voice Name")[0]
    await user.click(firstSpeakerNameInput)
    await user.tab()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) => String(url) === "/api/sample-processing/jobs/job-1/speaker-assignments" && init?.method === "PATCH"
        )
    ).toBe(false)

    await user.click(helloText)
    const playPopover = screen.getByText("Assign Text To Speaker").closest("[data-slot='popover-content']") as HTMLElement
    expect(playPopover).toHaveClass("border-border/70")
    await user.click(within(playPopover).getByRole("button", { name: "Play" }))
    const sourceAudio = document.querySelector('audio[src="/api/sample-processing/jobs/job-1/source"]') as HTMLAudioElement
    expect(sourceAudio.currentTime).toBe(0)
    expect(playSpy).toHaveBeenCalled()
    sourceAudio.currentTime = 1.1
    fireEvent.timeUpdate(sourceAudio)
    expect(pauseSpy).toHaveBeenCalled()

    const assignNameInput = within(playPopover).getByLabelText("Assign Name")
    await user.clear(assignNameInput)
    await user.type(assignNameInput, "Mina")
    await user.click(within(playPopover).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sampleProcessingPanel().getAllByLabelText("Voice Name")[0]).toHaveValue("Mina"))
    const namePatchCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) => String(url) === "/api/sample-processing/jobs/job-1/speaker-assignments" && init?.method === "PATCH"
      )
    expect(JSON.parse(namePatchCall?.[1]?.body as string)).toEqual({
      speakerNames: [{ speakerId: "speaker-1", name: "Mina" }],
    })

    await user.keyboard("{Escape}")
    fireEvent.pointerDown(helloText, { buttons: 1 })
    fireEvent.pointerEnter(hiText, { buttons: 1 })
    fireEvent.pointerUp(hiText)
    await user.click(hiText)
    const assignPopover = screen.getByText("Assign Text To Speaker").closest("[data-slot='popover-content']") as HTMLElement
    await user.click(within(assignPopover).getByRole("button", { name: "Speaker 1" }))
    await waitFor(() => expect(sampleProcessingPanel().getAllByText("2 Segments")).toHaveLength(1))
    const assignmentPatchCall = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, init]) => String(url) === "/api/sample-processing/jobs/job-1/speaker-assignments" && init?.method === "PATCH"
      )
      .find(([, init]) => String(init?.body).includes("transcriptAssignments"))
    expect(JSON.parse(assignmentPatchCall?.[1]?.body as string)).toEqual({
      transcriptAssignments: [
        { itemId: "item-1", speakerId: "speaker-1" },
        { itemId: "item-2", speakerId: "speaker-1" },
      ],
    })

    await user.keyboard("{Escape}")
    const speakerCheckboxes = sampleProcessingPanel().getAllByRole("checkbox")
    await user.click(speakerCheckboxes[1])
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Add Selected Voices" }))
    const saveDialog = await screen.findByRole("dialog", { name: "Add Selected Voices To Voice Library" })
    expect(
      within(saveDialog).getByText("These selected speaker streams will be added to the Voice Library as separate voices.")
    ).toBeInTheDocument()
    expect(within(saveDialog).getByText("Mina")).toBeInTheDocument()
    expect(within(saveDialog).getByText("Standard Narration")).toBeInTheDocument()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) => String(url) === "/api/sample-processing/jobs/job-1/speaker-voices" && init?.method === "POST"
        )
    ).toBe(false)
    await user.click(within(saveDialog).getByRole("button", { name: "Add To Voice Library" }))
    const saveSpeakersCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs/job-1/speaker-voices" && init?.method === "POST"
    )
    expect(JSON.parse(saveSpeakersCall?.[1]?.body as string)).toEqual({
      voices: [{ speakerId: "speaker-1", name: "Mina", voicePresetId: "standardNarration" }],
    })
    expect(await voiceLibraryPanel().findByText("Mina")).toBeInTheDocument()
  })

  it("shows live and final sample processing elapsed time", async () => {
    let currentTime = 0
    vi.spyOn(performance, "now").mockImplementation(() => currentTime)
    const baseFetch = mockFetch()
    let pollCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/jobs/job-1" && !init) {
          pollCount += 1
          if (pollCount === 1) {
            return okJson({
              job: {
                ...successfulSampleProcessingJob.job,
                status: "running",
                result: null,
              },
            })
          }
          return okJson(successfulSampleProcessingJob)
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    expect(await sampleProcessingPanel().findByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Elapsed 0s")

    currentTime = 1234
    await waitFor(() => {
      expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Elapsed 1.2s")
    })

    currentTime = 12_300

    await waitFor(() => {
      expect(sampleProcessingPanel().getByLabelText("Processed sample preview")).toBeInTheDocument()
    }, { timeout: 2500 })
    expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Finished In 12s")
  })

  it("shows stacked workflow progress and aborts a running job", async () => {
    const runningStackJob = {
      job: {
        ...successfulSampleProcessingJob.job,
        status: "running" as const,
        workflowMode: "stack" as const,
        activeStepId: "job-1-step-1",
        result: null,
        steps: [
          {
            ...successfulSampleProcessingJob.job.steps[0],
            id: "job-1-step-1",
            status: "running" as const,
            completedAt: null,
            resultSha256: null,
          },
          {
            id: "job-1-step-2",
            operationId: "trimSilence" as const,
            operationLabel: "Trim Silence",
            status: "pending" as const,
            engine: "ffmpeg",
            processingPresetId: "trimBalanced" as const,
            processingPresetLabel: "Balanced",
            startedAt: null,
            completedAt: null,
            error: null,
            sourceSha256: null,
            resultSha256: null,
          },
        ],
      },
    }
    const canceledStackJob = {
      job: {
        ...runningStackJob.job,
        status: "canceled" as const,
        activeStepId: null,
        error: "Sample processing was canceled.",
        steps: runningStackJob.job.steps.map((step) =>
          step.id === "job-1-step-1"
            ? {
                ...step,
                status: "canceled" as const,
                completedAt: "2026-06-19T00:00:01+00:00",
                error: "Sample processing was canceled.",
              }
            : step
        ),
      },
    }
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/jobs" && init?.method === "POST") {
          return okJson(runningStackJob)
        }
        if (path === "/api/sample-processing/jobs/job-1" && !init) {
          return okJson(runningStackJob)
        }
        if (path === "/api/sample-processing/jobs/job-1/cancel" && init?.method === "POST") {
          return okJson(canceledStackJob)
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("button", { name: /Tighten Pauses/i }))
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Start Processing" }))

    const progressHeading = await sampleProcessingPanel().findByText("Workflow Progress")
    expect(progressHeading).toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("status", { name: "Workflow Progress" })).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("Active Step: Isolate Voice")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("Queued")).toBeInTheDocument()
    expect(progressHeading.closest("section")?.querySelector(".animate-spin")).toBeInTheDocument()

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(JSON.parse(jobBody.get("workflowSteps") as string)).toEqual([
      { operationId: "isolateVoice", processingPresetId: "balanced" },
      { operationId: "trimSilence", processingPresetId: "trimBalanced" },
    ])

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Abort" }))

    await waitFor(() => expect(sampleProcessingPanel().getAllByText("Canceled").length).toBeGreaterThan(0))
    expect(sampleProcessingPanel().queryByRole("button", { name: "Add To Voice Library" })).not.toBeInTheDocument()
  })

  it("sends the selected isolation strength preset", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await chooseSampleProcessingPreset(user, "Isolation Strength", "Clean")
    expect(sampleProcessingPresetSelect("Isolation Strength")).toHaveAccessibleName("Isolation Strength: Clean")
    expect(sampleProcessingPanel().getByText("Balanced isolation with conservative cleanup for background residue.")).toBeInTheDocument()

    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("processingPresetId")).toBe("clean")
  })

  it("sends the selected trim aggressiveness preset", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    expect(sampleProcessingPresetSelect("Isolation Strength")).toHaveAccessibleName("Isolation Strength: Balanced")
    await user.click(sampleProcessingPanel().getByRole("button", { name: /Tighten Pauses/i }))

    expect(sampleProcessingPresetSelect("Trim Aggressiveness")).toHaveAccessibleName("Trim Aggressiveness: Balanced")
    await chooseSampleProcessingPreset(user, "Trim Aggressiveness", "Aggressive")
    expect(sampleProcessingPresetSelect("Trim Aggressiveness")).toHaveAccessibleName("Trim Aggressiveness: Aggressive")
    expect(sampleProcessingPanel().getByText("Tighter trimming for shorter or louder empty regions.")).toBeInTheDocument()

    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("operationId")).toBeNull()
    expect(JSON.parse(jobBody.get("workflowSteps") as string)).toEqual([
      { operationId: "isolateVoice", processingPresetId: "balanced" },
      { operationId: "trimSilence", processingPresetId: "trimAggressive" },
    ])
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Voice Name")).toHaveValue("Default voice Trimmed")
  })

  it("clears a processed preview when sample processing inputs change", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Finished In")

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Tighten Pauses" }))

    await waitFor(() => {
      expect(sampleProcessingPanel().queryByLabelText("Processed sample preview")).not.toBeInTheDocument()
    })
    expect(sampleProcessingPanel().queryByLabelText("Sample Processing Elapsed Time")).not.toBeInTheDocument()
    expect(sampleProcessingPanel().queryByRole("button", { name: "Add To Voice Library" })).not.toBeInTheDocument()

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Start Processing" }))

    const jobCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST")
    expect(jobCalls).toHaveLength(2)
    const nextJobBody = jobCalls[1]?.[1]?.body as FormData
    expect(nextJobBody.get("sourcePreference")).toBe("active")
  })

  it("clears a processed preview when the sample processing operation changes", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Finished In")

    await user.click(sampleProcessingPanel().getByRole("button", { name: /Tighten Pauses/i }))

    await waitFor(() => {
      expect(sampleProcessingPanel().queryByLabelText("Processed sample preview")).not.toBeInTheDocument()
    })
    expect(sampleProcessingPanel().queryByLabelText("Sample Processing Elapsed Time")).not.toBeInTheDocument()
  })

  it("clears a processed preview when the isolation strength changes", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Finished In")

    await chooseSampleProcessingPreset(user, "Isolation Strength", "Max Isolation")

    await waitFor(() => {
      expect(sampleProcessingPanel().queryByLabelText("Processed sample preview")).not.toBeInTheDocument()
    })
    expect(sampleProcessingPanel().queryByLabelText("Sample Processing Elapsed Time")).not.toBeInTheDocument()
    expect(sampleProcessingPanel().queryByRole("button", { name: "Add To Voice Library" })).not.toBeInTheDocument()

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Start Processing" }))

    const jobCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST")
    expect(jobCalls).toHaveLength(2)
    const nextJobBody = jobCalls[1]?.[1]?.body as FormData
    expect(nextJobBody.get("processingPresetId")).toBe("maxIsolation")
  })

  it("clears a processed preview when trim aggressiveness changes", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("button", { name: /Tighten Pauses/i }))
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Finished In")

    await chooseSampleProcessingPreset(user, "Trim Aggressiveness", "Aggressive")

    await waitFor(() => {
      expect(sampleProcessingPanel().queryByLabelText("Processed sample preview")).not.toBeInTheDocument()
    })
    expect(sampleProcessingPanel().queryByLabelText("Sample Processing Elapsed Time")).not.toBeInTheDocument()
    expect(sampleProcessingPanel().queryByRole("button", { name: "Add To Voice Library" })).not.toBeInTheDocument()

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Start Processing" }))

    const jobCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST")
    expect(jobCalls).toHaveLength(2)
    const nextJobBody = jobCalls[1]?.[1]?.body as FormData
    expect(nextJobBody.get("operationId")).toBeNull()
    expect(JSON.parse(nextJobBody.get("workflowSteps") as string)).toEqual([
      { operationId: "isolateVoice", processingPresetId: "balanced" },
      { operationId: "trimSilence", processingPresetId: "trimAggressive" },
    ])
  })

  it("creates a sample processing job from an uploaded file", async () => {
    const user = userEvent.setup()
    const sourceFile = new File(["source"], "vegeta.wav", { type: "audio/wav" })
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("radio", { name: "Audio File" }))
    expect(sampleProcessingPanel().queryByText("Process From")).not.toBeInTheDocument()
    expect(sampleProcessingPanel().queryByRole("button", { name: "Explain Source Preference" })).not.toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Audio File")).toHaveAttribute("tabindex", "-1")
    await user.upload(sampleProcessingPanel().getByLabelText("Audio File"), sourceFile)
    const startButton = sampleProcessingPanel().getByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())

    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("operationId")).toBe("isolateVoice")
    expect(jobBody.get("sourceFile")).toBeNull()
    expect(jobBody.get("sourceMediaId")).toBe("source-1")
    expect(JSON.parse(jobBody.get("sourceRanges") as string)).toEqual([
      { startSeconds: 0, endSeconds: 120, label: "Selected Range" },
    ])
    expect(jobBody.get("sourceVoiceId")).toBeNull()
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Finished In")

    const replacementFile = new File(["replacement"], "vegeta-clean.wav", { type: "audio/wav" })
    await user.upload(sampleProcessingPanel().getByLabelText("Audio File"), replacementFile)

    await waitFor(() => {
      expect(sampleProcessingPanel().queryByLabelText("Processed sample preview")).not.toBeInTheDocument()
    })
    expect(sampleProcessingPanel().queryByLabelText("Sample Processing Elapsed Time")).not.toBeInTheDocument()
  })

  it("creates a sample processing job from an uploaded video file", async () => {
    const user = userEvent.setup()
    const sourceFile = new File(["source"], "clip.mp4", { type: "video/mp4" })
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("radio", { name: "Video File" }))
    expect(sampleProcessingPanel().getByLabelText("Video File")).toHaveAttribute("tabindex", "-1")
    await user.upload(sampleProcessingPanel().getByLabelText("Video File"), sourceFile)

    expect(await sampleProcessingPanel().findByText("Source Selection")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("Video")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("Audio Stream 1")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("Selected 2m")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("clip.mp4 Video Preview")).toHaveAttribute(
      "src",
      "/api/sample-processing/sources/source-1/media"
    )
    const startButton = sampleProcessingPanel().getByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())

    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("operationId")).toBe("isolateVoice")
    expect(jobBody.get("sourceFile")).toBeNull()
    expect(jobBody.get("sourceMediaId")).toBe("source-1")
    expect(JSON.parse(jobBody.get("sourceRanges") as string)).toEqual([
      { startSeconds: 0, endSeconds: 120, label: "Selected Range" },
    ])
    expect(jobBody.get("sourceVoiceId")).toBeNull()
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/sample-processing/sources/source-1",
        expect.objectContaining({ method: "DELETE" })
      )
    )
  })

  it("starts sample processing from selected M4B chapters", async () => {
    const user = userEvent.setup()
    const sourceFile = new File(["source"], "book.m4b", { type: "audio/mp4" })
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/sources" && init?.method === "POST") {
          return okJson(chapteredSampleProcessingMediaSource())
        }
        if (path === "/api/sample-processing/sources/source-book" && init?.method === "DELETE") {
          return okNoContent()
        }
        return baseFetch(input, init)
      })
    )
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("radio", { name: "Audio File" }))
    await user.upload(sampleProcessingPanel().getByLabelText("Audio File"), sourceFile)

    expect(await sampleProcessingPanel().findByText("Source Selection")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("2 Chapters")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("button", { name: "Start Processing" })).toBeDisabled()

    await user.click(sampleProcessingPanel().getByLabelText(/Chapter 2/i))
    const startButton = sampleProcessingPanel().getByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("sourceFile")).toBeNull()
    expect(jobBody.get("sourceMediaId")).toBe("source-book")
    expect(JSON.parse(jobBody.get("sourceRanges") as string)).toEqual([
      { startSeconds: 120, endSeconds: 240, label: "Chapter 2" },
    ])
  })

  it("creates a sample processing job from a dropped audio file", async () => {
    const user = userEvent.setup()
    const sourceFile = new File(["source"], "dropped-source.wav", { type: "audio/wav" })
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("radio", { name: "Audio File" }))
    fireEvent.drop(sampleProcessingPanel().getByRole("group", { name: "Audio Drop Zone" }), {
      dataTransfer: { files: [sourceFile] },
    })
    const startButton = sampleProcessingPanel().getByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())

    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("operationId")).toBe("isolateVoice")
    expect(jobBody.get("sourceFile")).toBeNull()
    expect(jobBody.get("sourceMediaId")).toBe("source-1")
    expect(JSON.parse(jobBody.get("sourceRanges") as string)).toEqual([
      { startSeconds: 0, endSeconds: 120, label: "Selected Range" },
    ])
    expect(jobBody.get("sourceVoiceId")).toBeNull()
  })

  it("shows sample processing job errors", async () => {
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/sample-processing/jobs/job-1" && !init) {
          return okJson({
            job: {
              ...successfulSampleProcessingJob.job,
              status: "error",
              error: "demucs command was not found.",
              result: null,
            },
          })
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    expect(await sampleProcessingPanel().findByText("Processing Failed")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByLabelText("Sample Processing Elapsed Time")).toHaveTextContent("Stopped After")
    expect(sampleProcessingPanel().getByText("demucs command was not found.")).toBeInTheDocument()
  })

  it("keeps provider usage details available", async () => {
    renderApp()

    await screen.findByText(`${formatTestNumber(9000)} remaining`)
    expect(screen.getByText(`${formatTestNumber(9000)} remaining`)).toBeInTheDocument()
    expect(screen.getByText(`~${formatTestNumber(97)}`)).toBeInTheDocument()
    expect(screen.getByLabelText(/model/i)).toHaveValue("eleven_multilingual_v2")
    expect(screen.getByRole("link", { name: /api requests/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument()
  })

  it("shows pending state while generating speech", async () => {
    let resolveSpeech: (value: Response) => void = () => undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          return new Promise<Response>((resolve) => {
            resolveSpeech = resolve
          })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
    const latestHeading = screen.getByRole("heading", { name: "Latest Generated Audio" })
    const latestScrollPanel = latestHeading.closest("section")
    expect(latestScrollPanel).not.toBeNull()
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      })
    )
    expect(scrollIntoView.mock.contexts).toContain(latestScrollPanel)
    const textLabel = screen.getByText("Text to Speak")
    const generateSection = document.querySelector('[data-section-id="generate"]')
    expect(generateSection).not.toBeNull()
    expect(textLabel.compareDocumentPosition(latestHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(generateSection as HTMLElement).queryByRole("heading", { name: "Voice Tuning" })).not.toBeInTheDocument()
    expect(screen.getByText("Generating Speech")).toBeInTheDocument()
    resolveSpeech(
      new Response(audioBlob, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "X-App-Voice-Id": "default",
          "X-Character-Count": "54",
          "X-Request-Id": "req_test_123",
          "X-Voice-Cache": "miss",
          "X-Voice-Id": "voice-123",
        },
      })
    )
    const latestPanel = latestHeading.closest("section")
    expect(latestPanel).not.toBeNull()
    expect(await within(latestPanel as HTMLElement).findByLabelText(/generated voice playback/i)).toBeInTheDocument()
  })

  it("cancels an in-flight speech request after confirmation", async () => {
    let speechSignal: AbortSignal | null = null
    vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          speechSignal = init.signal ?? null
          return new Promise<Response>((_resolve, reject) => {
            speechSignal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"))
            })
          })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    await user.click(screen.getByRole("button", { name: /cancel/i }))

    expect(window.confirm).toHaveBeenCalledWith(
      "Cancel this generation? The provider may still process an in-flight text-to-speech request, so this may still consume credits."
    )
    expectAbortSignal(speechSignal, true)
    expect(await screen.findByText(/Generation canceled in this browser/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/generated voice playback/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate" })).not.toBeDisabled()
  })

  it("keeps generating when cancel confirmation is declined", async () => {
    let resolveSpeech: (value: Response) => void = () => undefined
    let speechSignal: AbortSignal | null = null
    vi.spyOn(window, "confirm").mockReturnValue(false)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          speechSignal = init.signal ?? null
          return new Promise<Response>((resolve) => {
            resolveSpeech = resolve
          })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    await user.click(screen.getByRole("button", { name: /cancel/i }))

    expect(window.confirm).toHaveBeenCalled()
    expectAbortSignal(speechSignal, false)
    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled()

    resolveSpeech(
      new Response(audioBlob, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "X-App-Voice-Id": "default",
          "X-Character-Count": "54",
          "X-Request-Id": "req_test_123",
          "X-Voice-Cache": "miss",
          "X-Voice-Id": "voice-123",
        },
      })
    )

    expect(await latestGeneratedAudioPanel().findByLabelText(/generated voice playback/i)).toBeInTheDocument()
    expect(screen.queryByText(/Generation canceled in this browser/i)).not.toBeInTheDocument()
  })

  it("saves a named upload with the selected voice preset and selects it", async () => {
    window.history.replaceState(null, "", "/#prepare")
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const addPresetGroup = within(addVoicePanel().getByRole("radiogroup", { name: "Voice Preset" }))
    const standardPreset = addPresetGroup.getByRole("radio", { name: /standard narration/i })
    const animatedPreset = addPresetGroup.getByRole("radio", { name: /animated dialogue/i })
    expectVoicePresetSelection(standardPreset, true)
    expectVoicePresetSelection(animatedPreset, false)
    await user.click(animatedPreset)
    expectVoicePresetSelection(standardPreset, false)
    expectVoicePresetSelection(animatedPreset, true)
    await user.type(addVoicePanel().getByLabelText(/voice name/i), "Voice_Clone_01")
    const file = new File(["sample"], "voice-clone-01.wav", { type: "audio/wav" })
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), file)
    await screen.findByRole("group", { name: /saved sample mode/i })
    await user.click(addVoicePanel().getByRole("button", { name: /save voice/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" })))
    const uploadCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/voices" && init?.method === "POST"
    )
    const body = uploadCall?.[1]?.body as FormData
    const sampleFile = body.get("sampleFile") as File
    expect(body.get("name")).toBe("Voice_Clone_01")
    expect(sampleFile).toBeInstanceOf(File)
    expect(sampleFile.name).toBe("voice-clone-01-window.wav")
    expect(sampleFile.type).toBe("audio/wav")
    expect(body.get("sampleMode")).toBe("excerpt")
    expect(body.get("voicePresetId")).toBe("animatedDialogue")
    expect(body.get("windowStartSeconds")).toBe("0")
    expect(body.get("windowDurationSeconds")).toBe("3")
    expect(body.get("sourceFile")).toBeNull()
    expect(await screen.findByRole("button", { name: /^Voice_Clone_01/i })).toBeInTheDocument()
    expect(voiceLibraryPanel().getAllByText("Animated Dialogue").length).toBeGreaterThan(0)
  })

  it("keeps add voice visible after saving a voice from prepare", async () => {
    window.history.replaceState(null, "", "/#prepare")
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), new File(["sample"], "fresh-voice.wav", { type: "audio/wav" }))
    await user.type(addVoicePanel().getByLabelText(/voice name/i), "Fresh_Voice")
    await screen.findByRole("group", { name: /saved sample mode/i })
    await user.click(addVoicePanel().getByRole("button", { name: /save voice/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" })))
    expect(await screen.findByRole("button", { name: /^Voice_Clone_01/i })).toBeInTheDocument()
    expect(addVoicePanel().getByRole("heading", { name: "Add Voice" })).toBeInTheDocument()
    expect(addVoicePanel().getByRole("textbox", { name: "Voice Name" })).toBeInTheDocument()
  })

  it("orders add voice controls by source preview preset name and save", async () => {
    window.history.replaceState(null, "", "/#prepare")
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    const source = addVoicePanel().getByRole("group", { name: "Audio Drop Zone" })
    expect(addVoicePanel().queryByText("Upload Preview")).not.toBeInTheDocument()
    expect(addVoicePanel().queryByText("No upload selected.")).not.toBeInTheDocument()

    await user.upload(addVoicePanel().getByLabelText(/sample file/i), new File(["sample"], "workflow-order.wav", { type: "audio/wav" }))
    expect(await screen.findByLabelText(/uploaded voice sample preview/i)).toBeInTheDocument()

    const preview = addVoicePanel().getByText("Upload Preview")
    const preset = addVoicePanel().getByRole("radiogroup", { name: "Voice Preset" })
    const name = addVoicePanel().getByRole("textbox", { name: "Voice Name" })
    const save = addVoicePanel().getByRole("button", { name: /save voice/i })

    expectElementBefore(source, preview)
    expectElementBefore(preview, preset)
    expectElementBefore(preset, name)
    expectElementBefore(name, save)
  })

  it("accepts a dropped audio file when adding a voice", async () => {
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.type(addVoicePanel().getByLabelText(/voice name/i), "Dropped_Voice")
    const dropZone = addVoicePanel().getByRole("group", { name: "Audio Drop Zone" })
    expect(addVoicePanel().queryByRole("group", { name: /voice sample source/i })).not.toBeInTheDocument()
    expect(addVoicePanel().getByLabelText(/sample file/i)).toHaveAttribute("tabindex", "-1")
    expect(within(dropZone).getByRole("button", { name: /choose audio/i })).toBeInTheDocument()
    expect(within(dropZone).getByRole("button", { name: /^record$/i })).toBeInTheDocument()
    const file = new File(["sample"], "dropped-voice.wav", { type: "audio/wav" })
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file] },
    })

    await screen.findByRole("group", { name: /saved sample mode/i })
    await user.click(addVoicePanel().getByRole("button", { name: /save voice/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" })))
    const uploadCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/voices" && init?.method === "POST"
    )
    const body = uploadCall?.[1]?.body as FormData
    expect(body.get("name")).toBe("Dropped_Voice")
    expect(body.get("sampleFile")).toBeInstanceOf(File)
    expect(body.get("windowDurationSeconds")).toBe("3")
  })

  it("keeps recording unavailable while an upload is being prepared", async () => {
    const pendingDecode = stubDeferredDecodedAudio(3)
    const getUserMedia = vi.fn()
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } })
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), new File(["sample"], "pending.wav", { type: "audio/wav" }))

    expect((await screen.findAllByText("Preparing Sample")).length).toBeGreaterThan(0)
    expect(prepareAudioPanel().getByRole("button", { name: /upload ready voice sample/i })).toBeDisabled()
    expect(prepareAudioPanel().getByRole("button", { name: /process source media/i })).toBeDisabled()
    const recordButton = addVoicePanel().getByRole("button", { name: /^Record$/ })
    expect(recordButton).toBeDisabled()

    await user.click(recordButton)

    expect(getUserMedia).not.toHaveBeenCalled()
    pendingDecode.resolve()
    expect(await screen.findByText("0:03 Selected")).toBeInTheDocument()
    expect(addVoicePanel().getByRole("button", { name: /^Record$/ })).toBeEnabled()
  })

  it("defaults long uploads to the provider maximum window", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchWithProviders({
        ...providersResponse,
        providers: [
          {
            ...providersResponse.providers[0],
            sample: {
              maxSelectedSourceAudioBytes: 1024 * 1024 * 1024,
              maxSourceUploadBytes: 1024 * 1024 * 1024,
              maxUploadBytes: 10 * 1024 * 1024,
              maxWindowSeconds: 2,
              recommendedMinSeconds: 1,
              recommendedMaxSeconds: 2,
              targetSampleRateHz: 16000,
            },
          },
        ],
      })
    )
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), new File(["sample"], "long.wav", { type: "audio/wav" }))

    expect(await screen.findByText("0:02 Selected")).toBeInTheDocument()
    expect(screen.getByText("0:02 Max")).toBeInTheDocument()
    expect(screen.getByText("0:01-0:02 Recommended")).toBeInTheDocument()
  })

  it("re-clamps a prepared upload when provider sample limits load", async () => {
    const providers = deferredResponse()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const path = url.split("?")[0]
        if (path === "/api/providers" && !init) {
          return providers.promise
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (path === "/api/models" && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (path === "/api/voices" && init?.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify({ voice: voiceCloneVoice }), {
              status: 201,
              headers: { "Content-Type": "application/json" },
            })
          )
        }
        if (path === "/api/speech" && init?.method === "POST") {
          return okAudio()
        }
        return okJson({})
      })
    )
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.type(addVoicePanel().getByLabelText(/voice name/i), "Voice_Clone_01")
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), new File(["sample"], "long.wav", { type: "audio/wav" }))
    expect(await screen.findByText("0:03 Selected")).toBeInTheDocument()

    providers.resolve(
      new Response(
        JSON.stringify({
          ...providersResponse,
          providers: [
            {
              ...providersResponse.providers[0],
              sample: {
                maxSelectedSourceAudioBytes: 1024 * 1024 * 1024,
                maxSourceUploadBytes: 1024 * 1024 * 1024,
                maxUploadBytes: 10 * 1024 * 1024,
                maxWindowSeconds: 2,
                recommendedMinSeconds: 1,
                recommendedMaxSeconds: 2,
                targetSampleRateHz: 16000,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    )

    expect(await screen.findByText("0:02 Selected")).toBeInTheDocument()
    await user.click(addVoicePanel().getByRole("button", { name: /save voice/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" })))
    const uploadCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/voices" && init?.method === "POST"
    )
    const body = uploadCall?.[1]?.body as FormData
    expect(body.get("windowStartSeconds")).toBe("0")
    expect(body.get("windowDurationSeconds")).toBe("2")
  })

  it("sends the original file when keeping a source window", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchWithProviders({
        ...providersResponse,
        providers: [
          {
            ...providersResponse.providers[0],
            sample: {
              maxSelectedSourceAudioBytes: 1024 * 1024 * 1024,
              maxSourceUploadBytes: 1024 * 1024 * 1024,
              maxUploadBytes: 10 * 1024 * 1024,
              maxWindowSeconds: 2,
              recommendedMinSeconds: 1,
              recommendedMaxSeconds: 2,
              targetSampleRateHz: 16000,
            },
          },
        ],
      })
    )
    stubDecodedAudio(3)
    const user = userEvent.setup()
    const file = new File(["sample"], "voice-source.mp3", { type: "audio/mpeg" })
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.type(addVoicePanel().getByLabelText(/voice name/i), "Voice_Clone_01")
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), file)
    await user.click(await screen.findByRole("button", { name: /keep original/i }))
    await user.click(addVoicePanel().getByRole("button", { name: /save voice/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" })))
    const uploadCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/voices" && init?.method === "POST"
    )
    const body = uploadCall?.[1]?.body as FormData
    const sampleFile = body.get("sampleFile") as File
    expect(sampleFile.name).toBe("voice-source-window.wav")
    expect(body.get("sampleMode")).toBe("sourceWindow")
    expect(body.get("sourceFile")).toBe(file)
    expect(body.get("windowStartSeconds")).toBe("0")
    expect(body.get("windowDurationSeconds")).toBe("2")
  })

  it("reports decode failures before saving uploaded audio", async () => {
    stubAudioDecodeFailure()
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.type(addVoicePanel().getByLabelText(/voice name/i), "Voice_Clone_01")
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), new File(["sample"], "broken.wav", { type: "audio/wav" }))

    expect(await screen.findByText(/unable to decode this audio file/i)).toBeInTheDocument()
    expect(addVoicePanel().getByRole("button", { name: /save voice/i })).toBeDisabled()
  })

  it("falls back to default sample limits when provider metadata is missing", async () => {
    const providerWithoutSample = { ...providersResponse.providers[0] } as Partial<(typeof providersResponse.providers)[number]>
    delete providerWithoutSample.sample
    vi.stubGlobal(
      "fetch",
      mockFetchWithProviders({
        ...providersResponse,
        providers: [providerWithoutSample as (typeof providersResponse.providers)[number]],
      })
    )
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), new File(["sample"], "voice.wav", { type: "audio/wav" }))

    expect(await screen.findByText("0:03 Selected")).toBeInTheDocument()
    expect(screen.getByText("2:00 Max")).toBeInTheDocument()
  })

  it("sets a voice as the local default from the action menu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        if (url === "/api/voices/default" && init?.method === "PUT") {
          return okJson({ defaultVoiceId: "voice-clone-01", voices: [defaultVoice, voiceCloneVoice] })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole("button", { name: /open actions for default voice/i }))
    expect(screen.getByRole("menuitem", { name: "Set As Default" })).toBeDisabled()
    await user.keyboard("{Escape}")

    await user.click(await screen.findByRole("button", { name: /open actions for voice_clone_01/i }))
    const setDefaultItem = screen.getByRole("menuitem", { name: "Set As Default" })
    expect(setDefaultItem).toBeEnabled()
    await user.click(setDefaultItem)

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/voices/default",
        expect.objectContaining({
          body: JSON.stringify({ voiceId: "voice-clone-01" }),
          method: "PUT",
        })
      )
    )
  })

  it("plays a voice from the action menu", async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    const pause = vi.fn()
    const AudioMock = vi.fn(function (this: HTMLAudioElement, src: string) {
      Object.assign(this, { pause, play, src })
    })
    vi.stubGlobal("Audio", AudioMock)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole("button", { name: /open actions for voice_clone_01/i }))
    await user.click(screen.getByRole("menuitem", { name: /play/i }))

    expect(AudioMock).toHaveBeenCalledWith("/api/voices/voice-clone-01/sample")
    expect(play).toHaveBeenCalled()
    expect(screen.getByText((_, element) => element?.textContent === "Source: Voice_Clone_01")).toBeInTheDocument()
  })

  it("renames a voice from the action menu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        if (url === "/api/voices/voice-clone-01" && init?.method === "PATCH") {
          return okJson({
            defaultVoiceId: "default",
            voices: [{ ...voiceCloneVoice, name: "Narration Take 01" }, defaultVoice],
          })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole("button", { name: /open actions for voice_clone_01/i }))
    await user.click(screen.getByRole("menuitem", { name: /rename/i }))
    const dialog = screen.getByRole("dialog", { name: /rename voice/i })
    await user.clear(within(dialog).getByLabelText(/voice name/i))
    await user.type(within(dialog).getByLabelText(/voice name/i), "Narration Take 01")
    await user.click(within(dialog).getByRole("button", { name: /^rename$/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/voices/voice-clone-01",
        expect.objectContaining({
          body: JSON.stringify({ name: "Narration Take 01" }),
          method: "PATCH",
        })
      )
    )
    expect(await screen.findByRole("button", { name: /^Narration Take 01/i })).toBeInTheDocument()
  })

  it("shows voice presets as library labels without library editing controls", async () => {
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    expect(voiceLibraryPanel().getByText("Standard Narration")).toBeInTheDocument()
    expect(voiceLibraryPanel().queryByRole("radiogroup", { name: "Voice Preset" })).not.toBeInTheDocument()
    expect(addVoicePanel().getByRole("radiogroup", { name: "Voice Preset" })).toBeInTheDocument()
  })

  it("deletes the last voice and shows the empty voice state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "voice-clone-01", voices: [voiceCloneVoice] })
        }
        if (url === "/api/voices/voice-clone-01" && init?.method === "DELETE") {
          return okJson({ defaultVoiceId: "", voices: [] })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole("button", { name: /open actions for voice_clone_01/i }))
    await user.click(screen.getByRole("menuitem", { name: /delete/i }))
    const dialog = screen.getByRole("dialog", { name: /delete voice/i })
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/voices/voice-clone-01", expect.objectContaining({ method: "DELETE" }))
    )
    expect(await screen.findByText("No Voices Saved Yet")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Prepare Audio" })).toHaveAttribute("href", "#prepare")
    expect(screen.getByRole("button", { name: /^Generate$/ })).toBeDisabled()
  })

  it("records a voice sample and saves it through the upload endpoint", async () => {
    type AudioProcessHandler = (event: { inputBuffer: { getChannelData: (channel: number) => Float32Array } }) => void
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] })
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const processor: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onaudioprocess: AudioProcessHandler | null } = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    }
    class FakeAudioContext {
      destination = {}
      sampleRate = 48000
      state = "running"

      close = vi.fn(async () => {
        this.state = "closed"
      })

      createMediaStreamSource = vi.fn(() => source)
      createScriptProcessor = vi.fn(() => processor)
    }
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } })
    vi.stubGlobal("AudioContext", FakeAudioContext)
    const user = userEvent.setup()
    renderApp()

    await user.type(addVoicePanel().getByLabelText(/voice name/i), "Voice_Clone_01")
    await user.click(addVoicePanel().getByRole("button", { name: /^Record$/ }))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }))
    processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0, 0.5, -0.5]),
      },
    })
    await user.click(screen.getByRole("button", { name: /^Stop$/ }))
    expect(await screen.findByLabelText(/recorded voice sample preview/i)).toBeInTheDocument()

    await user.click(addVoicePanel().getByRole("button", { name: /save voice/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" })))
    const uploadCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/voices" && init?.method === "POST"
    )
    const body = uploadCall?.[1]?.body as FormData
    const recordedFile = body.get("sampleFile") as File
    expect(body.get("name")).toBe("Voice_Clone_01")
    expect(recordedFile.name).toMatch(/^recorded-voice-\d+\.wav$/)
    expect(recordedFile.type).toBe("audio/wav")
    expect(stopTrack).toHaveBeenCalled()
  })

  it("replaces a recorded sample when choosing an upload", async () => {
    type AudioProcessHandler = (event: { inputBuffer: { getChannelData: (channel: number) => Float32Array } }) => void
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const processor: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onaudioprocess: AudioProcessHandler | null } = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    }
    class FakeAudioContext {
      destination = {}
      sampleRate = 48000
      state = "running"

      close = vi.fn(async () => {
        this.state = "closed"
      })

      createMediaStreamSource = vi.fn(() => source)
      createScriptProcessor = vi.fn(() => processor)
    }
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } })
    vi.stubGlobal("AudioContext", FakeAudioContext)
    const user = userEvent.setup()
    renderApp()

    await user.type(addVoicePanel().getByLabelText(/voice name/i), "Voice_Clone_01")
    await user.click(addVoicePanel().getByRole("button", { name: /^Record$/ }))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }))
    processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0.25]),
      },
    })
    await user.click(screen.getByRole("button", { name: /^Stop$/ }))
    expect(await screen.findByLabelText(/recorded voice sample preview/i)).toBeInTheDocument()

    stubDecodedAudio(2)
    await user.upload(addVoicePanel().getByLabelText(/sample file/i), new File(["sample"], "replacement.wav", { type: "audio/wav" }))

    expect(await screen.findByLabelText(/uploaded voice sample preview/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/recorded voice sample preview/i)).not.toBeInTheDocument()
    expect(screen.getByText("replacement.wav")).toBeInTheDocument()
  })

  it("reports unsupported recording and keeps upload available", async () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined })
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(addVoicePanel().getByRole("button", { name: /^Record$/ }))

    expect(await screen.findByText(/microphone recording is not supported/i)).toBeInTheDocument()
    expect(addVoicePanel().getByLabelText(/sample file/i)).toBeInTheDocument()
    expect(addVoicePanel().getByRole("button", { name: /choose audio/i })).toBeEnabled()
  })

  it("shows saved voice tuning help and selects standard narration by default", async () => {
    window.history.replaceState(null, "", "/#voices")
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    let panel = selectedVoiceTuningPanel()

    expect(panel.getByRole("button", { name: "Show Voice Tuning" })).toBeInTheDocument()
    expect(panel.queryByRole("radio", { name: "Standard Narration" })).not.toBeInTheDocument()
    expect(panel.queryByRole("button", { name: "Reset Changes" })).not.toBeInTheDocument()

    panel = await openSelectedVoiceTuningPanel(user)

    expect(panel.getByRole("button", { name: /stability help/i })).toBeInTheDocument()
    expect(panel.getByRole("button", { name: /similarity help/i })).toBeInTheDocument()
    expect(panel.getByRole("button", { name: /style help/i })).toBeInTheDocument()
    expect(panel.getByRole("button", { name: /speed help/i })).toBeInTheDocument()
    expect(screen.getByText(/lower values allow more expressive/i)).toBeInTheDocument()
    expect(screen.getByText(/very high similarity can preserve them/i)).toBeInTheDocument()
    expect(screen.getByText(/zero is the most natural/i)).toBeInTheDocument()
    expect(screen.getByText(/one point zero is the baseline pace/i)).toBeInTheDocument()
    expect(panel.getByRole("radio", { name: "Standard Narration" })).toHaveAttribute("aria-checked", "true")
    expect(panel.getByRole("radio", { name: "Animated Dialogue" })).toHaveAttribute("aria-checked", "false")
    expect(panel.getByRole("slider", { name: /stability/i })).toHaveValue("0.5")
    expect(panel.getByRole("slider", { name: /similarity/i })).toHaveValue("0.75")
    expect(panel.getByRole("slider", { name: /style/i })).toHaveValue("0")
    expect(panel.getByRole("slider", { name: /speed/i })).toHaveValue("1")
    expect(panel.queryByText("Custom")).not.toBeInTheDocument()
    expect(panel.queryByRole("button", { name: "Reset Changes" })).not.toBeInTheDocument()
    expect(panel.getByRole("button", { name: "Save Voice Tuning" })).toBeDisabled()
  })

  it("keeps selected voice tuning collapsed when selecting a different voice", async () => {
    window.history.replaceState(null, "", "/#voices")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, voiceCloneVoice] })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    let panel = await openSelectedVoiceTuningPanel(user)
    expect(panel.getByRole("button", { name: "Hide Voice Tuning" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Voice_Clone_01/i }))

    panel = selectedVoiceTuningPanel()
    expect(panel.getByRole("button", { name: "Show Voice Tuning" })).toBeInTheDocument()
    expect(panel.queryByRole("radio", { name: "Standard Narration" })).not.toBeInTheDocument()
  })

  it("confirms before saving selected voice preset and provider tuning", async () => {
    window.history.replaceState(null, "", "/#voices")
    const patchedBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/voices/default" && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          patchedBodies.push(body)
          return okJson({
            defaultVoiceId: "default",
            voices: [
              {
                ...defaultVoice,
                voicePresetId: body.voicePresetId === "animatedDialogue" ? "animatedDialogue" : "standardNarration",
                voiceSettingsByProvider:
                  body.providerId === "elevenlabs"
                    ? { elevenlabs: body.voiceSettings as Record<string, unknown> }
                    : {},
              },
            ],
          })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    let panel = await openSelectedVoiceTuningPanel(user)
    await user.click(panel.getByRole("radio", { name: "Animated Dialogue" }))
    fireEvent.change(panel.getByRole("slider", { name: /speed/i }), { target: { value: "1.1" } })

    expect(patchedBodies).toHaveLength(0)
    expect(panel.queryByText("Custom")).not.toBeInTheDocument()
    expect(panel.getByText("Unsaved")).toBeInTheDocument()
    expect(panel.getByRole("button", { name: "Reset Changes" })).toBeEnabled()

    await user.click(panel.getByRole("button", { name: "Save Voice Tuning" }))

    const dialog = screen.getByRole("dialog", { name: "Save Voice Tuning?" })
    expect(within(dialog).getByText(/updates this voice's default tuning for future generations/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/existing generated audio will not be affected/i)).toBeInTheDocument()
    expect(patchedBodies).toHaveLength(0)

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(patchedBodies).toHaveLength(0)
    panel = selectedVoiceTuningPanel()
    expect(panel.getByText("Unsaved")).toBeInTheDocument()
    expect(panel.getByRole("slider", { name: /speed/i })).toHaveValue("1.1")

    await user.click(panel.getByRole("button", { name: "Save Voice Tuning" }))
    await user.click(within(screen.getByRole("dialog", { name: "Save Voice Tuning?" })).getByRole("button", { name: "Save Voice Tuning" }))

    await waitFor(() => expect(patchedBodies).toHaveLength(1))
    expect(patchedBodies[0]).toEqual({
      providerId: "elevenlabs",
      voicePresetId: "animatedDialogue",
      voiceSettings: {
        stability: 0.4,
        similarityBoost: 0.75,
        style: 0.35,
        speed: 1.1,
        useSpeakerBoost: true,
      },
    })
  })

  it("keeps unsaved selected voice tuning draft across workflow navigation", async () => {
    window.history.replaceState(null, "", "/#voices")
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    let panel = await openSelectedVoiceTuningPanel(user)
    fireEvent.change(panel.getByRole("slider", { name: /speed/i }), { target: { value: "1.1" } })

    expect(panel.getByText("Unsaved")).toBeInTheDocument()
    expect(panel.getByRole("slider", { name: /speed/i })).toHaveValue("1.1")

    await user.click(screen.getByRole("button", { name: "Generate Speech" }))
    await waitFor(() => expect(window.location.hash).toBe("#generate"))
    await user.click(screen.getByRole("button", { name: "Voices" }))
    await waitFor(() => expect(window.location.hash).toBe("#voices"))

    panel = selectedVoiceTuningPanel()
    expect(panel.getByText("Unsaved")).toBeInTheDocument()
    expect(panel.getByRole("slider", { name: /speed/i })).toHaveValue("1.1")
  })

  it("resets selected voice tuning draft to saved metadata without patching", async () => {
    window.history.replaceState(null, "", "/#voices")
    const patchedBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (path === "/api/voices" && !init) {
          return okJson({
            defaultVoiceId: "default",
            voices: [{ ...defaultVoice, voiceSettingsByProvider: { elevenlabs: { speed: 1.12 } } }],
          })
        }
        if (path === "/api/voices/default" && init?.method === "PATCH") {
          patchedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const panel = await openSelectedVoiceTuningPanel(user)
    expect(panel.queryByText("Saved Provider Tuning")).not.toBeInTheDocument()
    expect(panel.getByRole("slider", { name: /speed/i })).toHaveValue("1.12")

    await user.click(panel.getByRole("radio", { name: "Animated Dialogue" }))
    fireEvent.change(panel.getByRole("slider", { name: /speed/i }), { target: { value: "1.15" } })

    expect(panel.getByText("Unsaved")).toBeInTheDocument()
    await user.click(panel.getByRole("button", { name: "Reset Changes" }))

    expect(patchedBodies).toHaveLength(0)
    expect(panel.getByRole("radio", { name: "Standard Narration" })).toHaveAttribute("aria-checked", "true")
    expect(panel.getByRole("radio", { name: "Animated Dialogue" })).toHaveAttribute("aria-checked", "false")
    expect(panel.getByRole("slider", { name: /speed/i })).toHaveValue("1.12")
    expect(panel.queryByText("Unsaved")).not.toBeInTheDocument()
    expect(panel.queryByText("Saved Provider Tuning")).not.toBeInTheDocument()
    expect(panel.queryByRole("button", { name: "Reset Changes" })).not.toBeInTheDocument()
    expect(panel.getByRole("button", { name: "Save Voice Tuning" })).toBeDisabled()
  })

  it("keeps Generate free of standalone tuning and sends resolved selected-voice defaults", async () => {
    window.history.replaceState(null, "", "/#generate")
    const baseFetch = mockFetch()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/voices" && !init) {
          return okJson({
            defaultVoiceId: "default",
            voices: [{ ...defaultVoice, voiceSettingsByProvider: { elevenlabs: { speed: 1.12 } } }],
          })
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()

    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const generateSection = document.querySelector('[data-section-id="generate"]')
    expect(generateSection).not.toBeNull()
    expect(within(generateSection as HTMLElement).queryByText("Voice Tuning")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("providerId")).toBe("elevenlabs")
    expect(JSON.parse(String(body.get("voiceSettings")))).toEqual({ speed: 1.12 })
  })

  it("maps selected voices to provider tuning presets by voice preset id", async () => {
    window.history.replaceState(null, "", "/#voices")
    const animatedVoice = { ...voiceCloneVoice, voicePresetId: "animatedDialogue" as const }
    const mappedProviderTuning = {
      ...elevenLabsTuning,
      defaultValues: { stability: 0.52, similarityBoost: 0.7, style: 0.05, speed: 0.98, useSpeakerBoost: true },
      presets: [
        {
          id: "balanced-read",
          label: "Standard Narration",
          description: "Provider-specific steady read.",
          voicePresetId: "standardNarration" as const,
          values: { stability: 0.52, similarityBoost: 0.7, style: 0.05, speed: 0.98, useSpeakerBoost: true },
        },
        {
          id: "character-read",
          label: "Animated Dialogue",
          description: "Provider-specific character read.",
          voicePresetId: "animatedDialogue" as const,
          values: { stability: 0.31, similarityBoost: 0.81, style: 0.51, speed: 1.05, useSpeakerBoost: false },
        },
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const path = url.split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson({
            ...providersResponse,
            providers: [{ ...providersResponse.providers[0], tuning: mappedProviderTuning }],
          })
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, animatedVoice] })
        }
        if (path === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (path === "/api/models" && !init) {
          return okJson({
            available: true,
            error: null,
            defaultModelId: "eleven_multilingual_v2",
            models: [multilingualModel, flashModel],
          })
        }
        if (path === "/api/speech" && init?.method === "POST") {
          return okAudio({ "X-App-Voice-Id": "voice-clone-01" })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Voice_Clone_01/i }))

    const panel = await openSelectedVoiceTuningPanel(user)
    expect(panel.queryByText("Custom")).not.toBeInTheDocument()
    expect(panel.getByRole("radio", { name: "Standard Narration" })).toHaveAttribute("aria-checked", "false")
    expect(panel.getByRole("radio", { name: "Animated Dialogue" })).toHaveAttribute("aria-checked", "true")
    expect(panel.getByRole("slider", { name: /stability/i })).toHaveValue("0.31")
    expect(panel.getByRole("slider", { name: /similarity/i })).toHaveValue("0.81")
    expect(panel.getByRole("slider", { name: /style/i })).toHaveValue("0.51")
    expect(panel.getByRole("slider", { name: /speed/i })).toHaveValue("1.05")
    expect(panel.getByRole("checkbox", { name: /Speaker boost/i })).not.toBeChecked()

    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("voiceId")).toBe("voice-clone-01")
    expect(body.get("providerId")).toBe("elevenlabs")
    expect(JSON.parse(String(body.get("voiceSettings")))).toEqual({
      stability: 0.31,
      similarityBoost: 0.81,
      style: 0.51,
      speed: 1.05,
      useSpeakerBoost: false,
    })
  })

  it("renders provider controls when presets are unavailable", async () => {
    window.history.replaceState(null, "", "/#voices")
    vi.stubGlobal(
      "fetch",
      mockFetchWithProviders({
        defaultProviderId: "single-control",
        providers: [
          {
            ...providersResponse.providers[0],
            id: "single-control",
            label: "Single Control",
            tuning: {
              controls: [
                {
                  id: "warmth",
                  label: "Warmth",
                  description: "Controls how warm the generated voice sounds.",
                  type: "slider",
                  defaultValue: 0.2,
                  min: 0,
                  max: 1,
                  step: 0.01,
                },
              ],
              presets: [],
              defaultValues: { warmth: 0.2 },
            },
          },
        ],
      })
    )

    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const panel = await openSelectedVoiceTuningPanel(user)
    expect(panel.getByText("Voice Tuning")).toBeInTheDocument()
    expect(panel.queryByText("Provider Tuning Preset")).not.toBeInTheDocument()
    expect(panel.getByRole("slider", { name: /warmth/i })).toHaveValue("0.2")
  })

  it("preserves selected provider option value types in saved voice tuning", async () => {
    window.history.replaceState(null, "", "/#voices")
    let patchVoiceBody: { providerId?: string; voiceSettings?: Record<string, unknown> } | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson({
            ...providersResponse,
            defaultProviderId: "select-provider",
            providers: [
              {
                ...providersResponse.providers[0],
                id: "select-provider",
                label: "Select Provider",
                tuning: {
                  controls: [
                    {
                      id: "mode",
                      label: "Mode",
                      description: "Selects provider generation mode.",
                      type: "select" as const,
                      defaultValue: 1,
                      options: [
                        { label: "One", value: 1 },
                        { label: "Two", value: 2 },
                      ],
                    },
                    {
                      id: "enhanced",
                      label: "Enhanced",
                      description: "Selects enhanced processing.",
                      type: "select" as const,
                      defaultValue: false,
                      options: [
                        { label: "Off", value: false },
                        { label: "On", value: true },
                      ],
                    },
                  ],
                  presets: [],
                  defaultValues: { mode: 1, enhanced: false },
                },
              },
            ],
          })
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/voices/default" && init?.method === "PATCH") {
          patchVoiceBody = JSON.parse(String(init.body))
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const panel = await openSelectedVoiceTuningPanel(user)
    await user.selectOptions(panel.getByRole("combobox", { name: "Mode" }), "2")
    await user.selectOptions(panel.getByRole("combobox", { name: "Enhanced" }), "true")
    await user.click(panel.getByRole("button", { name: "Save Voice Tuning" }))
    await user.click(within(screen.getByRole("dialog", { name: "Save Voice Tuning?" })).getByRole("button", { name: "Save Voice Tuning" }))

    await waitFor(() => expect(patchVoiceBody).not.toBeNull())
    expect(patchVoiceBody).toEqual({
      providerId: "select-provider",
      voiceSettings: { mode: 2, enhanced: true },
    })
  })

  it("keeps string toggle values unchecked and toggles from the label in saved voice tuning", async () => {
    window.history.replaceState(null, "", "/#voices")
    let patchVoiceBody: { providerId?: string; voiceSettings?: Record<string, unknown> } | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).split("?")[0]
        if (path === "/api/providers" && !init) {
          return okJson({
            ...providersResponse,
            defaultProviderId: "toggle-provider",
            providers: [
              {
                ...providersResponse.providers[0],
                id: "toggle-provider",
                label: "Toggle Provider",
                tuning: {
                  controls: [
                    {
                      id: "expressive",
                      label: "Expressive",
                      description: "Enables expressive delivery.",
                      type: "toggle" as const,
                      defaultValue: "false",
                    },
                  ],
                  presets: [],
                  defaultValues: { expressive: "false" },
                },
              },
            ],
          })
        }
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (path === "/api/voices/default" && init?.method === "PATCH") {
          patchVoiceBody = JSON.parse(String(init.body))
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const panel = await openSelectedVoiceTuningPanel(user)
    const checkbox = panel.getByRole("checkbox", { name: "Expressive" })
    expect(checkbox).not.toBeChecked()

    await user.click(panel.getByText("Expressive", { selector: "label" }))
    expect(checkbox).toBeChecked()
    await user.click(panel.getByRole("button", { name: "Save Voice Tuning" }))
    await user.click(within(screen.getByRole("dialog", { name: "Save Voice Tuning?" })).getByRole("button", { name: "Save Voice Tuning" }))

    await waitFor(() => expect(patchVoiceBody).not.toBeNull())
    expect(patchVoiceBody).toEqual({
      providerId: "toggle-provider",
      voiceSettings: { expressive: true },
    })
  })

  it("sends selected model and shows actual usage metadata", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await screen.findByRole("option", { name: "Eleven Flash v2.5" })
    await user.selectOptions(screen.getByLabelText(/model/i), "eleven_flash_v2_5")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("providerId")).toBe("elevenlabs")
    expect(body.get("modelId")).toBe("eleven_flash_v2_5")
    const formattedCharacterCount = formatTestNumber(54)
    expect(await screen.findAllByText(formattedCharacterCount)).toHaveLength(1)
    const latestPanel = latestGeneratedAudioPanel()
    expect(latestPanel.getByText(new RegExp(`${formattedCharacterCount} chars`))).toBeInTheDocument()
    expect(latestPanel.getByText(/req_test_123/)).toBeInTheDocument()
    expect(latestPanel.getByLabelText("Generated Audio Metadata")).toBeInTheDocument()
    expect(latestPanel.getByText("ElevenLabs")).toBeInTheDocument()
    expect(latestPanel.getByText("Preset: Standard Narration")).toBeInTheDocument()
    expect(latestPanel.getByText("Default Settings")).toBeInTheDocument()
  })

  it("persists browser-observed generation elapsed time", async () => {
    let currentTime = 1_000
    const baseFetch = mockFetch()
    vi.spyOn(performance, "now").mockImplementation(() => currentTime)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/speech" && init?.method === "POST") {
          currentTime = 2_234
        }
        return baseFetch(input, init)
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    expect(await latestGeneratedAudioPanel().findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect((await listGeneratedAudio())[0]).toMatchObject({
      generationElapsedMs: 1234,
      requestId: "req_test_123",
    })
    const latestPanel = screen.getByRole("heading", { name: "Latest Generated Audio" }).closest("section")
    expect(latestPanel).not.toBeNull()
    expect(within(latestPanel as HTMLElement).getByLabelText("Generated Audio Metadata")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Generated In 1.2s")).toBeInTheDocument()
    expect(
      within(latestPanel as HTMLElement).getByLabelText("Generated Audio Size 13 B; Exact Size 13 bytes")
    ).toBeInTheDocument()
  })

  it("keeps persisted generated audio in the archive before a new generation", async () => {
    await saveGeneratedAudio(generatedAudioInput({ id: "persisted-audio" }), 100 * BYTES_PER_MEBIBYTE)

    renderApp()

    const archiveHeading = await screen.findByRole("heading", { name: "Generated Audio Archive" })
    expect(screen.queryByRole("heading", { name: "Latest Generated Audio" })).not.toBeInTheDocument()
    const archivePanel = archiveHeading.closest("section")
    expect(archivePanel).not.toBeNull()
    expect(await within(archivePanel as HTMLElement).findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(within(archivePanel as HTMLElement).queryByLabelText("Generated Audio Metadata")).not.toBeInTheDocument()
  })

  it("shows timing metadata for archived audio without tuning metadata", async () => {
    await saveGeneratedAudio(
      generatedAudioInput({ generationElapsedMs: 1234, id: "timed-audio", tuningMetadata: null }),
      100 * BYTES_PER_MEBIBYTE
    )

    renderApp()

    const archiveHeading = await screen.findByRole("heading", { name: "Generated Audio Archive" })
    const archivePanel = archiveHeading.closest("section")
    expect(archivePanel).not.toBeNull()
    expect(await within(archivePanel as HTMLElement).findByLabelText("Generated Audio Metadata")).toBeInTheDocument()
    expect(await within(archivePanel as HTMLElement).findByText("Generated In 1.2s")).toBeInTheDocument()
  })

  it("persists generated audio across remounts", async () => {
    const user = userEvent.setup()
    const { unmount } = renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    expect(await latestGeneratedAudioPanel().findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(screen.getByText("1 saved")).toBeInTheDocument()
    unmount()

    renderApp()

    expect(screen.queryByRole("heading", { name: "Latest Generated Audio" })).not.toBeInTheDocument()
    const archiveHeading = await screen.findByRole("heading", { name: "Generated Audio Archive" })
    expect(archiveHeading).toBeInTheDocument()
    const archivePanel = archiveHeading.closest("section")
    expect(archivePanel).not.toBeNull()
    expect(await within(archivePanel as HTMLElement).findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(within(archivePanel as HTMLElement).getByLabelText("Generated Audio Metadata")).toBeInTheDocument()
    expect(within(archivePanel as HTMLElement).getByText(/Generated In/)).toBeInTheDocument()
    expect(within(archivePanel as HTMLElement).getByText("Preset: Standard Narration")).toBeInTheDocument()
    expect(within(archivePanel as HTMLElement).getByText("Default Settings")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute("download", expect.stringMatching(/^voice-clone-default-/))
  })

  it("removes one generated audio item and clears all saved audio", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    expect(await latestGeneratedAudioPanel().findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(await generatedAudioArchivePanel().findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    const latestPanel = latestGeneratedAudioPanel()
    const archivePanel = generatedAudioArchivePanel()
    await waitFor(() => expect(latestPanel.getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(1))
    await waitFor(() => expect(archivePanel.getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(2))

    await user.click(archivePanel.getAllByRole("button", { name: /remove generated audio for default voice/i })[0])
    await waitFor(() =>
      expect(archivePanel.getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(1)
    )

    await user.click(archivePanel.getByRole("button", { name: /clear all/i }))
    const dialog = screen.getByRole("dialog", { name: /clear generated audio/i })
    await user.click(within(dialog).getByRole("button", { name: /clear all/i }))

    await waitFor(() => expect(screen.queryByLabelText(/generated voice playback for default voice/i)).not.toBeInTheDocument())
    expect(screen.queryByRole("heading", { name: "Latest Generated Audio" })).not.toBeInTheDocument()
    expect(screen.getByText("No generated speech yet.")).toBeInTheDocument()
  })

  it("clears the current latest generated audio from the archive controls", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    expect(await screen.findByRole("heading", { name: "Latest Generated Audio" })).toBeInTheDocument()
    expect(await latestGeneratedAudioPanel().findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    const archivePanel = generatedAudioArchivePanel()
    expect(await archivePanel.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()

    await user.click(archivePanel.getByRole("button", { name: /clear all/i }))
    const dialog = screen.getByRole("dialog", { name: /clear generated audio/i })
    await user.click(within(dialog).getByRole("button", { name: /clear all/i }))

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Latest Generated Audio" })).not.toBeInTheDocument())
    expect(screen.queryByLabelText(/generated voice playback for default voice/i)).not.toBeInTheDocument()
    expect(screen.getByText("No generated speech yet.")).toBeInTheDocument()
  })

  it("removes temporary generated audio when browser storage is unavailable", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await screen.findByText((_, element) => element?.textContent === "0 B / 100 MB")
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request = {
        error: new Error("storage unavailable"),
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
      } as Partial<IDBOpenDBRequest> as IDBOpenDBRequest
      queueMicrotask(() => request.onerror?.call(request, new Event("error")))
      return request
    })

    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    const latestPanel = latestGeneratedAudioPanel()
    const archivePanel = generatedAudioArchivePanel()
    expect(await latestPanel.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(screen.getByText("1 unsaved")).toBeInTheDocument()
    expect(screen.queryByText("1 saved")).not.toBeInTheDocument()
    expect(latestPanel.getByText(/browser storage could not save it/i)).toBeInTheDocument()
    expect(archivePanel.queryByText(/browser storage could not save it/i)).not.toBeInTheDocument()

    await user.click(latestPanel.getByRole("button", { name: /remove generated audio for default voice/i }))

    await waitFor(() => expect(screen.queryByLabelText(/generated voice playback for default voice/i)).not.toBeInTheDocument())
    expect(screen.queryByRole("heading", { name: "Latest Generated Audio" })).not.toBeInTheDocument()
    expect(screen.queryByText(/browser storage could not save it/i)).not.toBeInTheDocument()
  })

  it("keeps confirmation dialog focus contained and closes with Escape", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    const archivePanel = generatedAudioArchivePanel()
    expect(await archivePanel.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()

    const clearAllButton = archivePanel.getByRole("button", { name: /clear all/i })
    await user.click(clearAllButton)
    const dialog = screen.getByRole("dialog", { name: /clear generated audio/i })
    const cancelButton = within(dialog).getByRole("button", { name: /cancel/i })
    const confirmButton = within(dialog).getByRole("button", { name: /clear all/i })

    expect(cancelButton).toHaveFocus()

    await user.keyboard("{Shift>}{Tab}{/Shift}")
    expect(confirmButton).toHaveFocus()

    await user.tab()
    expect(cancelButton).toHaveFocus()

    await user.keyboard("{Escape}")

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /clear generated audio/i })).not.toBeInTheDocument())
    expect(clearAllButton).toHaveFocus()
    expect(archivePanel.getByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
  })

  it("confirms before lowering the storage cap when saved audio would be pruned", async () => {
    const largeAudioBlob = new Blob(["fake audio"], { type: "audio/mpeg" })
    Object.defineProperty(largeAudioBlob, "size", { value: 30 * BYTES_PER_MEBIBYTE })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          const response = new Response(null, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "X-App-Voice-Id": "default",
              "X-Character-Count": "54",
              "X-Request-Id": "req_test_123",
              "X-Voice-Cache": "miss",
              "X-Voice-Id": "voice-123",
            },
          })
          Object.defineProperty(response, "blob", { value: () => Promise.resolve(largeAudioBlob) })
          return Promise.resolve(response)
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    const archivePanel = generatedAudioArchivePanel()
    expect(await archivePanel.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(await screen.findByText((_, element) => element?.textContent === "30 MB / 100 MB")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /cap: 100 mb/i }))
    await user.click(screen.getByRole("menuitemradio", { name: /25 mb/i }))

    let dialog = screen.getByRole("dialog", { name: /lower storage cap/i })
    expect(within(dialog).getByText(/remove the oldest saved generated audio/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }))
    expect(screen.getByRole("button", { name: /cap: 100 mb/i })).toBeInTheDocument()
    expect(archivePanel.getByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /cap: 100 mb/i }))
    await user.click(screen.getByRole("menuitemradio", { name: /25 mb/i }))
    dialog = screen.getByRole("dialog", { name: /lower storage cap/i })
    await user.click(within(dialog).getByRole("button", { name: /lower cap/i }))

    await waitFor(() => expect(screen.queryByLabelText(/generated voice playback for default voice/i)).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: /cap: 25 mb/i })).toBeInTheDocument()
  })

  it("reports the backend resolved model when model metadata is still loading", async () => {
    let resolveModels: (value: Response) => void = () => undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/providers" && !init) {
          return okJson(providersResponse)
        }
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url.startsWith("/api/subscription") && !init) {
          return okJson(subscription)
        }
        if (url.startsWith("/api/models") && !init) {
          return new Promise<Response>((resolve) => {
            resolveModels = resolve
          })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          return okAudio({ "X-Model-Id": "eleven_turbo_v2_5" })
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.has("modelId")).toBe(false)
    const latestPanel = latestGeneratedAudioPanel()
    expect(await latestPanel.findByText(/Model eleven_turbo_v2_5/)).toBeInTheDocument()
    expect(latestPanel.queryByText(/Model eleven_multilingual_v2/)).not.toBeInTheDocument()

    resolveModels(
      new Response(
        JSON.stringify({
          available: true,
          error: null,
          defaultModelId: "eleven_turbo_v2_5",
          models: [multilingualModel],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
  })
})
