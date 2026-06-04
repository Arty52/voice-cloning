import { afterEach, describe, expect, it, vi } from "vitest"

import { addVoice, providerHeaders, updateVoice, VOICE_PROVIDER_KEY_HEADER } from "./api"

function okJson(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  )
}

describe("provider request headers", () => {
  it("adds the provider key header when a browser key is available", () => {
    expect(providerHeaders({ providerKey: " browser-key " })).toEqual({
      [VOICE_PROVIDER_KEY_HEADER]: "browser-key",
    })
  })

  it("omits provider headers when no browser key is available", () => {
    expect(providerHeaders({ providerKey: null })).toBeUndefined()
    expect(providerHeaders({ providerKey: "   " })).toBeUndefined()
  })
})

describe("voice API helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("sends voice preset id when adding a voice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        okJson({
          voice: {
            id: "voice-clone-01",
            name: "Voice_Clone_01",
            voicePresetId: "animatedDialogue",
          },
        })
      )
    )
    const sample = new File(["sample"], "voice.mp3", { type: "audio/mpeg" })

    await addVoice("Voice_Clone_01", sample, { voicePresetId: "animatedDialogue" })

    expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" }))
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData
    expect(body.get("name")).toBe("Voice_Clone_01")
    expect(body.get("sampleFile")).toBe(sample)
    expect(body.get("voicePresetId")).toBe("animatedDialogue")
  })

  it("updates a voice with partial fields", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ defaultVoiceId: "default", voices: [] })))

    await updateVoice("default", { voicePresetId: "standardNarration" })

    expect(fetch).toHaveBeenCalledWith(
      "/api/voices/default",
      expect.objectContaining({
        body: JSON.stringify({ voicePresetId: "standardNarration" }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    )
  })
})
