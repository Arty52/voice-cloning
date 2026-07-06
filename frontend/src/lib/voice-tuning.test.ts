import { describe, expect, it } from "vitest"

import type { ProviderTuningMetadata, UserTuningPreset, VoiceAsset } from "@/types"

import {
  CUSTOM_TUNING_PRESET_ID,
  isTuningControlValueOffNominal,
  resolveEffectiveVoiceTuning,
  resolveNominalTuningValue,
  resolveSavedVoiceTuning,
  resolveVoiceTuningState,
  tuningControlValuesEqual,
  userPresetValues,
} from "./voice-tuning"

const providerTuning: ProviderTuningMetadata = {
  controls: [
    {
      defaultValue: 0.5,
      description: "Controls stability.",
      id: "stability",
      label: "Stability",
      max: 1,
      min: 0,
      step: 0.01,
      type: "slider",
    },
    {
      defaultValue: 1,
      description: "Controls speed.",
      id: "speed",
      label: "Speed",
      max: 2,
      min: 0.5,
      step: 0.01,
      type: "slider",
    },
  ],
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

  it("resolves effective voice tuning from saved settings before presets and defaults", () => {
    expect(
      resolveEffectiveVoiceTuning({
        activeProviderId: "elevenlabs",
        providerTuning,
        voice: voiceAsset({
          voicePresetId: "animatedDialogue",
          voiceSettingsByProvider: {
            elevenlabs: { speed: 0.92, stability: 0.33 },
          },
        }),
      })
    ).toEqual({ speed: 0.92, stability: 0.33 })

    expect(
      resolveEffectiveVoiceTuning({
        activeProviderId: "elevenlabs",
        providerTuning,
        voice: voiceAsset({ voicePresetId: "animatedDialogue" }),
      })
    ).toEqual({ speed: 1.1, stability: 0.7 })

    expect(
      resolveEffectiveVoiceTuning({
        activeProviderId: "elevenlabs",
        providerTuning,
        voice: voiceAsset({ voicePresetId: "standardNarration" }),
      })
    ).toEqual({ speed: 1, stability: 0.4 })
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

  it("filters user presets to provider controls while preserving provider defaults", () => {
    const preset = userPreset({
      settings: {
        stability: 0.8,
        unsupported: "ignored",
      },
    })

    expect(userPresetValues(providerTuning, preset)).toEqual({
      speed: 1,
      stability: 0.8,
    })
  })

  it("resolves nominal values from provider defaults before control defaults", () => {
    expect(resolveNominalTuningValue(providerTuning.controls[0], { stability: 0.42 })).toBe(0.42)
    expect(resolveNominalTuningValue(providerTuning.controls[0], {})).toBe(0.5)
  })

  it("normalizes slider values when comparing tuning controls", () => {
    expect(tuningControlValuesEqual(providerTuning.controls[0], "0.5", 0.5)).toBe(true)
    expect(tuningControlValuesEqual(providerTuning.controls[0], "0.51", 0.5)).toBe(false)
  })

  it("detects off-nominal tuning values against provider defaults", () => {
    expect(isTuningControlValueOffNominal(providerTuning.controls[0], 0.42, { stability: 0.42 })).toBe(false)
    expect(isTuningControlValueOffNominal(providerTuning.controls[0], 0.5, { stability: 0.42 })).toBe(true)
  })
})

function userPreset(overrides: Partial<UserTuningPreset> = {}): UserTuningPreset {
  return {
    createdAt: "2026-07-01T12:00:00.000Z",
    id: "warm-read",
    name: "Warm Read",
    providerId: "elevenlabs",
    settings: { stability: 0.8 },
    updatedAt: "2026-07-01T12:00:00.000Z",
    voicePresetId: "standardNarration",
    ...overrides,
  }
}

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
