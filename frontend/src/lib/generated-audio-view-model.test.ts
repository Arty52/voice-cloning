import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildGeneratedAudioSizeDisplay, storedAudioToResult } from "./generated-audio-view-model"
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
  sizeBytes: 6,
  voiceId: "voice-123",
  voiceName: "Default Voice",
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
  })

  it("normalizes legacy records without optional metadata", () => {
    const legacyRecord: Partial<StoredGeneratedAudio> = { ...baseRecord }
    delete legacyRecord.generationElapsedMs
    const result = storedAudioToResult(legacyRecord as StoredGeneratedAudio)

    expect(result.generationElapsedMs).toBeNull()
    expect(result.tuningMetadata).toBeNull()
  })
})

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
