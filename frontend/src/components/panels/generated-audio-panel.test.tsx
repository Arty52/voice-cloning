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
    expect(screen.queryByLabelText(/path/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Export All" }))
    await user.click(screen.getByRole("button", { name: "Refresh" }))

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

type RenderGeneratedAudioPanelProps = Partial<ComponentProps<typeof GeneratedAudioPanel>>

function renderGeneratedAudioPanel(overrides: RenderGeneratedAudioPanelProps = {}) {
  const props: ComponentProps<typeof GeneratedAudioPanel> = {
    allItems: [],
    items: [],
    libraryStatus: "success",
    mutationStatus: null,
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
