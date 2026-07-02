import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { archivedAudioToResult, buildGeneratedAudioSizeDisplay, revokeGeneratedAudioUrls, storedAudioToResult } from "./generated-audio-view-model"
import type { StoredGeneratedAudio } from "./generated-audio-storage"

const formatTestNumber = (value: number) => new Intl.NumberFormat().format(value)

const baseRecord: StoredGeneratedAudio = {
  appVoiceId: "default",
  blob: new Blob(["sample"], { type: "audio/mpeg" }),
  cacheState: "miss",
  characterCount: 54,
  contentType: "audio/mpeg",
  createdAt: "2026-05-28T10:01:00.000Z",
  generationElapsedMs: 1234,
  id: "generated-audio",
  modelId: "eleven_multilingual_v2",
  requestId: "req_test_123",
  sha256: "stored-audio-hash",
  sizeBytes: 6,
  voiceId: "voice-123",
  voiceName: "Default Voice",
}

const multiVoiceMetadata = {
  jobId: "job-1",
  resultSha256: "combined-hash",
  segmentCount: 1,
  segments: [
    {
      assignmentKind: "assigned" as const,
      characterCount: 12,
      generationCount: 1,
      id: "segment-one",
      index: 0,
      resultSha256: "segment-hash",
      text: "Hello.",
      voiceId: "voice-123",
      voiceName: "Default Voice",
      voiceSettings: { stability: 0.42 },
    },
  ],
  voices: [{ segmentCount: 1, voiceId: "voice-123", voiceName: "Default Voice" }],
}

describe("storedAudioToResult", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated-audio")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("preserves stored tuning metadata", () => {
    const result = storedAudioToResult({
      ...baseRecord,
      multiVoiceMetadata,
      tuningMetadata: {
        adjustedSettings: [
          {
            id: "style",
            label: "Style",
            nominalValue: 0,
            nominalValueLabel: "0",
            value: 0.35,
            valueLabel: "0.35",
          },
        ],
        mode: "preset",
        presetId: "animated",
        presetLabel: "Animated Dialogue",
        providerId: "elevenlabs",
        providerLabel: "ElevenLabs",
      },
    })

    expect(result.tuningMetadata).toMatchObject({
      adjustedSettings: [{ id: "style", valueLabel: "0.35" }],
      presetLabel: "Animated Dialogue",
      providerLabel: "ElevenLabs",
    })
    expect(result.generationElapsedMs).toBe(1234)
    expect(result.multiVoiceMetadata).toEqual(multiVoiceMetadata)
    expect(result.sha256).toBe("stored-audio-hash")
  })

  it("normalizes legacy records without optional metadata", () => {
    const legacyRecord: Partial<StoredGeneratedAudio> = { ...baseRecord }
    delete legacyRecord.generationElapsedMs
    const result = storedAudioToResult(legacyRecord as StoredGeneratedAudio)

    expect(result.generationElapsedMs).toBeNull()
    expect(result.multiVoiceMetadata).toBeNull()
    expect(result.tuningMetadata).toBeNull()
  })
})

describe("archivedAudioToResult", () => {
  it("uses the server stream URL without creating an object URL", () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated-audio")

    const result = archivedAudioToResult({
      appVoiceId: "default",
      audioUrl: "/api/generated-audio/generated-audio/audio",
      cacheState: "hit",
      characterCount: 54,
      contentType: "audio/mpeg",
      createdAt: "2026-05-28T10:01:00.000Z",
      generationElapsedMs: 1234,
      id: "generated-audio",
      modelId: "eleven_multilingual_v2",
      multiVoiceMetadata: null,
      providerId: "elevenlabs",
      requestId: "req_test_123",
      sha256: "audio-hash",
      sizeBytes: 6,
      tuningMetadata: null,
      voiceId: "voice-123",
      voiceName: "Default Voice",
    })

    expect(result.url).toBe("/api/generated-audio/generated-audio/audio")
    expect(result.cacheState).toBe("hit")
    expect(result.sha256).toBe("audio-hash")
    expect(createObjectUrl).not.toHaveBeenCalled()
    createObjectUrl.mockRestore()
  })
})

describe("revokeGeneratedAudioUrls", () => {
  it("only revokes browser object URLs", () => {
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)

    revokeGeneratedAudioUrls([
      generatedResult("blob:generated-audio"),
      generatedResult("/api/generated-audio/server-audio/audio"),
    ])

    expect(revokeObjectUrl).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:generated-audio")
    revokeObjectUrl.mockRestore()
  })
})

function generatedResult(url: string) {
  return {
    appVoiceId: "default",
    cacheState: "miss",
    characterCount: 54,
    contentType: "audio/mpeg",
    createdAt: "2026-05-28T10:01:00.000Z",
    generatedAt: "May 28, 2026, 10:01 AM",
    generationElapsedMs: 1234,
    id: url.startsWith("blob:") ? "blob-audio" : "server-audio",
    modelId: "eleven_multilingual_v2",
    multiVoiceMetadata: null,
    requestId: "req_test_123",
    sha256: "audio-hash",
    sizeBytes: 6,
    tuningMetadata: null,
    url,
    voiceId: "voice-123",
    voiceName: "Default Voice",
  }
}

describe("buildGeneratedAudioSizeDisplay", () => {
  it("builds generated audio size labels from byte counts", () => {
    const exactLabel = `${formatTestNumber(898_656)} bytes`

    expect(buildGeneratedAudioSizeDisplay(898_656)).toEqual({
      ariaLabel: `Generated Audio Size 878 KB; Exact Size ${exactLabel}`,
      detailLabel: "Exact Size",
      exactLabel,
      visibleLabel: "878 KB",
    })
  })

  it("handles singular exact bytes", () => {
    expect(buildGeneratedAudioSizeDisplay(1)).toMatchObject({
      ariaLabel: "Generated Audio Size 1 B; Exact Size 1 byte",
      exactLabel: "1 byte",
      visibleLabel: "1 B",
    })
  })
})
