import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { ProviderTuningMetadata, VoiceAsset, VoicePreset } from "@/types"

import { VoiceLibraryPanel } from "./voice-library-panel"

const voicePresets: VoicePreset[] = [
  {
    description: "Balanced narration.",
    id: "standardNarration",
    label: "Standard Narration",
  },
]

const selectedVoice: VoiceAsset = {
  contentType: "audio/mpeg",
  createdAt: "2026-06-23T00:00:00.000Z",
  filePath: "default/default-voice.mp3",
  id: "default",
  name: "Default Voice",
  processingSteps: [],
  sampleMode: "excerpt",
  sha256: "default-hash",
  source: "default",
  sourceContentType: null,
  sourceFilePath: null,
  sourceSha256: null,
  voicePresetId: "standardNarration",
  voiceSettingsByProvider: {},
  windowDurationSeconds: null,
  windowStartSeconds: null,
}

const emptyProviderTuning: ProviderTuningMetadata = {
  controls: [],
  defaultValues: {},
  presets: [],
}

describe("VoiceLibraryPanel voice tuning", () => {
  it("renders expanded tuning loading with the pending work surface", async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <VoiceLibraryPanel
          activeProviderId="elevenlabs"
          defaultVoiceId="default"
          isGenerating={false}
          isProviderTuningLoading={true}
          isSettingDefault={false}
          isUpdatingVoice={false}
          onDeleteRequest={vi.fn()}
          onPlayVoice={vi.fn()}
          onRenameRequest={vi.fn()}
          onSaveVoiceTuningRequest={vi.fn()}
          onSelectVoice={vi.fn()}
          onSetDefault={vi.fn()}
          providerTuning={emptyProviderTuning}
          selectedVoiceId="default"
          voiceError={null}
          voicePresets={voicePresets}
          voices={[selectedVoice]}
          voiceStatus="success"
        />
      </TooltipProvider>
    )

    await user.click(screen.getByRole("button", { name: "Show Voice Tuning" }))

    const status = screen.getByRole("status", { name: "Loading Voice Tuning" })
    const surface = status.closest(".pending-work-status")

    expect(status).toHaveTextContent("Fetching provider tuning controls for this voice.")
    expect(surface).toHaveClass("pending-work-status")
    expect(surface?.querySelector(".pending-work-status__shine")).toBeInTheDocument()
  })
})
