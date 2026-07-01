import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useUserTuningPresets } from "./use-user-tuning-presets"
import type { UserTuningPreset } from "@/types"

describe("useUserTuningPresets", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("loads presets from the server and writes mutations back to the API", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === "/api/voice-tuning-presets" && !init) {
        return okJson({
          available: true,
          presets: [preset({ id: "server-preset", name: "Server Preset" })],
        })
      }
      if (path === "/api/voice-tuning-presets" && init?.method === "POST") {
        return okJson({ preset: preset({ id: "created-preset", name: "Created Preset" }) })
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useUserTuningPresets())

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.persistenceMode).toBe("server")
    expect(result.current.presets.map((candidate) => candidate.id)).toEqual(["server-preset"])

    let createdPreset: UserTuningPreset | null = null
    await act(async () => {
      createdPreset = await result.current.createPreset({
        name: "Created Preset",
        providerId: "elevenlabs",
        settings: { stability: 0.5 },
        voicePresetId: "standardNarration",
      })
    })

    expect(createdPreset).toMatchObject({ id: "created-preset" })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice-tuning-presets",
      expect.objectContaining({
        body: JSON.stringify({
          name: "Created Preset",
          providerId: "elevenlabs",
          settings: { stability: 0.5 },
          voicePresetId: "standardNarration",
        }),
        method: "POST",
      })
    )
    await waitFor(() => expect(result.current.presets.map((candidate) => candidate.id)).toContain("created-preset"))
  })

  it("falls back to browser presets when the server API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => unavailableResponse()))

    const { result } = renderHook(() => useUserTuningPresets())

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.persistenceMode).toBe("browser")

    await act(async () => {
      await result.current.createPreset({
        id: "browser preset",
        name: "Browser Preset",
        providerId: "elevenlabs",
        settings: { stability: 0.42 },
        voicePresetId: null,
      })
    })
    await waitFor(() => expect(result.current.presets).toHaveLength(1))
    expect(result.current.presets[0]).toMatchObject({
      id: "browser-preset",
      name: "Browser Preset",
      settings: { stability: 0.42 },
    })

    await act(async () => {
      await result.current.updatePreset("browser-preset", {
        name: "Updated Browser Preset",
        providerId: "elevenlabs",
        settings: { stability: 0.6 },
        voicePresetId: "animatedDialogue",
      })
    })
    await waitFor(() => expect(result.current.presets[0].name).toBe("Updated Browser Preset"))
    expect(result.current.presets[0]).toMatchObject({
      settings: { stability: 0.6 },
      voicePresetId: "animatedDialogue",
    })

    await act(async () => {
      await result.current.deletePreset("browser-preset")
    })
    await waitFor(() => expect(result.current.presets).toHaveLength(0))
  })

  it("uses browser fallback for server mutations that become unavailable", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/voice-tuning-presets" && !init) {
        return okJson({ available: true, presets: [] })
      }
      return unavailableResponse()
    })
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useUserTuningPresets())

    await waitFor(() => expect(result.current.persistenceMode).toBe("server"))

    await act(async () => {
      await result.current.createPreset({
        id: "fallback-preset",
        name: "Fallback Preset",
        providerId: "elevenlabs",
        settings: { stability: 0.7 },
      })
    })

    await waitFor(() => expect(result.current.persistenceMode).toBe("browser"))
    expect(result.current.presets[0]).toMatchObject({
      id: "fallback-preset",
      name: "Fallback Preset",
    })
  })
})

function preset(overrides: Partial<UserTuningPreset> = {}): UserTuningPreset {
  return {
    createdAt: "2026-07-01T12:00:00.000Z",
    id: "warm-read",
    name: "Warm Read",
    providerId: "elevenlabs",
    settings: { stability: 0.5 },
    updatedAt: "2026-07-01T12:00:00.000Z",
    voicePresetId: "standardNarration",
    ...overrides,
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

function unavailableResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({ detail: "Voice tuning preset persistence is not configured." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  )
}
