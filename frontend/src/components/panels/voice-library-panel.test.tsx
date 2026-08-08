import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { PlaybackControllerProvider } from "@/hooks/use-playback-controller"
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
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

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

  it("resets voice tuning sliders to provider default values", async () => {
    const user = userEvent.setup()

    renderVoiceLibraryPanel({
      providerTuning: {
        ...providerTuning,
        defaultValues: { stability: 0.42 },
      },
      voices: [
        {
          ...selectedVoice,
          voiceSettingsByProvider: {
            elevenlabs: { stability: 0.4 },
          },
        },
      ],
    })

    await user.click(screen.getByRole("button", { name: "Show Voice Tuning" }))

    expect(screen.getByRole("slider", { name: "Stability" })).toHaveClass("accent-modified")
    expect(screen.getByRole("button", { name: "Reset Stability To Nominal" })).toBeEnabled()

    await user.click(screen.getByRole("button", { name: "Reset Stability To Nominal" }))

    expect(screen.getByRole("slider", { name: "Stability" })).toHaveValue("0.42")
    expect(screen.getByRole("button", { name: "Reset Stability To Nominal" })).toBeDisabled()
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

    fireEvent.change(screen.getByLabelText("Stability"), { target: { value: "0.6" } })
    expect(screen.getByRole("button", { name: "Update Preset" })).toBeInTheDocument()
    expect(onUserTuningPresetClear).toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Update Preset" }))
    expect(updatePreset).toHaveBeenCalledWith("warm-read", {
      name: "Warm Read",
      providerId: "elevenlabs",
      settings: { stability: 0.6 },
      voicePresetId: "standardNarration",
    })

    await user.click(screen.getByRole("button", { name: "Delete Preset" }))
    expect(deletePreset).toHaveBeenCalledWith("warm-read")
    expect(onUserTuningPresetClear).toHaveBeenCalled()
  })

  it("saves applied user preset values as voice tuning defaults", async () => {
    const user = userEvent.setup()
    const warmPreset = userPreset({ id: "warm-read", name: "Warm Read", settings: { stability: 0.8 } })
    const onSaveVoiceTuningRequest = vi.fn()

    renderVoiceLibraryPanel({
      onSaveVoiceTuningRequest,
      providerTuning,
      selectedUserTuningPreset: warmPreset,
      userTuningPresets: userTuningPresetState({ presets: [warmPreset] }),
    })

    await user.click(screen.getByRole("button", { name: "Show Voice Tuning" }))
    await user.click(screen.getByRole("button", { name: "Save Voice Tuning" }))

    expect(onSaveVoiceTuningRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "elevenlabs",
        shouldSaveVoiceSettings: true,
        voiceSettings: { stability: 0.8 },
      })
    )
  })

  it("disables user preset mutations while presets are loading", async () => {
    const user = userEvent.setup()
    const createPreset = vi.fn().mockResolvedValue(null)

    renderVoiceLibraryPanel({
      providerTuning,
      userTuningPresets: userTuningPresetState({ createPreset, status: "loading" }),
    })

    await user.click(screen.getByRole("button", { name: "Show Voice Tuning" }))

    expect(screen.getByPlaceholderText("Preset name")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save As Preset" })).toBeDisabled()
  })

  it("plays from an action menu without selecting the voice and closes the menu", async () => {
    const user = userEvent.setup()
    const otherVoice = { ...selectedVoice, id: "other", name: "Other Voice" }
    const onSelectVoice = vi.fn()

    renderVoiceLibraryPanel({ onSelectVoice, selectedVoiceId: selectedVoice.id, voices: [selectedVoice, otherVoice] })

    await user.click(screen.getByRole("button", { name: "Open actions for Other Voice" }))
    await user.click(screen.getByRole("menuitem", { name: "Play" }))

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(onSelectVoice).not.toHaveBeenCalled()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(document.querySelector("audio")?.src).toContain("/api/voices/other/sample")
  })

  it("switches the shared preview source from the selected detail controls", async () => {
    const user = userEvent.setup()
    const otherVoice = { ...selectedVoice, id: "other", name: "Other Voice" }

    renderVoiceLibraryPanel({ selectedVoiceId: selectedVoice.id, voices: [selectedVoice, otherVoice] })
    await user.click(screen.getByRole("button", { name: "Open actions for Other Voice" }))
    await user.click(screen.getByRole("menuitem", { name: "Play" }))
    await user.click(screen.getByRole("button", { name: "Play Audio" }))

    expect(document.querySelector("audio")?.src).toContain("/api/voices/default/sample")
  })

  it("clears a deleted voice preview", async () => {
    const { rerender } = renderVoiceLibraryPanel()
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared audio element.")
    }

    fireEvent.click(screen.getByRole("button", { name: "Play Audio" }))
    expect(audio.src).toContain("/api/voices/default/sample")

    rerender(
      <PlaybackControllerProvider>
        <TooltipProvider>
          <VoiceLibraryPanel {...voiceLibraryProps({ selectedVoiceId: "", voices: [] })} />
        </TooltipProvider>
      </PlaybackControllerProvider>
    )
    await waitFor(() => expect(audio.getAttribute("src")).toBeNull())
  })

  it("clears the owned preview when navigating away or unmounting", async () => {
    const { rerender, unmount } = renderVoiceLibraryPanel()
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared audio element.")
    }

    fireEvent.click(screen.getByRole("button", { name: "Play Audio" }))
    rerender(
      <PlaybackControllerProvider>
        <TooltipProvider>
          <VoiceLibraryPanel {...voiceLibraryProps({ isActive: false })} />
        </TooltipProvider>
      </PlaybackControllerProvider>
    )
    await waitFor(() => expect(audio.getAttribute("src")).toBeNull())

    rerender(
      <PlaybackControllerProvider>
        <TooltipProvider>
          <VoiceLibraryPanel {...voiceLibraryProps()} />
        </TooltipProvider>
      </PlaybackControllerProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Play Audio" }))
    unmount()
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  })

  it("exposes a failed preview source through the selected detail controls", async () => {
    renderVoiceLibraryPanel()
    const audio = document.querySelector("audio")
    if (!audio) {
      throw new Error("Expected the shared audio element.")
    }

    fireEvent.click(screen.getByRole("button", { name: "Play Audio" }))
    fireEvent.error(audio)

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load this audio.")
  })

  it("reports an unavailable preview without making a media request", async () => {
    const user = userEvent.setup()
    const unavailableVoice = { ...selectedVoice, id: "   ", name: "Unavailable Voice" }

    renderVoiceLibraryPanel({ selectedVoiceId: unavailableVoice.id, voices: [unavailableVoice] })

    expect(screen.getByRole("status")).toHaveTextContent("Preview unavailable for this voice.")
    await user.click(screen.getByRole("button", { name: "Open actions for Unavailable Voice" }))
    expect(screen.getByRole("menuitem", { name: "Play" })).toBeDisabled()
    expect(document.querySelector("audio")?.getAttribute("src")).toBeNull()
  })
})

type VoiceLibraryPanelProps = ComponentProps<typeof VoiceLibraryPanel>

function renderVoiceLibraryPanel(overrides: Partial<VoiceLibraryPanelProps> = {}) {
  const props = voiceLibraryProps(overrides)

  return render(
    <PlaybackControllerProvider>
      <TooltipProvider>
        <VoiceLibraryPanel {...props} />
      </TooltipProvider>
    </PlaybackControllerProvider>
  )
}

function voiceLibraryProps(overrides: Partial<VoiceLibraryPanelProps> = {}): VoiceLibraryPanelProps {
  return {
    activeProviderId: "elevenlabs",
    defaultVoiceId: "default",
    isActive: true,
    isGenerating: false,
    isProviderTuningLoading: false,
    isSettingDefault: false,
    isUpdatingVoice: false,
    onDeleteRequest: vi.fn(),
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
