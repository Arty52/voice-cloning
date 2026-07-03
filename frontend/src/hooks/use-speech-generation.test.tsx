import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  GeneratedAudioScriptSnapshot,
  GeneratedResult,
  VoiceAsset,
  VoiceProvider,
} from "@/types"

import { useSpeechGeneration } from "./use-speech-generation"

const voice: VoiceAsset = {
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

const scriptSnapshot: GeneratedAudioScriptSnapshot = {
  version: 1,
  mode: "range",
  text: "Hello there.",
  sourceVoiceId: "narrator",
  assignments: [],
  dialogueBlocks: [],
  speakerMappings: [],
  segmentGapMs: null,
}

const generatedResult: GeneratedResult = {
  appVoiceId: "narrator",
  cacheState: "miss",
  characterCount: 12,
  contentType: "audio/mpeg",
  createdAt: "2026-06-23T00:00:02.000Z",
  generatedAt: "Jun 23, 2026",
  generationElapsedMs: 10,
  id: "generated-1",
  modelId: "eleven_flash_v2_5",
  multiVoiceMetadata: null,
  requestId: "request-1",
  sha256: "generated-1-hash",
  sizeBytes: 12,
  tuningMetadata: null,
  scriptSnapshot,
  url: "blob:generated-1",
  voiceId: "narrator",
  voiceName: "Narrator",
}

function okAudio(content = "single") {
  return Promise.resolve(
    new Response(new Blob([content], { type: "audio/mpeg" }), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "X-App-Voice-Id": "narrator",
        "X-Character-Count": "12",
        "X-Model-Id": "eleven_flash_v2_5",
        "X-Request-Id": "request-1",
        "X-Voice-Cache": "miss",
        "X-Voice-Id": "narrator",
      },
    })
  )
}

describe("useSpeechGeneration", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("persists a generated audio script snapshot with single voice results", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okAudio()))
    const persistGeneratedAudio = vi.fn(async () => generatedResult)
    const { result } = renderHook(() => useSpeechGeneration({ persistGeneratedAudio }))

    await act(async () => {
      await result.current.generateSpeech({
        backendDefaultModelId: "eleven_multilingual_v2",
        canUseProvider: true,
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
        scriptSnapshot,
        selectedModelId: "eleven_flash_v2_5",
        selectedTuningPresetId: "custom",
        selectedVoice: voice,
        storageLimitBytes: 100,
        text: "Hello there.",
        tuning: { stability: 0.42 },
      })
    })

    expect(result.current.status).toBe("success")
    expect(persistGeneratedAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheState: "miss",
        characterCount: 12,
        scriptSnapshot,
        voiceId: "narrator",
        voiceName: "Narrator",
      }),
      100
    )
  })
})
