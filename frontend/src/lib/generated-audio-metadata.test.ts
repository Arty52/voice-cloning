import { describe, expect, it } from "vitest"

import { buildGeneratedAudioMultiVoiceMetadata, buildGeneratedAudioTuningMetadata } from "./generated-audio-metadata"
import type { SpeechJob, VoiceProvider } from "@/types"

const NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
})

const provider = {
  id: "test-provider",
  label: "Test Provider",
  docsUrl: "https://example.test/docs",
  links: [],
  manageKeyUrl: "https://example.test/key",
  sample: {
    maxSourceUploadBytes: 1024 * 1024 * 1024,
    maxUploadBytes: 10 * 1024 * 1024,
    maxWindowSeconds: 120,
    recommendedMaxSeconds: 120,
    recommendedMinSeconds: 60,
    targetSampleRateHz: 16000,
  },
  serverKeyConfigured: true,
  tuning: {
    controls: [
      {
        defaultValue: 0.5,
        description: "Controls how stable the generated voice sounds.",
        id: "stability",
        label: "Stability",
        max: 1,
        min: 0,
        step: 0.01,
        type: "slider" as const,
      },
      {
        defaultValue: "balanced",
        description: "Selects the generation mode.",
        id: "mode",
        label: "Mode",
        options: [
          { label: "Balanced", value: "balanced" },
          { label: "Expressive", value: "expressive" },
        ],
        type: "select" as const,
      },
      {
        defaultValue: true,
        description: "Enhances speaker similarity.",
        id: "enhanced",
        label: "Enhanced",
        type: "toggle" as const,
      },
    ],
    defaultValues: {
      enhanced: true,
      mode: "balanced",
      stability: 0.5,
    },
    presets: [
      {
        description: "Balanced default settings.",
        id: "standard",
        label: "Standard Narration",
        values: {
          enhanced: true,
          mode: "balanced",
          stability: 0.5,
        },
      },
      {
        description: "More expressive settings.",
        id: "expressive",
        label: "Expressive Dialogue",
        values: {
          enhanced: false,
          mode: "expressive",
          stability: 0.425,
        },
      },
    ],
  },
} satisfies VoiceProvider

describe("buildGeneratedAudioTuningMetadata", () => {
  it("returns null when provider metadata is unavailable", () => {
    expect(buildGeneratedAudioTuningMetadata({ provider: null, selectedPresetId: "custom", tuning: {} })).toBeNull()
  })

  it("builds provider metadata for providers without controls", () => {
    const metadata = buildGeneratedAudioTuningMetadata({
      provider: {
        ...provider,
        id: "plain-provider",
        label: "Plain Provider",
        tuning: { controls: [], defaultValues: {}, presets: [] },
      },
      selectedPresetId: "custom",
      tuning: {},
    })

    expect(metadata).toEqual({
      adjustedSettings: [],
      mode: "default",
      presetId: null,
      presetLabel: null,
      providerId: "plain-provider",
      providerLabel: "Plain Provider",
    })
  })

  it("captures the selected preset when preset values match nominal settings", () => {
    expect(
      buildGeneratedAudioTuningMetadata({
        provider,
        selectedPresetId: "standard",
        tuning: provider.tuning.presets[0].values,
      })
    ).toMatchObject({
      adjustedSettings: [],
      mode: "preset",
      presetId: "standard",
      presetLabel: "Standard Narration",
      providerId: "test-provider",
      providerLabel: "Test Provider",
    })
  })

  it("captures preset settings that differ from provider defaults", () => {
    expect(
      buildGeneratedAudioTuningMetadata({
        provider,
        selectedPresetId: "expressive",
        tuning: provider.tuning.presets[1].values,
      })
    ).toMatchObject({
      adjustedSettings: [
        {
          id: "stability",
          label: "Stability",
          nominalValue: 0.5,
          nominalValueLabel: formatNumberLabel(0.5),
          value: 0.425,
          valueLabel: formatNumberLabel(0.425),
        },
        {
          id: "mode",
          label: "Mode",
          nominalValue: "balanced",
          nominalValueLabel: "Balanced",
          value: "expressive",
          valueLabel: "Expressive",
        },
        {
          id: "enhanced",
          label: "Enhanced",
          nominalValue: true,
          nominalValueLabel: "On",
          value: false,
          valueLabel: "Off",
        },
      ],
      mode: "preset",
      presetId: "expressive",
      presetLabel: "Expressive Dialogue",
    })
  })

  it("marks manual off-nominal tuning as custom", () => {
    expect(
      buildGeneratedAudioTuningMetadata({
        provider,
        selectedPresetId: "custom",
        tuning: {
          enhanced: true,
          mode: "balanced",
          stability: 0.4,
        },
      })
    ).toMatchObject({
      adjustedSettings: [
        {
          id: "stability",
          label: "Stability",
          nominalValueLabel: formatNumberLabel(0.5),
          valueLabel: formatNumberLabel(0.4),
        },
      ],
      mode: "custom",
      presetId: null,
      presetLabel: null,
    })
  })

  it("uses default mode when no selected preset or setting differs from nominal", () => {
    expect(
      buildGeneratedAudioTuningMetadata({
        provider,
        selectedPresetId: "custom",
        tuning: {
          enhanced: true,
          mode: "balanced",
          stability: 0.5,
        },
      })
    ).toMatchObject({
      adjustedSettings: [],
      mode: "default",
      presetId: null,
      presetLabel: null,
    })
  })

  it("does not mark stringly typed defaults as adjusted when submitted values are equivalent", () => {
    const stringlyProvider: VoiceProvider = {
      ...provider,
      tuning: {
        controls: [
          {
            defaultValue: "0.5",
            description: "Controls how stable the generated voice sounds.",
            id: "stability",
            label: "Stability",
            type: "slider",
          },
          {
            defaultValue: "false",
            description: "Enhances speaker similarity.",
            id: "enhanced",
            label: "Enhanced",
            type: "toggle",
          },
          {
            defaultValue: 2,
            description: "Selects the generation mode.",
            id: "mode",
            label: "Mode",
            options: [
              { label: "One", value: 1 },
              { label: "Two", value: 2 },
            ],
            type: "select",
          },
        ],
        defaultValues: {
          enhanced: "false",
          mode: 2,
          stability: "0.5",
        },
        presets: [],
      },
    }

    expect(
      buildGeneratedAudioTuningMetadata({
        provider: stringlyProvider,
        selectedPresetId: "custom",
        tuning: {
          enhanced: false,
          mode: "2",
          stability: 0.5,
        },
      })
    ).toMatchObject({
      adjustedSettings: [],
      mode: "default",
    })
  })
})

describe("buildGeneratedAudioMultiVoiceMetadata", () => {
  it("summarizes speech job segments and voices", () => {
    const job: SpeechJob = {
      activeSegmentId: null,
      createdAt: "2026-06-23T00:00:00.000Z",
      defaultVoiceId: "narrator",
      error: null,
      id: "job-1",
      resultSha256: "combined-hash",
      segmentGapMs: 250,
      segments: [
        {
          assignmentKind: "assigned",
          cacheState: "miss",
          characterCount: 12,
          error: null,
          generationCount: 1,
          id: "segment-one",
          index: 0,
          requestId: "request-one",
          resultSha256: "segment-one-hash",
          status: "success",
          text: "Hello.",
          voiceId: "narrator",
          voiceName: "Narrator",
          voiceSettings: { stability: 0.42 },
        },
        {
          assignmentKind: "default",
          cacheState: "hit",
          characterCount: 8,
          error: null,
          generationCount: 2,
          id: "segment-two",
          index: 1,
          requestId: "request-two",
          resultSha256: "segment-two-hash",
          status: "success",
          text: "Hi.",
          voiceId: "narrator",
          voiceName: "Narrator",
          voiceSettings: { stability: 0.42 },
        },
        {
          assignmentKind: "assigned",
          cacheState: "miss",
          characterCount: 5,
          error: null,
          generationCount: 1,
          id: "segment-three",
          index: 2,
          requestId: "request-three",
          resultSha256: "segment-three-hash",
          status: "success",
          text: "Bye.",
          voiceId: "villain",
          voiceName: "Villain",
          voiceSettings: { speed: 1.2 },
        },
      ],
      status: "success",
      text: "Hello.Hi.Bye.",
      updatedAt: "2026-06-23T00:00:01.000Z",
    }

    expect(buildGeneratedAudioMultiVoiceMetadata(job)).toEqual({
      jobId: "job-1",
      resultSha256: "combined-hash",
      segmentCount: 3,
      segments: [
        {
          assignmentKind: "assigned",
          characterCount: 12,
          generationCount: 1,
          id: "segment-one",
          index: 0,
          resultSha256: "segment-one-hash",
          text: "Hello.",
          voiceId: "narrator",
          voiceName: "Narrator",
          voiceSettings: { stability: 0.42 },
        },
        {
          assignmentKind: "default",
          characterCount: 8,
          generationCount: 2,
          id: "segment-two",
          index: 1,
          resultSha256: "segment-two-hash",
          text: "Hi.",
          voiceId: "narrator",
          voiceName: "Narrator",
          voiceSettings: { stability: 0.42 },
        },
        {
          assignmentKind: "assigned",
          characterCount: 5,
          generationCount: 1,
          id: "segment-three",
          index: 2,
          resultSha256: "segment-three-hash",
          text: "Bye.",
          voiceId: "villain",
          voiceName: "Villain",
          voiceSettings: { speed: 1.2 },
        },
      ],
      voices: [
        { segmentCount: 2, voiceId: "narrator", voiceName: "Narrator" },
        { segmentCount: 1, voiceId: "villain", voiceName: "Villain" },
      ],
    })
  })
})

function formatNumberLabel(value: number) {
  return NUMBER_FORMATTER.format(value)
}
