import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import { DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES } from "@/lib/generated-audio-storage"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { GeneratedResult } from "@/types"

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

    await user.click(screen.getByRole("button", { name: "Export All" }))
    await user.click(screen.getAllByRole("button", { name: "Refresh" })[0])

    expect(onServerExportAll).toHaveBeenCalledTimes(1)
    expect(onServerExportStatusRefresh).toHaveBeenCalledTimes(1)
  })

  it("disables server export controls when the backend target is not configured", () => {
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
    expect(screen.getByRole("button", { name: /export generated audio for default voice/i })).toBeDisabled()
  })

  it("disables server export controls during archive mutations", () => {
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

    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Export All" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /export generated audio for default voice/i })).toBeDisabled()
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
    await user.click(screen.getByRole("button", { name: /retry export generated audio for default voice/i }))
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
    expect(screen.getByText(/New generated audio is not written here automatically/i)).toBeInTheDocument()
    expect(screen.getByText(/use Mirror All or Browser Export to copy it/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/path/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Mirror All" }))
    await user.click(screen.getByRole("button", { name: /browser export generated audio for default voice/i }))

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
    await user.click(screen.getByRole("button", { name: /retry browser export generated audio for default voice/i }))
    expect(onBrowserExport).toHaveBeenCalledWith(generatedAudioItem)
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
  url: "blob:generated-audio",
  voiceId: "voice-123",
  voiceName: "Default Voice",
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
