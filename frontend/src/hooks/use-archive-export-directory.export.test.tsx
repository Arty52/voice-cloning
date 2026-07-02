import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BrowserArchiveExportLedgerEntry } from "@/lib/generated-audio-export-ledger"
import type { BrowserArchiveExportTargetRecord } from "@/lib/generated-audio-export-target"
import type { GeneratedResult } from "@/types"

import { useArchiveExportDirectory } from "./use-archive-export-directory"

const exportMocks = vi.hoisted(() => {
  return {
    calls: [] as string[],
    clearLedger: vi.fn(),
    ensurePermission: vi.fn(),
    exportToDirectory: vi.fn(),
    forgetDirectory: vi.fn(),
    listLedger: vi.fn(),
    PermissionError: class MockBrowserArchiveExportPermissionError extends Error {},
    queryPermission: vi.fn(),
    readDirectory: vi.fn(),
    saveLedger: vi.fn(),
    selectDirectory: vi.fn(),
    UnsupportedError: class MockBrowserArchiveExportUnsupportedError extends Error {},
  }
})

vi.mock("@/lib/generated-audio-export-target", () => ({
  BrowserArchiveExportPermissionError: exportMocks.PermissionError,
  BrowserArchiveExportUnsupportedError: exportMocks.UnsupportedError,
  ensureBrowserArchiveExportPermission: exportMocks.ensurePermission,
  exportGeneratedAudioToBrowserDirectory: exportMocks.exportToDirectory,
  forgetBrowserArchiveExportDirectory: exportMocks.forgetDirectory,
  isBrowserArchiveExportSelectionCanceled: () => false,
  isBrowserArchiveExportSupported: () => true,
  queryBrowserArchiveExportPermission: exportMocks.queryPermission,
  readBrowserArchiveExportDirectory: exportMocks.readDirectory,
  selectBrowserArchiveExportDirectory: exportMocks.selectDirectory,
}))

vi.mock("@/lib/generated-audio-export-ledger", () => ({
  clearBrowserArchiveExportLedgerForTarget: exportMocks.clearLedger,
  listBrowserArchiveExportLedger: exportMocks.listLedger,
  saveBrowserArchiveExportLedgerEntry: exportMocks.saveLedger,
}))

describe("useArchiveExportDirectory exports", () => {
  beforeEach(() => {
    exportMocks.calls.length = 0
    vi.resetAllMocks()
    const target = browserTarget()
    exportMocks.readDirectory.mockResolvedValue(target)
    exportMocks.queryPermission.mockResolvedValue("prompt")
    exportMocks.listLedger.mockResolvedValue([])
    exportMocks.ensurePermission.mockImplementation(async () => {
      exportMocks.calls.push("permission")
      return "granted"
    })
    exportMocks.exportToDirectory.mockImplementation(async () => {
      exportMocks.calls.push("export")
      return {
        alreadyExported: false,
        exportedAt: "2026-07-01T18:45:22.000Z",
        filename: "generated-audio/2026/07/exported.mp3",
        indexFilename: "index/generated-audio.jsonl",
        sha256: "computed-sha",
        sidecarFilename: "generated-audio/2026/07/exported.json",
      }
    })
    exportMocks.saveLedger.mockImplementation(
      async (entry: Omit<BrowserArchiveExportLedgerEntry, "key">): Promise<BrowserArchiveExportLedgerEntry> => ({
        ...entry,
        key: `${entry.targetHandleId}:${entry.audioId}:${entry.sha256 ?? "legacy-null"}`,
      })
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        exportMocks.calls.push("fetch")
        return {
          blob: async () => new Blob(["audio"], { type: "audio/mpeg" }),
          ok: true,
        }
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("requests folder permission before fetching audio for export", async () => {
    const item = generatedItem({ sha256: null })
    const { result } = renderHook(() => useArchiveExportDirectory([item]))

    await waitFor(() => {
      expect(result.current.browserExportTarget).not.toBeNull()
    })

    await act(async () => {
      await result.current.exportGeneratedAudioItemToBrowserDirectory(item)
    })

    expect(exportMocks.calls).toEqual(["permission", "fetch", "export"])
    expect(exportMocks.exportToDirectory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "audio-id" }),
      expect.any(Blob),
      { permissionGranted: true }
    )
    expect(exportMocks.saveLedger).toHaveBeenCalledWith(expect.objectContaining({ sha256: "computed-sha" }))
  })
})

function browserTarget(): BrowserArchiveExportTargetRecord {
  return {
    handle: {} as BrowserArchiveExportTargetRecord["handle"],
    handleId: "handle-1",
    id: "selected-browser-directory",
    name: "Exports",
    selectedAt: "2026-07-01T18:45:22.000Z",
    updatedAt: "2026-07-01T18:45:22.000Z",
  }
}

function generatedItem(overrides: Partial<GeneratedResult> = {}): GeneratedResult {
  return {
    appVoiceId: "default",
    cacheState: "miss",
    characterCount: 12,
    contentType: "audio/mpeg",
    createdAt: "2026-07-01T18:45:22.000Z",
    generatedAt: "2026-07-01T18:45:22.000Z",
    generationElapsedMs: 1234,
    id: "audio-id",
    modelId: "eleven_multilingual_v2",
    multiVoiceMetadata: null,
    requestId: "req_123",
    sha256: "stored-sha",
    sizeBytes: 5,
    tuningMetadata: null,
    url: "/api/generated-audio/audio-id/audio",
    voiceId: "provider-voice",
    voiceName: "Default Voice",
    ...overrides,
  }
}
