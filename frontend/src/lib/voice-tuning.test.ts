import { describe, expect, it } from "vitest"

import type { ProviderTuningMetadata, VoiceAsset } from "@/types"

import { CUSTOM_TUNING_PRESET_ID, resolveSavedVoiceTuning, resolveVoiceTuningState } from "./voice-tuning"

const providerTuning: ProviderTuningMetadata = {
  controls: [],
  defaultValues: { speed: 1, stability: 0.5 },
  presets: [
    {
      description: "Narration",
      id: "narration",
      label: "Narration",
      values: { stability: 0.4 },
      voicePresetId: "standardNarration",
    },
    {
      description: "Dialogue",
      id: "dialogue",
      label: "Dialogue",
      values: { speed: 1.1, stability: 0.7 },
      voicePresetId: "animatedDialogue",
    },
  ],
}

describe("voice tuning resolution", () => {
  it("uses saved provider tuning as custom values before preset-derived values", () => {
    const voice = voiceAsset({
      voicePresetId: "animatedDialogue",
      voiceSettingsByProvider: {
        elevenlabs: { speed: 0.92, stability: 0.33 },
      },
    })

    expect(resolveVoiceTuningState({ activeProviderId: "elevenlabs", providerTuning, voice })).toEqual({
      selectedPresetId: CUSTOM_TUNING_PRESET_ID,
      values: { speed: 0.92, stability: 0.33 },
    })
  })

  it("falls back to preset tuning when no saved tuning exists for the active provider", () => {
    const voice = voiceAsset({
      voicePresetId: "animatedDialogue",
      voiceSettingsByProvider: {
        otherProvider: { speed: 0.92, stability: 0.33 },
      },
    })

    expect(resolveVoiceTuningState({ activeProviderId: "elevenlabs", providerTuning, voice })).toEqual({
      selectedPresetId: "dialogue",
      values: { speed: 1.1, stability: 0.7 },
    })
  })

  it("returns null saved tuning without an active provider", () => {
    const voice = voiceAsset({
      voiceSettingsByProvider: {
        elevenlabs: { speed: 0.92 },
      },
    })

    expect(resolveSavedVoiceTuning(null, voice)).toBeNull()
    expect(resolveSavedVoiceTuning("elevenlabs", voice)).toEqual({ speed: 0.92 })
  })
})

function voiceAsset(overrides: Partial<VoiceAsset> = {}): VoiceAsset {
  return {
    contentType: "audio/mpeg",
    createdAt: "2026-06-23T00:00:00.000Z",
    filePath: "voice.mp3",
    id: "voice",
    name: "Voice",
    processingSteps: [],
    sampleMode: "excerpt",
    sha256: "voice-hash",
    source: "upload",
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
