import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { GeneratedAudioMetadata } from "./generated-audio-metadata"

describe("GeneratedAudioMetadata", () => {
  it("shows user tuning preset provenance when a snapshot is present", () => {
    render(
      <GeneratedAudioMetadata
        generationElapsedMs={1234}
        tuningMetadata={{
          adjustedSettings: [],
          mode: "userPreset",
          presetId: "warm-read",
          presetLabel: "Warm Read",
          providerId: "elevenlabs",
          providerLabel: "ElevenLabs",
          userPreset: {
            id: "warm-read",
            name: "Warm Read",
            providerId: "elevenlabs",
            settings: { stability: 0.42 },
            voicePresetId: "standardNarration",
          },
        }}
      />
    )

    expect(screen.getByText("User Preset: Warm Read")).toBeInTheDocument()
    expect(screen.getByText("Default Settings")).toBeInTheDocument()
  })

  it("shows multi-voice custom settings in a popover instead of inline setting badges", async () => {
    render(
      <GeneratedAudioMetadata
        generationElapsedMs={14_000}
        multiVoiceMetadata={{
          jobId: "job-1",
          resultSha256: "combined-hash",
          segmentCount: 3,
          segments: [],
          tuningSummaries: [
            {
              adjustedSettings: [
                adjustedSetting("stability", "Stability", "0.5", "0.4"),
                adjustedSetting("style", "Style", "0", "0.35"),
                adjustedSetting("speed", "Speed", "1", "1.04"),
              ],
              id: "voice-a:settings",
              voiceId: "voice-a",
              voiceName: "voice_a",
            },
            {
              adjustedSettings: [adjustedSetting("stability", "Stability", "0.5", "0.2")],
              id: "voice-b:settings",
              voiceId: "voice-b",
              voiceName: "voice_b",
            },
            {
              adjustedSettings: [
                adjustedSetting("style", "Style", "0", "0.32"),
                adjustedSetting("speed", "Speed", "1", "1.02"),
              ],
              id: "voice-c:settings",
              voiceId: "voice-c",
              voiceName: "voice_c",
            },
          ],
          voices: [],
        }}
        tuningMetadata={{
          adjustedSettings: [
            adjustedSetting("stability", "Stability", "0.5", "0.4"),
            adjustedSetting("style", "Style", "0", "0.35"),
            adjustedSetting("speed", "Speed", "1", "1.04"),
          ],
          mode: "custom",
          presetId: null,
          presetLabel: null,
          providerId: "elevenlabs",
          providerLabel: "ElevenLabs",
        }}
      />
    )

    expect(screen.getAllByText("Custom Settings")).toHaveLength(1)
    expect(screen.queryByText("Stability 0.4")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Show Multi-Voice Custom Settings" }))

    expect(await screen.findByText("voice_a")).toBeInTheDocument()
    expect(screen.getByText("Stability 0.4")).toBeInTheDocument()
    expect(screen.getByText("Style 0.35")).toBeInTheDocument()
    expect(screen.getByText("Speed 1.04")).toBeInTheDocument()
    expect(screen.getByText("voice_b")).toBeInTheDocument()
    expect(screen.getByText("Stability 0.2")).toBeInTheDocument()
    expect(screen.getByText("voice_c")).toBeInTheDocument()
    expect(screen.getByText("Style 0.32")).toBeInTheDocument()
    expect(screen.getByText("Speed 1.02")).toBeInTheDocument()
  })

  it("shows multi-voice custom settings for preset jobs with per-voice overrides", async () => {
    render(
      <GeneratedAudioMetadata
        generationElapsedMs={14_000}
        multiVoiceMetadata={{
          jobId: "job-1",
          resultSha256: "combined-hash",
          segmentCount: 3,
          segments: [],
          tuningSummaries: [
            {
              adjustedSettings: [adjustedSetting("stability", "Stability", "0.5", "0.2")],
              id: "voice-b:settings",
              voiceId: "voice-b",
              voiceName: "voice_b",
            },
          ],
          voices: [],
        }}
        tuningMetadata={{
          adjustedSettings: [adjustedSetting("style", "Style", "0", "0.35")],
          mode: "preset",
          presetId: "animated-dialogue",
          presetLabel: "Animated Dialogue",
          providerId: "elevenlabs",
          providerLabel: "ElevenLabs",
        }}
      />
    )

    expect(screen.getByText("Preset: Animated Dialogue")).toBeInTheDocument()
    expect(screen.getAllByText("Custom Settings")).toHaveLength(1)
    expect(screen.queryByText("Stability 0.2")).not.toBeInTheDocument()
    expect(screen.queryByText("Style 0.35")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Show Multi-Voice Custom Settings" }))

    expect(await screen.findByText("voice_b")).toBeInTheDocument()
    expect(screen.getByText("Stability 0.2")).toBeInTheDocument()
  })
})

function adjustedSetting(id: string, label: string, nominalValueLabel: string, valueLabel: string) {
  return {
    id,
    label,
    nominalValue: nominalValueLabel,
    nominalValueLabel,
    value: valueLabel,
    valueLabel,
  }
}
