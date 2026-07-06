import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import { DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES } from "@/lib/generated-audio-storage"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { GeneratedAudioScriptSnapshot, GeneratedResult } from "@/types"

import { GeneratedAudioPanel } from "./generated-audio-panel"

describe("GeneratedAudioPanel pending mutations", () => {
  it("renders archive mutations with the pending work surface", () => {
    renderGeneratedAudioPanel({ mutationStatus: "clear" })

    const status = screen.getByRole("status", { name: "Clearing Audio" })
    const surface = status.closest(".pending-work-status")

    expect(status).toHaveTextContent("Updating")
    expect(status).toHaveTextContent("Removing saved generated audio from the browser archive.")
    expect(surface).toHaveClass("pending-work-status")
    expect(surface?.querySelector(".pending-work-status__shine")).toBeInTheDocument()
  })

  it("renders configured server export controls without path input", async () => {
    const user = userEvent.setup()
    const onServerExportAll = vi.fn()
    const onServerExportStatusRefresh = vi.fn()

    renderGeneratedAudioPanel({
      allItems: [generatedAudioItem],
      items: [generatedAudioItem],
      onServerExportAll,
      onServerExportStatusRefresh,
      persistenceMode: "server",
      serverExportStatus: {
        available: true,
        items: [],
        targetId: "local-filesystem",
      },
    })

    expect(screen.getByText("Configured")).toBeInTheDocument()
    expect(screen.queryByText(/saves to the server archive on generation/i)).not.toBeInTheDocument()
    await user.hover(screen.getByRole("button", { name: "Server Export Timing" }))
    expect(await screen.findAllByText(/use export to mirror or retry the server export folder/i)).not.toHaveLength(0)
    expect(screen.queryByLabelText(/path/i)).not.toBeInTheDocument()

    const serverExportControls = within(screen.getByRole("group", { name: "Server Export" }))

    await user.click(serverExportControls.getByRole("button", { name: "Export All" }))
    await user.click(serverExportControls.getByRole("button", { name: "Refresh" }))

    expect(onServerExportAll).toHaveBeenCalledTimes(1)
    expect(onServerExportStatusRefresh).toHaveBeenCalledTimes(1)
  })

  it("disables server export controls when the backend target is not configured", async () => {
    const user = userEvent.setup()
    renderGeneratedAudioPanel({
      allItems: [generatedAudioItem],
      items: [generatedAudioItem],
      persistenceMode: "server",
      serverExportStatus: {
        available: false,
        items: [],
        targetId: null,
      },
    })

    expect(screen.getByText("Not Configured")).toBeInTheDocument()
    expect(screen.queryByText(/configure the server export directory to mirror it/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Export All" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /open generated audio actions for default voice/i }))
    expect(screen.getByRole("menuitem", { name: "Export" })).toHaveAttribute("aria-disabled", "true")
  })

  it("disables server export controls during archive mutations", async () => {
    const user = userEvent.setup()
    renderGeneratedAudioPanel({
      allItems: [generatedAudioItem],
      items: [generatedAudioItem],
      mutationStatus: "clear",
      persistenceMode: "server",
      serverExportStatus: {
        available: true,
        items: [],
        targetId: "local-filesystem",
      },
    })

    const serverExportControls = within(screen.getByRole("group", { name: "Server Export" }))

    expect(serverExportControls.getByRole("button", { name: "Refresh" })).toBeDisabled()
    expect(serverExportControls.getByRole("button", { name: "Export All" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /open generated audio actions for default voice/i }))
    expect(screen.getByRole("menuitem", { name: "Export" })).toHaveAttribute("aria-disabled", "true")
  })

  it("shows per-item server export status and retry action", async () => {
    const user = userEvent.setup()
    const onServerExport = vi.fn()

    renderGeneratedAudioPanel({
      allItems: [generatedAudioItem],
      items: [generatedAudioItem],
      onServerExport,
      persistenceMode: "server",
      serverExportStatus: {
        available: true,
        items: [
          {
            audioId: "generated-audio",
            exportedAt: null,
            filename: "generated-audio/2026/07/generated-audio.mp3",
            lastError: "Disk full.",
            sha256: "sha-123",
            status: "failed",
            targetId: "local-filesystem",
            updatedAt: "2026-07-01T18:45:22.000Z",
          },
        ],
        targetId: "local-filesystem",
      },
    })

    expect(screen.getByText("Export Failed")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /open generated audio actions for default voice/i }))
    await user.click(screen.getByRole("menuitem", { name: "Retry Export" }))
    expect(onServerExport).toHaveBeenCalledWith("generated-audio")
  })

  it("renders browser export folder controls without backend path input", async () => {
    const user = userEvent.setup()
    const onBrowserExport = vi.fn()
    const onBrowserExportAll = vi.fn()
    const onBrowserExportFolderSelect = vi.fn()

    renderGeneratedAudioPanel({
      allItems: [generatedAudioItem],
      browserExportPermission: "granted",
      browserExportSupported: true,
      browserExportTarget: browserTarget,
      items: [generatedAudioItem],
      onBrowserExport,
      onBrowserExportAll,
      onBrowserExportFolderSelect,
    })

    expect(screen.getByText("Ready")).toBeInTheDocument()
    expect(screen.getByText(/Exports: 0 mirrored/i)).toBeInTheDocument()
    expect(screen.queryByText(/New generated audio is not written here automatically/i)).not.toBeInTheDocument()
    await user.hover(screen.getByRole("button", { name: "Browser Export Folder Timing" }))
    expect(await screen.findAllByText(/use Mirror All or Browser Export to copy it/i)).not.toHaveLength(0)
    expect(screen.queryByLabelText(/path/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Mirror All" }))
    await user.click(screen.getByRole("button", { name: /open generated audio actions for default voice/i }))
    await user.click(screen.getByRole("menuitem", { name: "Browser Export" }))

    expect(onBrowserExportAll).toHaveBeenCalledTimes(1)
    expect(onBrowserExport).toHaveBeenCalledWith(generatedAudioItem)
    expect(onBrowserExportFolderSelect).not.toHaveBeenCalled()
  })

  it("shows browser export retry state from the local ledger", async () => {
    const user = userEvent.setup()
    const onBrowserExport = vi.fn()

    renderGeneratedAudioPanel({
      allItems: [generatedAudioItem],
      browserExportLedger: [
        {
          audioId: "generated-audio",
          exportedAt: null,
          filename: "generated-audio/2026/07/generated-audio.mp3",
          key: "handle-1:generated-audio:sha-123",
          lastError: "Permission denied.",
          sha256: "sha-123",
          status: "failed",
          targetHandleId: "handle-1",
          updatedAt: "2026-07-01T18:45:22.000Z",
        },
      ],
      browserExportPermission: "granted",
      browserExportSupported: true,
      browserExportTarget: browserTarget,
      items: [generatedAudioItem],
      onBrowserExport,
    })

    expect(screen.getByText("Browser Export Failed")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /open generated audio actions for default voice/i }))
    await user.click(screen.getByRole("menuitem", { name: "Retry Browser Export" }))
    expect(onBrowserExport).toHaveBeenCalledWith(generatedAudioItem)
  })

  it("threads script snapshot view and restore actions for archive items", async () => {
    const user = userEvent.setup()
    const onViewScriptSnapshot = vi.fn()
    const onRestoreScriptSnapshot = vi.fn()
    const itemWithSnapshot = { ...generatedAudioItem, scriptSnapshot: rangeSnapshot }

    renderGeneratedAudioPanel({
      allItems: [itemWithSnapshot],
      items: [itemWithSnapshot],
      onRestoreScriptSnapshot,
      onViewScriptSnapshot,
    })

    await user.click(screen.getByRole("button", { name: /open generated audio actions for default voice/i }))
    await user.click(screen.getByRole("menuitem", { name: "View Text" }))
    await user.click(screen.getByRole("button", { name: /open generated audio actions for default voice/i }))
    await user.click(screen.getByRole("menuitem", { name: "Use Text" }))

    expect(onViewScriptSnapshot).toHaveBeenCalledWith(itemWithSnapshot)
    expect(onRestoreScriptSnapshot).toHaveBeenCalledWith(itemWithSnapshot)
  })

  it("keeps one custom settings popover open across archive items", async () => {
    renderGeneratedAudioPanel({
      allItems: [
        generatedAudioItemWithFirstCustomSettings,
        generatedAudioItemWithSecondCustomSettings,
        generatedAudioItemWithThirdCustomSettings,
      ],
      items: [
        generatedAudioItemWithFirstCustomSettings,
        generatedAudioItemWithSecondCustomSettings,
        generatedAudioItemWithThirdCustomSettings,
      ],
    })

    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "Show Multi-Voice Custom Settings" })[0])

    expect(await screen.findByText("voice_a")).toBeInTheDocument()
    expect(screen.queryByText("voice_b")).not.toBeInTheDocument()

    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "Show Multi-Voice Custom Settings" })[1])

    expect(await screen.findByText("voice_b")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("voice_a")).not.toBeInTheDocument()
    })

    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "Show Multi-Voice Custom Settings" })[2])

    expect(await screen.findByText("voice_c")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("voice_b")).not.toBeInTheDocument()
    })
  })

  it("keeps one custom settings popover open across repeated archive presses", async () => {
    const user = userEvent.setup()
    renderGeneratedAudioPanel({
      allItems: [
        generatedAudioItemWithFirstCustomSettings,
        generatedAudioItemWithSecondCustomSettings,
        generatedAudioItemWithThirdCustomSettings,
      ],
      items: [
        generatedAudioItemWithFirstCustomSettings,
        generatedAudioItemWithSecondCustomSettings,
        generatedAudioItemWithThirdCustomSettings,
      ],
    })

    await user.click(screen.getAllByRole("button", { name: "Show Multi-Voice Custom Settings" })[0])

    expect(await screen.findByText("voice_a")).toBeInTheDocument()
    expect(screen.queryByText("voice_b")).not.toBeInTheDocument()
    expect(screen.queryByText("voice_c")).not.toBeInTheDocument()

    await user.click(screen.getAllByRole("button", { name: "Show Multi-Voice Custom Settings" })[1])

    expect(await screen.findByText("voice_b")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("voice_a")).not.toBeInTheDocument()
    })

    await user.click(screen.getAllByRole("button", { name: "Show Multi-Voice Custom Settings" })[2])

    expect(await screen.findByText("voice_c")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("voice_b")).not.toBeInTheDocument()
    })
  })

  it("keeps one custom settings popover open across direct archive pointer presses", async () => {
    renderGeneratedAudioPanel({
      allItems: [
        generatedAudioItemWithFirstCustomSettings,
        generatedAudioItemWithSecondCustomSettings,
        generatedAudioItemWithThirdCustomSettings,
      ],
      items: [
        generatedAudioItemWithFirstCustomSettings,
        generatedAudioItemWithSecondCustomSettings,
        generatedAudioItemWithThirdCustomSettings,
      ],
    })

    const triggers = screen.getAllByRole("button", { name: "Show Multi-Voice Custom Settings" })

    fireEvent.pointerDown(triggers[0])

    expect(await screen.findByText("voice_a")).toBeInTheDocument()

    fireEvent.pointerUp(triggers[0])
    fireEvent.click(triggers[0])

    expect(screen.getByText("voice_a")).toBeInTheDocument()

    fireEvent.pointerDown(triggers[1])

    expect(await screen.findByText("voice_b")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("voice_a")).not.toBeInTheDocument()
    })

    fireEvent.pointerUp(triggers[1])
    fireEvent.click(triggers[1])

    expect(screen.getByText("voice_b")).toBeInTheDocument()

    fireEvent.pointerDown(triggers[2])

    expect(await screen.findByText("voice_c")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("voice_b")).not.toBeInTheDocument()
    })

    fireEvent.pointerUp(triggers[2])
    fireEvent.click(triggers[2])

    expect(screen.getByText("voice_c")).toBeInTheDocument()
  })
})

const generatedAudioItem: GeneratedResult = {
  appVoiceId: "default",
  cacheState: "miss",
  characterCount: 54,
  contentType: "audio/mpeg",
  createdAt: "2026-07-01T18:45:22.000Z",
  generatedAt: "Jul 1, 2026",
  generationElapsedMs: 1234,
  id: "generated-audio",
  modelId: "eleven_multilingual_v2",
  multiVoiceMetadata: null,
  requestId: "req-test",
  sha256: "sha-123",
  sizeBytes: 123456,
  tuningMetadata: null,
  scriptSnapshot: null,
  url: "blob:generated-audio",
  voiceId: "voice-123",
  voiceName: "Default Voice",
}

const generatedAudioItemWithFirstCustomSettings: GeneratedResult = buildGeneratedAudioItemWithCustomSettings({
  id: "generated-audio-one",
  settingId: "stability",
  settingLabel: "Stability",
  valueLabel: "0.4",
  voiceName: "Multi-Voice One",
  summaryVoiceName: "voice_a",
})

const generatedAudioItemWithSecondCustomSettings: GeneratedResult = buildGeneratedAudioItemWithCustomSettings({
  id: "generated-audio-two",
  settingId: "style",
  settingLabel: "Style",
  valueLabel: "0.35",
  voiceName: "Multi-Voice Two",
  summaryVoiceName: "voice_b",
})

const generatedAudioItemWithThirdCustomSettings: GeneratedResult = buildGeneratedAudioItemWithCustomSettings({
  id: "generated-audio-three",
  settingId: "speed",
  settingLabel: "Speed",
  valueLabel: "1.04",
  voiceName: "Multi-Voice Three",
  summaryVoiceName: "voice_c",
})

const rangeSnapshot: GeneratedAudioScriptSnapshot = {
  version: 1,
  mode: "range",
  text: "Narrator starts. Villain replies.",
  sourceVoiceId: "default",
  assignments: [],
  dialogueBlocks: [],
  speakerMappings: [],
  segmentGapMs: null,
}

const browserTarget = {
  handle: {} as never,
  handleId: "handle-1",
  id: "selected-browser-directory",
  name: "Exports",
  selectedAt: "2026-07-01T18:45:22.000Z",
  updatedAt: "2026-07-01T18:45:22.000Z",
}

type RenderGeneratedAudioPanelProps = Partial<ComponentProps<typeof GeneratedAudioPanel>>

function renderGeneratedAudioPanel(overrides: RenderGeneratedAudioPanelProps = {}) {
  const props: ComponentProps<typeof GeneratedAudioPanel> = {
    allItems: [],
    browserExportError: null,
    browserExportLedger: [],
    browserExportMutation: null,
    browserExportPermission: null,
    browserExportSupported: false,
    browserExportTarget: null,
    items: [],
    libraryStatus: "success",
    mutationStatus: null,
    onBrowserExport: vi.fn(),
    onBrowserExportAll: vi.fn(),
    onBrowserExportFolderForget: vi.fn(),
    onBrowserExportFolderRefresh: vi.fn(),
    onBrowserExportFolderSelect: vi.fn(),
    onClear: vi.fn(),
    onDelete: vi.fn(),
    onServerExport: vi.fn(),
    onServerExportAll: vi.fn(),
    onServerExportStatusRefresh: vi.fn(),
    onStorageLimitChange: vi.fn(),
    persistenceMode: "browser",
    serverExportError: null,
    serverExportMutation: null,
    serverExportStatus: null,
    storageError: null,
    storageLimitBytes: DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
    usage: null,
    ...overrides,
  }
  return render(
    <TooltipProvider>
      <GeneratedAudioPanel {...props} />
    </TooltipProvider>
  )
}

type BuildGeneratedAudioItemWithCustomSettingsInput = {
  id: string
  settingId: string
  settingLabel: string
  summaryVoiceName: string
  valueLabel: string
  voiceName: string
}

function buildGeneratedAudioItemWithCustomSettings({
  id,
  settingId,
  settingLabel,
  summaryVoiceName,
  valueLabel,
  voiceName,
}: BuildGeneratedAudioItemWithCustomSettingsInput): GeneratedResult {
  const adjustedSetting = buildAdjustedSetting(settingId, settingLabel, valueLabel)

  return {
    ...generatedAudioItem,
    appVoiceId: `${id}-app-voice`,
    cacheState: "multi-voice",
    id,
    multiVoiceMetadata: {
      jobId: `${id}-job`,
      resultSha256: `${id}-hash`,
      segmentCount: 1,
      segments: [],
      tuningSummaries: [
        {
          adjustedSettings: [adjustedSetting],
          id: `${id}:settings`,
          voiceId: `${id}-voice`,
          voiceName: summaryVoiceName,
        },
      ],
      voices: [],
    },
    sha256: `${id}-hash`,
    tuningMetadata: {
      adjustedSettings: [adjustedSetting],
      mode: "custom",
      presetId: null,
      presetLabel: null,
      providerId: "elevenlabs",
      providerLabel: "ElevenLabs",
    },
    voiceId: `${id}-voice`,
    voiceName,
  }
}

function buildAdjustedSetting(id: string, label: string, valueLabel: string) {
  const nominalValueLabel = id === "style" ? "0" : id === "speed" ? "1" : "0.5"
  return {
    id,
    label,
    nominalValue: nominalValueLabel,
    nominalValueLabel,
    value: valueLabel,
    valueLabel,
  }
}
