import { afterEach, describe, expect, it, vi } from "vitest"

import {
  GeneratedAudioServerExportUnavailableError,
  exportAllGeneratedAudioToServer,
  exportGeneratedAudioToServer,
  loadGeneratedAudioServerExportStatus,
} from "./generated-audio-export-api"

const exportedItem = {
  audioId: "audio-1",
  exportedAt: "2026-07-01T18:45:22.000Z",
  filename: "generated-audio/2026/07/audio-1.mp3",
  lastError: null,
  sha256: "abc123",
  status: "exported",
  targetId: "local-filesystem",
  updatedAt: "2026-07-01T18:45:22.000Z",
}

describe("generated audio server export API", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("loads and normalizes export status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          available: true,
          items: [exportedItem],
          targetId: "local-filesystem",
        })
      )
    )

    await expect(loadGeneratedAudioServerExportStatus()).resolves.toEqual({
      available: true,
      items: [exportedItem],
      targetId: "local-filesystem",
    })
  })

  it("posts a single export by id without submitting a path", async () => {
    const fetchMock = vi.fn(() => jsonResponse({ alreadyExported: false, item: exportedItem }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(exportGeneratedAudioToServer("audio/1")).resolves.toMatchObject({
      alreadyExported: false,
      item: exportedItem,
    })

    expect(fetchMock).toHaveBeenCalledWith("/api/generated-audio/audio%2F1/export", { method: "POST" })
  })

  it("posts export-all and normalizes counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          exportedCount: 1.8,
          failedCount: 0,
          items: [exportedItem],
        })
      )
    )

    await expect(exportAllGeneratedAudioToServer()).resolves.toMatchObject({
      exportedCount: 1,
      failedCount: 0,
      items: [exportedItem],
    })
  })

  it("reports unavailable export configuration from 503 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ detail: "Generated audio export directory is not configured." }, 503))
    )

    await expect(exportAllGeneratedAudioToServer()).rejects.toBeInstanceOf(GeneratedAudioServerExportUnavailableError)
  })

  it("surfaces route errors for missing archive items", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ detail: "Generated audio item was not found." }, 404)))

    await expect(exportGeneratedAudioToServer("missing-audio")).rejects.toThrow("Generated audio item was not found.")
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  )
}
