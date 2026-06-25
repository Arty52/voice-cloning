import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { VoiceAsset, VoicesResponse } from "@/types"

import { useVoiceLibrary } from "./use-voice-library"

const baseVoice = voiceAsset()

describe("useVoiceLibrary", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("saves provider tuning settings to a voice", async () => {
    const patchedVoice = voiceAsset({
      voiceSettingsByProvider: {
        elevenlabs: { speed: 1.16 },
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === "/api/voices" && !init) {
          return okJson({ defaultVoiceId: baseVoice.id, voices: [baseVoice] })
        }
        if (path === "/api/voices/narrator" && init?.method === "PATCH") {
          return okJson({ defaultVoiceId: patchedVoice.id, voices: [patchedVoice] })
        }
        return okJson({ defaultVoiceId: "", voices: [] })
      })
    )
    const { result } = renderHook(() => useVoiceLibrary())

    await waitFor(() => expect(result.current.voiceStatus).toBe("success"))
    await act(async () => {
      await result.current.updateVoiceSettings(baseVoice, "elevenlabs", { speed: 1.16 })
    })

    expect(fetch).toHaveBeenLastCalledWith(
      "/api/voices/narrator",
      expect.objectContaining({
        body: JSON.stringify({
          providerId: "elevenlabs",
          voiceSettings: { speed: 1.16 },
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    )
    expect(result.current.voices[0].voiceSettingsByProvider).toEqual({
      elevenlabs: { speed: 1.16 },
    })
    expect(result.current.voiceActionStatus).toBe("success")
  })
})

function okJson(payload: VoicesResponse) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
}

function voiceAsset(overrides: Partial<VoiceAsset> = {}): VoiceAsset {
  return {
    contentType: "audio/mpeg",
    createdAt: "2026-06-23T00:00:00.000Z",
    filePath: "narrator.mp3",
    id: "narrator",
    name: "Narrator",
    processingSteps: [],
    sampleMode: "excerpt",
    sha256: "narrator-hash",
    source: "default",
    sourceContentType: null,
    sourceFilePath: null,
    sourceSha256: null,
    voicePresetId: "standardNarration",
    voiceSettingsByProvider: {},
    windowDurationSeconds: null,
    windowStartSeconds: null,
    ...overrides,
  }
}
