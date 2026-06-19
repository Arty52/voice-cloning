import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App"
import { TooltipProvider } from "./components/ui/tooltip"
import { VOICE_PROVIDER_KEY_HEADER } from "./lib/api"
import {
  BYTES_PER_MEBIBYTE,
  GENERATED_AUDIO_DB_NAME,
  listGeneratedAudio,
  saveGeneratedAudio,
} from "./lib/generated-audio-storage"
import { PROVIDER_KEYS_STORAGE_KEY } from "./lib/provider-keys"
import type { ProvidersResponse } from "./types"

const audioBlob = new Blob(["fake audio"], { type: "audio/mpeg" })
const formatTestNumber = (value: number) => new Intl.NumberFormat().format(value)

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
  processingSteps: [],
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
        maxWindowSeconds: 120,
        recommendedMinSeconds: 60,
        recommendedMaxSeconds: 120,
      },
      tuning: elevenLabsTuning,
    },
  ],
}

const sampleProcessingOptions = {
  engine: "demucs",
  operations: [
    {
      id: "isolateVoice" as const,
      label: "Isolate Voice",
      description: "Separate the vocal stem from music or background audio with Demucs.",
      enabled: true,
    },
    {
      id: "trimSilence" as const,
      label: "Trim Silence",
      description: "Remove leading, trailing, or long empty regions from a sample.",
      enabled: false,
    },
    {
      id: "separateSpeakers" as const,
      label: "Separate Speakers",
      description: "Split a track into speaker-specific samples.",
      enabled: false,
    },
  ],
}

const successfulSampleProcessingJob = {
  job: {
    id: "job-1",
    operationId: "isolateVoice" as const,
    operationLabel: "Isolate Voice",
    status: "success" as const,
    sourceName: "Default voice",
    sourceSha256: "default-hash",
    sourcePreference: "original" as const,
    engine: "demucs",
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

function okJson(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
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

function scopedPanelByHeading(name: string) {
  const heading = screen.getByRole("heading", { name })
  const panel = heading.closest("section, form")
  expect(panel).not.toBeNull()
  return within(panel as HTMLElement)
}

function addVoicePanel() {
  return scopedPanelByHeading("Add Voice")
}

function voiceLibraryPanel() {
  return scopedPanelByHeading("Voice Library")
}

function sampleProcessingPanel() {
  return scopedPanelByHeading("Sample Processing")
}

function voiceTuningPanel() {
  return scopedPanelByHeading("Voice Tuning")
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
  beforeEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
    localStorage.clear()
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      value: 320,
    })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", mockFetch())
  })

  afterEach(() => {
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
    await user.click(screen.getByRole("button", { name: /expand/i }))
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

  it("places cost quota under add voice and expands details", async () => {
    const user = userEvent.setup()
    renderApp()

    const costHeading = await screen.findByText("Cost & Quota")
    const addVoiceHeading = screen.getByText("Add Voice")
    expect(addVoiceHeading.compareDocumentPosition(costHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await screen.findByText(`${formatTestNumber(9000)} remaining`)).toBeInTheDocument()
    expect(screen.getByText(`~${formatTestNumber(97)}`)).toBeInTheDocument()
    expect(screen.getByText("No run")).toBeInTheDocument()
    const costQuotaDetails = document.querySelector("#cost-quota-details")
    expect(costQuotaDetails).toBeInTheDocument()
    expect(costQuotaDetails).not.toBeVisible()
    expect(screen.getByLabelText(/model/i)).not.toBeVisible()
    expect(screen.getByText(`${formatTestNumber(1000)} / ${formatTestNumber(10000)}`)).not.toBeVisible()

    const expandButton = screen.getByRole("button", { name: /expand/i })
    expect(expandButton).toHaveAttribute("aria-expanded", "false")
    await user.click(expandButton)

    expect(screen.getByRole("button", { name: /collapse/i })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByLabelText(/model/i)).toHaveValue("eleven_multilingual_v2")
    expect(screen.getByText(`${formatTestNumber(1000)} / ${formatTestNumber(10000)}`)).toBeVisible()
    expect(screen.getByRole("link", { name: /api requests/i })).toHaveAttribute(
      "href",
      "https://elevenlabs.io/app/developers/analytics/api-requests"
    )
    expect(screen.getByRole("link", { name: /models/i })).toHaveAttribute(
      "href",
      "https://elevenlabs.io/docs/api-reference/models/list"
    )
  })

  it("keeps sample processing separate between voice library and add voice", async () => {
    renderApp()

    const voiceLibraryHeading = await screen.findByText("Voice Library")
    const sampleProcessingHeading = screen.getByText("Sample Processing")
    const addVoiceHeading = screen.getByText("Add Voice")

    expect(voiceLibraryHeading.compareDocumentPosition(sampleProcessingHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sampleProcessingHeading.compareDocumentPosition(addVoiceHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sampleProcessingPanel().getByRole("button", { name: "Open Sample Processing" })).toHaveAttribute(
      "aria-expanded",
      "false"
    )
    expect(sampleProcessingPanel().queryByRole("button", { name: "Start Processing" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Generate$/ })).toBeInTheDocument()
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
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Open Sample Processing" }))

    expect(await sampleProcessingPanel().findByText("Sample Processing Unavailable")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByRole("button", { name: "Start Processing" })).toBeDisabled()
  })

  it("processes an existing voice, previews the result, and saves it as a selectable voice", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Open Sample Processing" }))
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())

    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    expect(jobCall).toBeDefined()
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("operationId")).toBe("isolateVoice")
    expect(jobBody.get("sourceVoiceId")).toBe("default")
    expect(jobBody.get("sourcePreference")).toBe("original")
    expect(jobBody.get("sourceFile")).toBeNull()

    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
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

  it("clears a processed preview when sample processing inputs change", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Open Sample Processing" }))
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Active Sample" }))

    await waitFor(() => {
      expect(sampleProcessingPanel().queryByLabelText("Processed sample preview")).not.toBeInTheDocument()
    })
    expect(sampleProcessingPanel().queryByRole("button", { name: "Add To Voice Library" })).not.toBeInTheDocument()

    await user.click(sampleProcessingPanel().getByRole("button", { name: "Start Processing" }))

    const jobCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST")
    expect(jobCalls).toHaveLength(2)
    const nextJobBody = jobCalls[1]?.[1]?.body as FormData
    expect(nextJobBody.get("sourcePreference")).toBe("active")
  })

  it("creates a sample processing job from an uploaded file", async () => {
    const user = userEvent.setup()
    const sourceFile = new File(["source"], "vegeta.wav", { type: "audio/wav" })
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Open Sample Processing" }))
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Audio File" }))
    await user.upload(sampleProcessingPanel().getByLabelText("Audio File"), sourceFile)
    const startButton = sampleProcessingPanel().getByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())

    await user.click(startButton)

    const jobCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/sample-processing/jobs" && init?.method === "POST"
    )
    const jobBody = jobCall?.[1]?.body as FormData
    expect(jobBody.get("operationId")).toBe("isolateVoice")
    expect(jobBody.get("sourceFile")).toBe(sourceFile)
    expect(jobBody.get("sourceVoiceId")).toBeNull()
    expect(await sampleProcessingPanel().findByLabelText("Processed sample preview")).toBeInTheDocument()
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
    await user.click(sampleProcessingPanel().getByRole("button", { name: "Open Sample Processing" }))
    const startButton = await sampleProcessingPanel().findByRole("button", { name: "Start Processing" })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)

    expect(await sampleProcessingPanel().findByText("Processing Failed")).toBeInTheDocument()
    expect(sampleProcessingPanel().getByText("demucs command was not found.")).toBeInTheDocument()
  })

  it("collapses cost quota details while keeping the overview", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText(`${formatTestNumber(9000)} remaining`)
    await user.click(screen.getByRole("button", { name: /expand/i }))
    expect(screen.getByLabelText(/model/i)).toBeVisible()

    await user.click(screen.getByRole("button", { name: /collapse/i }))

    expect(screen.getByText(`${formatTestNumber(9000)} remaining`)).toBeInTheDocument()
    expect(screen.getByText(`~${formatTestNumber(97)}`)).toBeInTheDocument()
    expect(screen.getByLabelText(/model/i)).not.toBeVisible()
    expect(screen.queryByRole("link", { name: /api requests/i })).not.toBeInTheDocument()
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
    const textLabel = screen.getByText("Text to Speak")
    const tuningHeading = screen.getByRole("heading", { name: "Voice Tuning" })
    expect(textLabel.compareDocumentPosition(latestHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(latestHeading.compareDocumentPosition(tuningHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

    expect(await screen.findByLabelText(/generated voice playback/i)).toBeInTheDocument()
    expect(screen.queryByText(/Generation canceled in this browser/i)).not.toBeInTheDocument()
  })

  it("saves a named upload with the selected voice preset and selects it", async () => {
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const addPresetGroup = within(addVoicePanel().getByRole("radiogroup", { name: "Voice Preset" }))
    await user.click(addPresetGroup.getByRole("radio", { name: /animated dialogue/i }))
    await user.type(screen.getByLabelText(/voice name/i), "Voice_Clone_01")
    const file = new File(["sample"], "voice-clone-01.wav", { type: "audio/wav" })
    await user.upload(screen.getByLabelText(/sample file/i), file)
    await screen.findByRole("group", { name: /saved sample mode/i })
    await user.click(screen.getByRole("button", { name: /save voice/i }))

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

  it("defaults long uploads to the provider maximum window", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchWithProviders({
        ...providersResponse,
        providers: [
          {
            ...providersResponse.providers[0],
            sample: {
              maxWindowSeconds: 2,
              recommendedMinSeconds: 1,
              recommendedMaxSeconds: 2,
            },
          },
        ],
      })
    )
    stubDecodedAudio(3)
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.upload(screen.getByLabelText(/sample file/i), new File(["sample"], "long.wav", { type: "audio/wav" }))

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
    await user.type(screen.getByLabelText(/voice name/i), "Voice_Clone_01")
    await user.upload(screen.getByLabelText(/sample file/i), new File(["sample"], "long.wav", { type: "audio/wav" }))
    expect(await screen.findByText("0:03 Selected")).toBeInTheDocument()

    providers.resolve(
      new Response(
        JSON.stringify({
          ...providersResponse,
          providers: [
            {
              ...providersResponse.providers[0],
              sample: {
                maxWindowSeconds: 2,
                recommendedMinSeconds: 1,
                recommendedMaxSeconds: 2,
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
    await user.click(screen.getByRole("button", { name: /save voice/i }))

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
              maxWindowSeconds: 2,
              recommendedMinSeconds: 1,
              recommendedMaxSeconds: 2,
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
    await user.type(screen.getByLabelText(/voice name/i), "Voice_Clone_01")
    await user.upload(screen.getByLabelText(/sample file/i), file)
    await user.click(await screen.findByRole("button", { name: /keep original/i }))
    await user.click(screen.getByRole("button", { name: /save voice/i }))

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
    await user.type(screen.getByLabelText(/voice name/i), "Voice_Clone_01")
    await user.upload(screen.getByLabelText(/sample file/i), new File(["sample"], "broken.wav", { type: "audio/wav" }))

    expect(await screen.findByText(/unable to decode this audio file/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save voice/i })).toBeDisabled()
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
    await user.upload(screen.getByLabelText(/sample file/i), new File(["sample"], "voice.wav", { type: "audio/wav" }))

    expect(await screen.findByText("0:03 Selected")).toBeInTheDocument()
    expect(screen.getByText("2:00 Max")).toBeInTheDocument()
  })

  it("sets the selected voice as the local default", async () => {
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

    await user.click(await screen.findByRole("button", { name: /^Voice_Clone_01/i }))
    await user.click(screen.getByRole("button", { name: /set as default/i }))

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

  it("updates the selected voice preset from the library", async () => {
    const animatedDefaultVoice = { ...defaultVoice, voicePresetId: "animatedDialogue" as const }
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
        if (url === "/api/voices/default" && init?.method === "PATCH") {
          return okJson({ defaultVoiceId: "default", voices: [animatedDefaultVoice, voiceCloneVoice] })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const currentPresetGroup = () => within(voiceLibraryPanel().getByRole("radiogroup", { name: "Voice Preset" }))
    expect(currentPresetGroup().getByRole("radio", { name: /standard narration/i })).toHaveAttribute("aria-checked", "true")

    await user.click(currentPresetGroup().getByRole("radio", { name: /animated dialogue/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/voices/default",
        expect.objectContaining({
          body: JSON.stringify({ voicePresetId: "animatedDialogue" }),
          method: "PATCH",
        })
      )
    )
    expect(currentPresetGroup().getByRole("radio", { name: /animated dialogue/i })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("slider", { name: /stability/i })).toHaveValue("0.4")
    expect(screen.getByRole("slider", { name: /style/i })).toHaveValue("0.35")
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
    expect(await screen.findByText(/add or record a voice to proceed/i)).toBeInTheDocument()
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

    await user.type(await screen.findByLabelText(/voice name/i), "Voice_Clone_01")
    await user.click(screen.getByRole("button", { name: /^Record$/ }))
    await user.click(screen.getByRole("button", { name: /start recording/i }))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }))
    processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0, 0.5, -0.5]),
      },
    })
    await user.click(screen.getByRole("button", { name: /^Stop$/ }))
    expect(await screen.findByLabelText(/recorded voice sample preview/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /save voice/i }))
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

  it("clears a recorded sample when switching back to upload", async () => {
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

    await user.type(await screen.findByLabelText(/voice name/i), "Voice_Clone_01")
    await user.click(screen.getByRole("button", { name: /^Record$/ }))
    await user.click(screen.getByRole("button", { name: /start recording/i }))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }))
    processor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0.25]),
      },
    })
    await user.click(screen.getByRole("button", { name: /^Stop$/ }))
    expect(await screen.findByLabelText(/recorded voice sample preview/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Upload$/ }))

    expect(screen.getByText(/no upload selected/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save voice/i })).toBeDisabled()
  })

  it("reports unsupported recording and keeps upload available", async () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined })
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Record$/ }))
    await user.click(screen.getByRole("button", { name: /start recording/i }))

    expect(await screen.findByText(/microphone recording is not supported/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Upload$/ }))
    expect(screen.getByLabelText(/sample file/i)).toBeInTheDocument()
  })

  it("shows tuning help and selects standard narration by default", async () => {
    renderApp()

    await screen.findByText("default/default-voice.mp3")

    expect(screen.getByRole("button", { name: /stability help/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /similarity help/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /style help/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /speed help/i })).toBeInTheDocument()
    expect(screen.getByText(/lower values allow more expressive/i)).toBeInTheDocument()
    expect(screen.getByText(/very high similarity can preserve them/i)).toBeInTheDocument()
    expect(screen.getByText(/zero is the most natural/i)).toBeInTheDocument()
    expect(screen.getByText(/one point zero is the baseline pace/i)).toBeInTheDocument()
    expect(voiceTuningPanel().getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "true")
    expect(voiceTuningPanel().getByRole("button", { name: /animated dialogue/i })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("slider", { name: /stability/i })).toHaveValue("0.5")
    expect(screen.getByRole("slider", { name: /similarity/i })).toHaveValue("0.75")
    expect(screen.getByRole("slider", { name: /style/i })).toHaveValue("0")
    expect(screen.getByRole("slider", { name: /speed/i })).toHaveValue("1")
    expect(screen.queryByText("Custom")).not.toBeInTheDocument()
  })

  it("hides voice tuning when the active provider has no controls", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchWithProviders({
        defaultProviderId: "plain",
        providers: [
          {
            ...providersResponse.providers[0],
            id: "plain",
            label: "Plain Provider",
            links: [],
            tuning: { controls: [], presets: [], defaultValues: {} },
          },
        ],
      })
    )
    const user = userEvent.setup()

    renderApp()

    await screen.findByText("default/default-voice.mp3")
    expect(screen.queryByText("Voice Tuning")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("providerId")).toBe("plain")
    expect(JSON.parse(String(body.get("voiceSettings")))).toEqual({})
  })

  it("maps selected voices to provider tuning presets by voice preset id", async () => {
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
    fireEvent.change(screen.getByRole("slider", { name: /stability/i }), { target: { value: "0.9" } })
    expect(screen.getByText("Custom")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Voice_Clone_01/i }))

    expect(screen.queryByText("Custom")).not.toBeInTheDocument()
    expect(voiceTuningPanel().getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "false")
    expect(voiceTuningPanel().getByRole("button", { name: /animated dialogue/i })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("slider", { name: /stability/i })).toHaveValue("0.31")
    expect(screen.getByRole("slider", { name: /similarity/i })).toHaveValue("0.81")
    expect(screen.getByRole("slider", { name: /style/i })).toHaveValue("0.51")
    expect(screen.getByRole("slider", { name: /speed/i })).toHaveValue("1.05")
    expect(screen.getByRole("checkbox", { name: /Speaker boost/i })).not.toBeChecked()

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

    renderApp()

    await screen.findByText("default/default-voice.mp3")
    expect(screen.getByText("Voice Tuning")).toBeInTheDocument()
    expect(screen.queryByText("Preset")).not.toBeInTheDocument()
    expect(screen.getByRole("slider", { name: /warmth/i })).toHaveValue("0.2")
  })

  it("preserves selected provider option value types", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchWithProviders({
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
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "2")
    await user.selectOptions(screen.getByRole("combobox", { name: "Enhanced" }), "true")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("providerId")).toBe("select-provider")
    expect(JSON.parse(String(body.get("voiceSettings")))).toEqual({ mode: 2, enhanced: true })
    const latestPanel = screen.getByRole("heading", { name: "Latest Generated Audio" }).closest("section")
    expect(latestPanel).not.toBeNull()
    expect(within(latestPanel as HTMLElement).getByLabelText("Generated Audio Metadata")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Select Provider")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Custom Settings")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Mode Two")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Enhanced On")).toBeInTheDocument()
  })

  it("keeps string toggle values unchecked and toggles from the label", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchWithProviders({
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
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    const checkbox = screen.getByRole("checkbox", { name: "Expressive" })
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByText("Expressive", { selector: "label" }))
    expect(checkbox).toBeChecked()
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("providerId")).toBe("toggle-provider")
    expect(JSON.parse(String(body.get("voiceSettings")))).toEqual({ expressive: true })
    const latestPanel = screen.getByRole("heading", { name: "Latest Generated Audio" }).closest("section")
    expect(latestPanel).not.toBeNull()
    expect(within(latestPanel as HTMLElement).getByText("Toggle Provider")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Custom Settings")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Expressive On")).toBeInTheDocument()
  })

  it("applies animated dialogue and marks manual tuning as custom", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(voiceTuningPanel().getByRole("button", { name: /animated dialogue/i }))

    expect(voiceTuningPanel().getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "false")
    expect(voiceTuningPanel().getByRole("button", { name: /animated dialogue/i })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("slider", { name: /stability/i })).toHaveValue("0.4")
    expect(screen.getByRole("slider", { name: /similarity/i })).toHaveValue("0.75")
    expect(screen.getByRole("slider", { name: /style/i })).toHaveValue("0.35")
    expect(screen.getByRole("slider", { name: /speed/i })).toHaveValue("1")

    fireEvent.change(screen.getByRole("slider", { name: /speed/i }), { target: { value: "1.1" } })

    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(voiceTuningPanel().getByRole("button", { name: /animated dialogue/i })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("slider", { name: /speed/i })).toHaveValue("1.1")
  })

  it("marks tuning as custom when speaker boost changes", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    expect(voiceTuningPanel().getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "true")

    await user.click(screen.getByRole("checkbox", { name: /Speaker boost/i }))

    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(voiceTuningPanel().getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "false")
  })

  it("sends tuning values with speech generation", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    fireEvent.change(screen.getByRole("slider", { name: /stability/i }), { target: { value: "0.42" } })
    fireEvent.change(screen.getByRole("slider", { name: /similarity/i }), { target: { value: "0.84" } })
    fireEvent.change(screen.getByRole("slider", { name: /style/i }), { target: { value: "0.2" } })
    fireEvent.change(screen.getByRole("slider", { name: /speed/i }), { target: { value: "1.1" } })
    await user.click(screen.getByRole("checkbox", { name: /Speaker boost/i }))
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("voiceId")).toBe("default")
    expect(body.get("providerId")).toBe("elevenlabs")
    expect(body.get("modelId")).toBe("eleven_multilingual_v2")
    expect(JSON.parse(String(body.get("voiceSettings")))).toEqual({
      stability: 0.42,
      similarityBoost: 0.84,
      style: 0.2,
      speed: 1.1,
      useSpeakerBoost: false,
    })
    const latestPanel = screen.getByRole("heading", { name: "Latest Generated Audio" }).closest("section")
    expect(latestPanel).not.toBeNull()
    expect(within(latestPanel as HTMLElement).getByLabelText("Generated Audio Metadata")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("ElevenLabs")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Custom Settings")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Stability 0.42")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Similarity 0.84")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Style 0.2")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Speed 1.1")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Speaker Boost Off")).toBeInTheDocument()
  })

  it("sends selected model and shows actual usage metadata", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /expand/i }))
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
    expect(screen.getByText(new RegExp(`${formattedCharacterCount} chars`))).toBeInTheDocument()
    expect(screen.getAllByText(/req_test_123/)).toHaveLength(2)
    const latestPanel = screen.getByRole("heading", { name: "Latest Generated Audio" }).closest("section")
    expect(latestPanel).not.toBeNull()
    expect(within(latestPanel as HTMLElement).getByLabelText("Generated Audio Metadata")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("ElevenLabs")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Preset: Standard Narration")).toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText("Default Settings")).toBeInTheDocument()
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

    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
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

    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
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
    expect(await screen.findAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    await waitFor(() => expect(screen.getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(2))
    const latestPanel = screen.getByRole("heading", { name: "Latest Generated Audio" }).closest("section")
    const archivePanel = screen.getByRole("heading", { name: "Generated Audio Archive" }).closest("section")
    expect(latestPanel).not.toBeNull()
    expect(archivePanel).not.toBeNull()
    expect(within(latestPanel as HTMLElement).getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(1)
    expect(within(archivePanel as HTMLElement).getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(1)

    await user.click(screen.getAllByRole("button", { name: /remove generated audio for default voice/i })[0])
    await waitFor(() => expect(screen.getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(1))

    await user.click(screen.getByRole("button", { name: /clear all/i }))
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
    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /clear all/i }))
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

    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    const latestPanel = screen.getByRole("heading", { name: "Latest Generated Audio" }).closest("section")
    const archivePanel = screen.getByRole("heading", { name: "Generated Audio Archive" }).closest("section")
    expect(latestPanel).not.toBeNull()
    expect(archivePanel).not.toBeNull()
    expect(screen.getByText("1 unsaved")).toBeInTheDocument()
    expect(screen.queryByText("1 saved")).not.toBeInTheDocument()
    expect(within(latestPanel as HTMLElement).getByText(/browser storage could not save it/i)).toBeInTheDocument()
    expect(within(archivePanel as HTMLElement).queryByText(/browser storage could not save it/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /remove generated audio for default voice/i }))

    await waitFor(() => expect(screen.queryByLabelText(/generated voice playback for default voice/i)).not.toBeInTheDocument())
    expect(screen.queryByRole("heading", { name: "Latest Generated Audio" })).not.toBeInTheDocument()
    expect(screen.queryByText(/browser storage could not save it/i)).not.toBeInTheDocument()
  })

  it("keeps confirmation dialog focus contained and closes with Escape", async () => {
    const user = userEvent.setup()
    renderApp()

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()

    const clearAllButton = screen.getByRole("button", { name: /clear all/i })
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
    expect(screen.getByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
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
    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(await screen.findByText((_, element) => element?.textContent === "30 MB / 100 MB")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /cap: 100 mb/i }))
    await user.click(screen.getByRole("menuitemradio", { name: /25 mb/i }))

    let dialog = screen.getByRole("dialog", { name: /lower storage cap/i })
    expect(within(dialog).getByText(/remove the oldest saved generated audio/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }))
    expect(screen.getByRole("button", { name: /cap: 100 mb/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()

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
    expect(await screen.findByText(/Model eleven_turbo_v2_5/)).toBeInTheDocument()
    expect(screen.queryByText(/Model eleven_multilingual_v2/)).not.toBeInTheDocument()

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
