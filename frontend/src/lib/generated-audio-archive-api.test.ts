import { describe, expect, it, vi, afterEach } from "vitest"

import {
  GeneratedAudioArchiveUnavailableError,
  listGeneratedAudioArchive,
  saveGeneratedAudioArchive,
} from "./generated-audio-archive-api"

function archiveItem(id: string) {
  return {
    appVoiceId: "default",
    audioUrl: `/api/generated-audio/${id}/audio`,
    cacheState: "miss",
    characterCount: 10,
    contentType: "audio/wav",
    createdAt: "2026-07-01T12:00:00.000Z",
    generationElapsedMs: null,
    id,
    modelId: "eleven_multilingual_v2",
    multiVoiceMetadata: null,
    providerId: "elevenlabs",
    requestId: null,
    sha256: "hash",
    sizeBytes: 4,
    tuningMetadata: null,
    voiceId: "voice-123",
    voiceName: "Narrator",
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

describe("generated audio archive API", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("treats malformed unavailable JSON responses as archive unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("{", {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        )
      )
    )

    await expect(listGeneratedAudioArchive()).rejects.toMatchObject({
      message: "{",
      name: "GeneratedAudioArchiveUnavailableError",
    } satisfies Partial<GeneratedAudioArchiveUnavailableError>)
  })

  it("uses explicit content type for multipart archive uploads", async () => {
    let uploadedFile: unknown = null
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const formData = init?.body as FormData
        uploadedFile = formData.get("audioFile") as File
        return okJson({
          alreadyExisted: false,
          item: archiveItem("audio-one"),
          prunedIds: [],
          usage: {
            itemCount: 1,
            limitBytes: 1024,
            remainingBytes: 1020,
            usedBytes: 4,
          },
        })
      })
    )

    await saveGeneratedAudioArchive(
      {
        appVoiceId: "default",
        blob: new Blob(["test"], { type: "application/octet-stream" }),
        cacheState: "miss",
        characterCount: 10,
        contentType: "audio/wav",
        id: "audio-one",
        modelId: "eleven_multilingual_v2",
        requestId: null,
        voiceId: "voice-123",
        voiceName: "Narrator",
      },
      1024
    )

    if (!(uploadedFile instanceof File)) {
      throw new Error("Expected generated audio upload file.")
    }
    expect(uploadedFile.type).toBe("audio/wav")
    expect(uploadedFile.name).toBe("audio-one.wav")
  })
})
