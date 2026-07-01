import { afterEach, describe, expect, it, vi } from "vitest"

import { AppSettingsUnavailableError, loadAppSettings, saveAppSettings } from "./app-settings-api"

describe("app settings API", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("loads and normalizes allowlisted settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              available: true,
              settings: {
                generatedAudioStorageLimit: { limitBytes: 25 },
                naturalHandoffs: { enabled: false },
                selectedModelByProvider: { elevenlabs: "eleven_flash_v2_5" },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      )
    )

    await expect(loadAppSettings()).resolves.toEqual({
      available: true,
      settings: {
        generatedAudioStorageLimit: { limitBytes: 25 },
        naturalHandoffs: { enabled: false },
        selectedModelByProvider: { elevenlabs: "eleven_flash_v2_5" },
      },
    })
  })

  it("saves settings through the allowlisted endpoint", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            available: true,
            settings: {
              naturalHandoffs: { enabled: true },
              selectedModelByProvider: { elevenlabs: "eleven_multilingual_v2" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    await saveAppSettings({ selectedModelByProvider: { elevenlabs: "eleven_multilingual_v2" } })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({ settings: { selectedModelByProvider: { elevenlabs: "eleven_multilingual_v2" } } }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      })
    )
  })

  it("reports settings persistence as unavailable on transition responses", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))))

    await expect(loadAppSettings()).rejects.toBeInstanceOf(AppSettingsUnavailableError)
  })
})
