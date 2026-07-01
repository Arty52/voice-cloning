import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { ProviderTuningMetadata, UserTuningPreset, VoiceAsset, VoicePreset } from "@/types"

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
  defaultValues: { stability: 0.5 },
  presets: [
    {
      description: "A warmer provider preset.",
      id: "warm-provider",
      label: "Warm Provider",
      values: { stability: 0.7 },
      voicePresetId: "standardNarration",
    },
  ],
}

describe("VoiceLibraryPanel voice tuning", () => {
  it("renders expanded tuning loading with the pending work surface", async () => {
    const user = userEvent.setup()

    renderVoiceLibraryPanel({
      isProviderTuningLoading: true,
      providerTuning: emptyProviderTuning,
    })

    await user.click(screen.getByRole("button", { name: "Show Voice Tuning" }))

    const status = screen.getByRole("status", { name: "Loading Voice Tuning" })
    const surface = status.closest(".pending-work-status")

    expect(status).toHaveTextContent("Fetching provider tuning controls for this voice.")
    expect(surface).toHaveClass("pending-work-status")
    expect(surface?.querySelector(".pending-work-status__shine")).toBeInTheDocument()
  })

  it("saves the active tuning draft as a user preset", async () => {
    const user = userEvent.setup()
    const createdPreset = userPreset({ id: "warm-read", name: "Warm Read", settings: { stability: 0.7 } })
    const createPreset = vi.fn().mockResolvedValue(createdPreset)
    const onUserTuningPresetApply = vi.fn()

    renderVoiceLibraryPanel({
      onUserTuningPresetApply,
      providerTuning,
      userTuningPresets: userTuningPresetState({ createPreset }),
    })

    await user.click(screen.getByRole("button", { name: "Show Voice Tuning" }))
    await user.click(screen.getByRole("button", { name: /Warm Provider/ }))
    await user.type(screen.getByLabelText("New user tuning preset name"), "Warm Read")
    await user.click(screen.getByRole("button", { name: "Save As Preset" }))

    expect(createPreset).toHaveBeenCalledWith({
      name: "Warm Read",
      providerId: "elevenlabs",
      settings: { stability: 0.7 },
      voicePresetId: "standardNarration",
    })
    expect(onUserTuningPresetApply).toHaveBeenCalledWith(createdPreset)
  })

  it("applies, updates, and deletes saved user presets", async () => {
    const user = userEvent.setup()
    const warmPreset = userPreset({ id: "warm-read", name: "Warm Read", settings: { stability: 0.8 } })
    const updatePreset = vi.fn().mockResolvedValue(userPreset({ ...warmPreset, settings: { stability: 0.8 } }))
    const deletePreset = vi.fn().mockResolvedValue(undefined)
    const onUserTuningPresetApply = vi.fn()
    const onUserTuningPresetClear = vi.fn()

    renderVoiceLibraryPanel({
      onUserTuningPresetApply,
      onUserTuningPresetClear,
      providerTuning,
      selectedUserTuningPreset: warmPreset,
      userTuningPresets: userTuningPresetState({
        deletePreset,
        presets: [warmPreset],
        updatePreset,
      }),
    })

    await user.click(screen.getByRole("button", { name: "Show Voice Tuning" }))
    await user.click(screen.getByRole("button", { name: "Apply Preset" }))

    expect(onUserTuningPresetApply).toHaveBeenCalledWith(warmPreset)
    expect(screen.getByLabelText("Stability")).toHaveValue("0.8")

    await user.click(screen.getByRole("button", { name: "Update Preset" }))
    expect(updatePreset).toHaveBeenCalledWith("warm-read", {
      name: "Warm Read",
      providerId: "elevenlabs",
      settings: { stability: 0.8 },
      voicePresetId: "standardNarration",
    })

    await user.click(screen.getByRole("button", { name: "Delete Preset" }))
    expect(deletePreset).toHaveBeenCalledWith("warm-read")
    expect(onUserTuningPresetClear).toHaveBeenCalled()
  })
})

type VoiceLibraryPanelProps = ComponentProps<typeof VoiceLibraryPanel>

function renderVoiceLibraryPanel(overrides: Partial<VoiceLibraryPanelProps> = {}) {
  const props: VoiceLibraryPanelProps = {
    activeProviderId: "elevenlabs",
    defaultVoiceId: "default",
    isGenerating: false,
    isProviderTuningLoading: false,
    isSettingDefault: false,
    isUpdatingVoice: false,
    onDeleteRequest: vi.fn(),
    onPlayVoice: vi.fn(),
    onRenameRequest: vi.fn(),
    onSaveVoiceTuningRequest: vi.fn(),
    onSelectVoice: vi.fn(),
    onSetDefault: vi.fn(),
    onUserTuningPresetApply: vi.fn(),
    onUserTuningPresetClear: vi.fn(),
    providerTuning,
    selectedUserTuningPreset: null,
    selectedVoiceId: "default",
    userTuningPresets: userTuningPresetState(),
    voiceError: null,
    voicePresets,
    voices: [selectedVoice],
    voiceStatus: "success",
    ...overrides,
  }

  return render(
    <TooltipProvider>
      <VoiceLibraryPanel {...props} />
    </TooltipProvider>
  )
}

function userTuningPresetState(
  overrides: Partial<VoiceLibraryPanelProps["userTuningPresets"]> = {}
): VoiceLibraryPanelProps["userTuningPresets"] {
  return {
    createPreset: vi.fn().mockResolvedValue(null),
    deletePreset: vi.fn().mockResolvedValue(undefined),
    error: null,
    presets: [],
    status: "success",
    updatePreset: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

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
