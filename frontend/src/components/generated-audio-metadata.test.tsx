import { render, screen } from "@testing-library/react"
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
})
