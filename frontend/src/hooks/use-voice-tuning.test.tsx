import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { ProviderTuningMetadata, VoiceAsset } from "@/types"

import { useVoiceTuning } from "./use-voice-tuning"

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
  ],
  defaultValues: { stability: 0.5, speed: 1 },
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
      values: { stability: 0.8 },
      voicePresetId: "animatedDialogue",
    },
  ],
}

describe("useVoiceTuning", () => {
  it("activates saved provider tuning as custom state for the selected voice", () => {
    const selectedVoice = voiceAsset({
      voicePresetId: "animatedDialogue",
      voiceSettingsByProvider: {
        elevenlabs: { speed: 0.95, stability: 0.3 },
      },
    })

    const { result } = renderHook(() =>
      useVoiceTuning({
        activeProviderId: "elevenlabs",
        providerTuning,
        selectedVoice,
      })
    )

    expect(result.current.selectedTuningPresetId).toBe("custom")
    expect(result.current.tuning).toEqual({ speed: 0.95, stability: 0.3 })
  })

  it("keeps manual changes scoped to the selected provider voice tuning", () => {
    const selectedVoice = voiceAsset({
      voiceSettingsByProvider: {
        elevenlabs: { speed: 0.95, stability: 0.3 },
      },
    })
    const { result, rerender } = renderHook(
      ({ voice }: { voice: VoiceAsset }) =>
        useVoiceTuning({
          activeProviderId: "elevenlabs",
          providerTuning,
          selectedVoice: voice,
        }),
      { initialProps: { voice: selectedVoice } }
    )

    act(() => {
      result.current.handleTuningValueChange(providerTuning.controls[0], 0.72)
    })
    expect(result.current.tuning).toEqual({ speed: 0.95, stability: 0.72 })

    rerender({
      voice: {
        ...selectedVoice,
        voiceSettingsByProvider: {
          elevenlabs: { speed: 0.9, stability: 0.35 },
        },
      },
    })

    expect(result.current.tuning).toEqual({ speed: 0.9, stability: 0.35 })
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
