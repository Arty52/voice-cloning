import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { ProviderTuningControl } from "@/types"

import { VoiceTuningControls } from "./voice-tuning-controls"

const stabilityControl: ProviderTuningControl = {
  defaultValue: 0.5,
  description: "Controls stability.",
  id: "stability",
  label: "Stability",
  max: 1,
  min: 0,
  step: 0.01,
  type: "slider",
}

const similarityControl: ProviderTuningControl = {
  defaultValue: 0.75,
  description: "Controls similarity.",
  id: "similarityBoost",
  label: "Similarity",
  max: 1,
  min: 0,
  step: 0.01,
  type: "slider",
}

const speakerBoostControl: ProviderTuningControl = {
  defaultValue: true,
  description: "Boosts speaker similarity.",
  id: "useSpeakerBoost",
  label: "Speaker Boost",
  type: "toggle",
}

describe("VoiceTuningControls", () => {
  it("marks only off-nominal sliders with the modified accent", () => {
    render(
      <VoiceTuningControls
        controls={[stabilityControl, similarityControl]}
        disabled={false}
        idPrefix="voice-tuning"
        nominalValues={{ similarityBoost: 0.75, stability: 0.5 }}
        onTuningValueChange={vi.fn()}
        tuning={{ similarityBoost: 0.75, stability: 0.4 }}
      />
    )

    expect(screen.getByRole("slider", { name: "Stability" })).toHaveClass("accent-modified")
    expect(screen.getByRole("slider", { name: "Stability" })).not.toHaveClass("accent-primary")
    expect(screen.getByRole("slider", { name: "Similarity" })).toHaveClass("accent-primary")
    expect(screen.getByRole("slider", { name: "Similarity" })).not.toHaveClass("accent-modified")
  })

  it("enables reset only for off-nominal sliders", () => {
    render(
      <VoiceTuningControls
        controls={[stabilityControl, similarityControl, speakerBoostControl]}
        disabled={false}
        idPrefix="voice-tuning"
        nominalValues={{ similarityBoost: 0.75, stability: 0.5, useSpeakerBoost: true }}
        onTuningValueChange={vi.fn()}
        tuning={{ similarityBoost: 0.75, stability: 0.4, useSpeakerBoost: false }}
      />
    )

    expect(screen.getByRole("button", { name: "Reset Stability To Nominal" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Reset Similarity To Nominal" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Reset Speaker Boost To Nominal" })).not.toBeInTheDocument()
  })

  it("resets a slider to the provider nominal value", async () => {
    const user = userEvent.setup()
    const onTuningValueChange = vi.fn()

    render(
      <VoiceTuningControls
        controls={[stabilityControl]}
        disabled={false}
        idPrefix="voice-tuning"
        nominalValues={{ stability: 0.42 }}
        onTuningValueChange={onTuningValueChange}
        tuning={{ stability: 0.4 }}
      />
    )

    await user.click(screen.getByRole("button", { name: "Reset Stability To Nominal" }))

    expect(onTuningValueChange).toHaveBeenCalledWith(stabilityControl, 0.42)
  })

  it("uses provider nominal values as displayed slider fallbacks", () => {
    render(
      <VoiceTuningControls
        controls={[stabilityControl]}
        disabled={false}
        idPrefix="voice-tuning"
        nominalValues={{ stability: 0.42 }}
        onTuningValueChange={vi.fn()}
        tuning={{}}
      />
    )

    expect(screen.getByRole("slider", { name: "Stability" })).toHaveValue("0.42")
    expect(screen.getByRole("button", { name: "Reset Stability To Nominal" })).toBeDisabled()
  })
})
