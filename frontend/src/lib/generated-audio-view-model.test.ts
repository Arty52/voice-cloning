import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { storedAudioToResult } from "./generated-audio-view-model"
import type { StoredGeneratedAudio } from "./generated-audio-storage"

const baseRecord: StoredGeneratedAudio = {
  appVoiceId: "default",
  blob: new Blob(["sample"], { type: "audio/mpeg" }),
  cacheState: "miss",
  characterCount: 54,
  contentType: "audio/mpeg",
  createdAt: "2026-05-28T10:01:00.000Z",
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
  })

  it("normalizes legacy records without tuning metadata", () => {
    const result = storedAudioToResult(baseRecord)

    expect(result.tuningMetadata).toBeNull()
  })
})
