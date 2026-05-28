import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App"
import { BYTES_PER_MEBIBYTE, GENERATED_AUDIO_DB_NAME } from "./lib/generated-audio-storage"

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
}

const voiceCloneVoice = {
  id: "voice-clone-01",
  name: "Voice_Clone_01",
  filePath: "voice-clone-01.mp3",
  contentType: "audio/mpeg",
  sha256: "voice-clone-01-hash",
  source: "upload" as const,
  createdAt: "2026-05-28T00:00:00+00:00",
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

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/voices" && !init) {
      return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
    }
    if (url === "/api/subscription" && !init) {
      return okJson(subscription)
    }
    if (url === "/api/models" && !init) {
      return okJson({
        available: true,
        error: null,
        defaultModelId: "eleven_multilingual_v2",
        models: [multilingualModel, flashModel],
      })
    }
    if (url === "/api/voices" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ voice: voiceCloneVoice }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
    }
    if (url === "/api/voices/default" && init?.method === "PUT") {
      return okJson({ defaultVoiceId: "voice-clone-01", voices: [defaultVoice, voiceCloneVoice] })
    }
    if (url === "/api/speech" && init?.method === "POST") {
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
    render(<App />)

    const textarea = await screen.findByLabelText(/text to speak/i)
    await user.clear(textarea)
    await user.type(textarea, "This is a long text input that should expand the textarea.")

    await waitFor(() => expect(textarea).toHaveStyle({ height: "320px" }))
    expect(await screen.findByText("default/default-voice.mp3")).toBeInTheDocument()
  })

  it("places cost quota under add voice and expands details", async () => {
    const user = userEvent.setup()
    render(<App />)

    const costHeading = await screen.findByText("Cost & Quota")
    const addVoiceHeading = screen.getByText("Add Voice")
    expect(addVoiceHeading.compareDocumentPosition(costHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await screen.findByText(`${formatTestNumber(9000)} remaining`)).toBeInTheDocument()
    expect(screen.getByText(`~${formatTestNumber(117)}`)).toBeInTheDocument()
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

  it("collapses cost quota details while keeping the overview", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText(`${formatTestNumber(9000)} remaining`)
    await user.click(screen.getByRole("button", { name: /expand/i }))
    expect(screen.getByLabelText(/model/i)).toBeVisible()

    await user.click(screen.getByRole("button", { name: /collapse/i }))

    expect(screen.getByText(`${formatTestNumber(9000)} remaining`)).toBeInTheDocument()
    expect(screen.getByText(`~${formatTestNumber(117)}`)).toBeInTheDocument()
    expect(screen.getByLabelText(/model/i)).not.toBeVisible()
    expect(screen.queryByRole("link", { name: /api requests/i })).not.toBeInTheDocument()
  })

  it("shows pending state while generating speech", async () => {
    let resolveSpeech: (value: Response) => void = () => undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
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
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
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
  })

  it("cancels an in-flight speech request after confirmation", async () => {
    let speechSignal: AbortSignal | null = null
    vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
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
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    await user.click(screen.getByRole("button", { name: /cancel/i }))

    expect(window.confirm).toHaveBeenCalledWith(
      "Cancel this generation? ElevenLabs does not offer server-side cancellation for text-to-speech requests, so this may still consume credits."
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
    render(<App />)

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

  it("saves a named upload and selects it", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.type(screen.getByLabelText(/voice name/i), "Voice_Clone_01")
    const file = new File(["sample"], "voice-clone-01.wav", { type: "audio/wav" })
    await user.upload(screen.getByLabelText(/sample file/i), file)
    await user.click(screen.getByRole("button", { name: /save voice/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" })))
    const uploadCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/voices" && init?.method === "POST"
    )
    const body = uploadCall?.[1]?.body as FormData
    expect(body.get("name")).toBe("Voice_Clone_01")
    expect(body.get("sampleFile")).toBe(file)
    expect(await screen.findByRole("button", { name: /Voice_Clone_01/i })).toBeInTheDocument()
  })

  it("sets the selected voice as the local default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
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
    render(<App />)

    await user.click(await screen.findByRole("button", { name: /Voice_Clone_01/i }))
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

  it("shows tuning help and selects standard narration by default", async () => {
    render(<App />)

    await screen.findByText("default/default-voice.mp3")

    expect(screen.getByRole("button", { name: /stability help/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /similarity help/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /style help/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /speed help/i })).toBeInTheDocument()
    expect(screen.getByText(/lower values allow more expressive/i)).toBeInTheDocument()
    expect(screen.getByText(/very high similarity can preserve them/i)).toBeInTheDocument()
    expect(screen.getByText(/zero is the most natural/i)).toBeInTheDocument()
    expect(screen.getByText(/one point zero is the baseline pace/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: /animated dialogue/i })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("slider", { name: /stability/i })).toHaveValue("0.5")
    expect(screen.getByRole("slider", { name: /similarity/i })).toHaveValue("0.75")
    expect(screen.getByRole("slider", { name: /style/i })).toHaveValue("0")
    expect(screen.getByRole("slider", { name: /speed/i })).toHaveValue("1")
    expect(screen.queryByText("Custom")).not.toBeInTheDocument()
  })

  it("applies animated dialogue and marks manual tuning as custom", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /animated dialogue/i }))

    expect(screen.getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: /animated dialogue/i })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("slider", { name: /stability/i })).toHaveValue("0.4")
    expect(screen.getByRole("slider", { name: /similarity/i })).toHaveValue("0.75")
    expect(screen.getByRole("slider", { name: /style/i })).toHaveValue("0.35")
    expect(screen.getByRole("slider", { name: /speed/i })).toHaveValue("1")

    fireEvent.change(screen.getByRole("slider", { name: /speed/i }), { target: { value: "1.1" } })

    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /animated dialogue/i })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("slider", { name: /speed/i })).toHaveValue("1.1")
  })

  it("marks tuning as custom when speaker boost changes", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    expect(screen.getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "true")

    await user.click(screen.getByLabelText(/Speaker boost/i))

    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /standard narration/i })).toHaveAttribute("aria-pressed", "false")
  })

  it("sends tuning values with speech generation", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    fireEvent.change(screen.getByRole("slider", { name: /stability/i }), { target: { value: "0.42" } })
    fireEvent.change(screen.getByRole("slider", { name: /similarity/i }), { target: { value: "0.84" } })
    fireEvent.change(screen.getByRole("slider", { name: /style/i }), { target: { value: "0.2" } })
    fireEvent.change(screen.getByRole("slider", { name: /speed/i }), { target: { value: "1.1" } })
    await user.click(screen.getByLabelText(/Speaker boost/i))
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("voiceId")).toBe("default")
    expect(body.get("modelId")).toBe("eleven_multilingual_v2")
    expect(body.get("stability")).toBe("0.42")
    expect(body.get("similarityBoost")).toBe("0.84")
    expect(body.get("style")).toBe("0.2")
    expect(body.get("speed")).toBe("1.1")
    expect(body.get("useSpeakerBoost")).toBe("false")
  })

  it("sends selected model and shows actual usage metadata", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /expand/i }))
    await user.selectOptions(screen.getByLabelText(/model/i), "eleven_flash_v2_5")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("modelId")).toBe("eleven_flash_v2_5")
    const formattedCharacterCount = formatTestNumber(54)
    expect(await screen.findAllByText(formattedCharacterCount)).toHaveLength(1)
    expect(screen.getByText(new RegExp(`${formattedCharacterCount} chars`))).toBeInTheDocument()
    expect(screen.getAllByText(/req_test_123/)).toHaveLength(2)
  })

  it("persists generated audio across remounts", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))

    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(screen.getByText("1 saved")).toBeInTheDocument()
    unmount()

    render(<App />)

    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute("download", expect.stringMatching(/^voice-clone-default-/))
  })

  it("removes one generated audio item and clears all saved audio", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    expect(await screen.findAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    await waitFor(() => expect(screen.getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(2))

    await user.click(screen.getAllByRole("button", { name: /remove generated audio for default voice/i })[0])
    await waitFor(() => expect(screen.getAllByLabelText(/generated voice playback for default voice/i)).toHaveLength(1))

    await user.click(screen.getByRole("button", { name: /clear all/i }))
    const dialog = screen.getByRole("dialog", { name: /clear generated audio/i })
    await user.click(within(dialog).getByRole("button", { name: /clear all/i }))

    await waitFor(() => expect(screen.queryByLabelText(/generated voice playback for default voice/i)).not.toBeInTheDocument())
    expect(screen.getByText("No generated speech yet.")).toBeInTheDocument()
  })

  it("removes temporary generated audio when browser storage is unavailable", async () => {
    const user = userEvent.setup()
    render(<App />)

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
    expect(screen.getByText("1 unsaved")).toBeInTheDocument()
    expect(screen.queryByText("1 saved")).not.toBeInTheDocument()
    expect(screen.getByText(/browser storage could not save it/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /remove generated audio for default voice/i }))

    await waitFor(() => expect(screen.queryByLabelText(/generated voice playback for default voice/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/browser storage could not save it/i)).not.toBeInTheDocument()
  })

  it("keeps confirmation dialog focus contained and closes with Escape", async () => {
    const user = userEvent.setup()
    render(<App />)

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
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.click(screen.getByRole("button", { name: /^Generate$/ }))
    expect(await screen.findByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()
    expect(await screen.findByText((_, element) => element?.textContent === "30 MB / 100 MB")).toBeInTheDocument()

    const capSelect = screen.getByLabelText(/cap/i)
    await user.selectOptions(capSelect, String(25 * BYTES_PER_MEBIBYTE))

    let dialog = screen.getByRole("dialog", { name: /lower storage cap/i })
    expect(within(dialog).getByText(/remove the oldest saved generated audio/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }))
    expect(capSelect).toHaveValue(String(100 * BYTES_PER_MEBIBYTE))
    expect(screen.getByLabelText(/generated voice playback for default voice/i)).toBeInTheDocument()

    await user.selectOptions(capSelect, String(25 * BYTES_PER_MEBIBYTE))
    dialog = screen.getByRole("dialog", { name: /lower storage cap/i })
    await user.click(within(dialog).getByRole("button", { name: /lower cap/i }))

    await waitFor(() => expect(screen.queryByLabelText(/generated voice playback for default voice/i)).not.toBeInTheDocument())
    expect(capSelect).toHaveValue(String(25 * BYTES_PER_MEBIBYTE))
  })

  it("reports the backend resolved model when model metadata is still loading", async () => {
    let resolveModels: (value: Response) => void = () => undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
        }
        if (url === "/api/subscription" && !init) {
          return okJson(subscription)
        }
        if (url === "/api/models" && !init) {
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
    render(<App />)

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
