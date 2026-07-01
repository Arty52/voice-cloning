import { afterEach, describe, expect, it, vi } from "vitest"

import {
  UserTuningPresetsUnavailableError,
  createUserTuningPreset,
  deleteUserTuningPreset,
  listUserTuningPresets,
  updateUserTuningPreset,
} from "./user-tuning-presets-api"

describe("user tuning presets API", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("loads and normalizes user tuning presets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        okJson({
          available: true,
          presets: [
            {
              createdAt: "2026-07-01T12:00:00.000Z",
              id: "warm-read",
              name: "Warm Read",
              providerId: "elevenlabs",
              settings: { stability: 0.42 },
              updatedAt: "2026-07-01T12:00:00.000Z",
              voicePresetId: "standardNarration",
            },
          ],
        })
      )
    )

    await expect(listUserTuningPresets()).resolves.toEqual({
      available: true,
      presets: [
        {
          createdAt: "2026-07-01T12:00:00.000Z",
          id: "warm-read",
          name: "Warm Read",
          providerId: "elevenlabs",
          settings: { stability: 0.42 },
          updatedAt: "2026-07-01T12:00:00.000Z",
          voicePresetId: "standardNarration",
        },
      ],
    })
  })

  it("sends create and update payloads to allowlisted endpoints", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { name: string }) : null
      return okJson({
        preset: {
          createdAt: "2026-07-01T12:00:00.000Z",
          id: input === "/api/voice-tuning-presets" ? "created-preset" : "warm-read",
          name: body?.name ?? "Warm Read",
          providerId: "elevenlabs",
          settings: { stability: 0.5 },
          updatedAt: "2026-07-01T12:01:00.000Z",
          voicePresetId: null,
        },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    await createUserTuningPreset({
      name: "Created Preset",
      providerId: "elevenlabs",
      settings: { stability: 0.5 },
      voicePresetId: null,
    })
    await updateUserTuningPreset("warm read", {
      name: "Updated Preset",
      providerId: "elevenlabs",
      settings: { stability: 0.5 },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/voice-tuning-presets",
      expect.objectContaining({
        body: JSON.stringify({
          name: "Created Preset",
          providerId: "elevenlabs",
          settings: { stability: 0.5 },
          voicePresetId: null,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/voice-tuning-presets/warm%20read",
      expect.objectContaining({
        body: JSON.stringify({
          name: "Updated Preset",
          providerId: "elevenlabs",
          settings: { stability: 0.5 },
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      })
    )
  })

  it("deletes user presets by encoded id", async () => {
    const fetchMock = vi.fn(() => okJson({ deleted: true }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(deleteUserTuningPreset("warm read")).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice-tuning-presets/warm%20read",
      expect.objectContaining({ method: "DELETE" })
    )
  })

  it("reports unavailable persistence for transition responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: "Voice tuning preset persistence is not configured." }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        )
      )
    )

    await expect(listUserTuningPresets()).rejects.toBeInstanceOf(UserTuningPresetsUnavailableError)
  })

  it("rejects incomplete preset list entries instead of dropping them silently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        okJson({
          available: true,
          presets: [{ id: "partial", name: "Partial Preset" }],
        })
      )
    )

    await expect(listUserTuningPresets()).rejects.toBeInstanceOf(UserTuningPresetsUnavailableError)
  })

  it("reports mutation 404 responses as API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: "Voice tuning preset was not found." }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        )
      )
    )

    await expect(
      updateUserTuningPreset("missing", {
        name: "Missing Preset",
        providerId: "elevenlabs",
        settings: { stability: 0.5 },
      })
    ).rejects.toThrow("Voice tuning preset was not found.")
    await expect(
      updateUserTuningPreset("missing", {
        name: "Missing Preset",
        providerId: "elevenlabs",
        settings: { stability: 0.5 },
      })
    ).rejects.not.toBeInstanceOf(UserTuningPresetsUnavailableError)
  })

  it("reports delete 404 responses as API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: "Voice tuning preset was not found." }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        )
      )
    )

    await expect(deleteUserTuningPreset("missing")).rejects.toThrow("Voice tuning preset was not found.")
    await expect(deleteUserTuningPreset("missing")).rejects.not.toBeInstanceOf(UserTuningPresetsUnavailableError)
  })

  it("reports non-string validation detail without reading the body twice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: [{ msg: "Secret-like settings are not allowed." }] }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          })
        )
      )
    )

    await expect(
      createUserTuningPreset({
        name: "Invalid",
        providerId: "elevenlabs",
        settings: { apiKey: "secret" },
      })
    ).rejects.toThrow('[{"msg":"Secret-like settings are not allowed."}]')
  })
})

function okJson(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
}
