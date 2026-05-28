import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App"

const audioBlob = new Blob(["fake audio"], { type: "audio/mpeg" })

const defaultVoice = {
  id: "default",
  name: "Default voice",
  filePath: "default/default-voice.mp3",
  contentType: "audio/mpeg",
  sha256: "default-hash",
  source: "default" as const,
  createdAt: "2026-05-28T00:00:00+00:00",
}

const grayVoice = {
  id: "gray",
  name: "Gray",
  filePath: "gray.mp3",
  contentType: "audio/mpeg",
  sha256: "gray-hash",
  source: "upload" as const,
  createdAt: "2026-05-28T00:00:00+00:00",
}

function okJson(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
}

function okAudio() {
  return Promise.resolve(
    new Response(audioBlob, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "X-App-Voice-Id": "default",
        "X-Voice-Cache": "miss",
        "X-Voice-Id": "voice-123",
      },
    })
  )
}

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/voices" && !init) {
      return okJson({ defaultVoiceId: "default", voices: [defaultVoice] })
    }
    if (url === "/api/voices" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ voice: grayVoice }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
    }
    if (url === "/api/voices/default" && init?.method === "PUT") {
      return okJson({ defaultVoiceId: "gray", voices: [defaultVoice, grayVoice] })
    }
    if (url === "/api/speech" && init?.method === "POST") {
      return okAudio()
    }
    return okJson({})
  })
}

describe("App", () => {
  beforeEach(() => {
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
    await user.click(screen.getByRole("button", { name: /generate/i }))

    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled()
    resolveSpeech(
      new Response(audioBlob, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "X-App-Voice-Id": "default",
          "X-Voice-Cache": "miss",
          "X-Voice-Id": "voice-123",
        },
      })
    )
    expect(await screen.findByLabelText(/generated voice playback/i)).toBeInTheDocument()
  })

  it("saves a named upload and selects it", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    await user.type(screen.getByLabelText(/voice name/i), "Gray")
    const file = new File(["sample"], "gray.wav", { type: "audio/wav" })
    await user.upload(screen.getByLabelText(/sample file/i), file)
    await user.click(screen.getByRole("button", { name: /save voice/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" })))
    const uploadCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/voices" && init?.method === "POST"
    )
    const body = uploadCall?.[1]?.body as FormData
    expect(body.get("name")).toBe("Gray")
    expect(body.get("sampleFile")).toBe(file)
    expect(await screen.findByRole("button", { name: /Gray/i })).toBeInTheDocument()
  })

  it("sets the selected voice as the local default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: "default", voices: [defaultVoice, grayVoice] })
        }
        if (url === "/api/voices/default" && init?.method === "PUT") {
          return okJson({ defaultVoiceId: "gray", voices: [defaultVoice, grayVoice] })
        }
        if (url === "/api/speech" && init?.method === "POST") {
          return okAudio()
        }
        return okJson({})
      })
    )
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole("button", { name: /Gray/i }))
    await user.click(screen.getByRole("button", { name: /set as default/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/voices/default",
        expect.objectContaining({
          body: JSON.stringify({ voiceId: "gray" }),
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

  it("sends tuning values with speech generation", async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText("default/default-voice.mp3")
    fireEvent.change(screen.getByRole("slider", { name: /stability/i }), { target: { value: "0.42" } })
    fireEvent.change(screen.getByRole("slider", { name: /similarity/i }), { target: { value: "0.84" } })
    fireEvent.change(screen.getByRole("slider", { name: /style/i }), { target: { value: "0.2" } })
    fireEvent.change(screen.getByRole("slider", { name: /speed/i }), { target: { value: "1.1" } })
    await user.click(screen.getByLabelText(/Speaker boost/i))
    await user.click(screen.getByRole("button", { name: /generate/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/speech", expect.objectContaining({ method: "POST" })))
    const speechCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => String(url) === "/api/speech" && init?.method === "POST"
    )
    const body = speechCall?.[1]?.body as FormData
    expect(body.get("voiceId")).toBe("default")
    expect(body.get("stability")).toBe("0.42")
    expect(body.get("similarityBoost")).toBe("0.84")
    expect(body.get("style")).toBe("0.2")
    expect(body.get("speed")).toBe("1.1")
    expect(body.get("useSpeakerBoost")).toBe("false")
  })
})
