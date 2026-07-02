import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GENERATED_AUDIO_DB_NAME } from "./generated-audio-storage"
import {
  clearBrowserArchiveExportLedgerForTarget,
  getBrowserArchiveExportLedgerEntry,
  listBrowserArchiveExportLedger,
  saveBrowserArchiveExportLedgerEntry,
} from "./generated-audio-export-ledger"

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    request.onblocked = () => reject(new Error(`Unable to delete ${name}; database is blocked.`))
  })
}

describe("browser generated audio export ledger", () => {
  beforeEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
  })

  afterEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
  })

  it("records export status by target, audio id, and sha256", async () => {
    await saveBrowserArchiveExportLedgerEntry({
      audioId: "audio-1",
      exportedAt: "2026-07-01T18:45:22.000Z",
      filename: "generated-audio/2026/07/audio-1.mp3",
      lastError: null,
      sha256: "sha-1",
      status: "exported",
      targetHandleId: "target-1",
      updatedAt: "2026-07-01T18:45:22.000Z",
    })

    await expect(getBrowserArchiveExportLedgerEntry("target-1", "audio-1", "sha-1")).resolves.toMatchObject({
      audioId: "audio-1",
      key: "target-1:audio-1:sha-1",
      status: "exported",
    })
    await expect(listBrowserArchiveExportLedger("target-1")).resolves.toHaveLength(1)
    await expect(listBrowserArchiveExportLedger("target-2")).resolves.toHaveLength(0)
  })

  it("clears only entries for the selected target", async () => {
    await saveBrowserArchiveExportLedgerEntry({
      audioId: "audio-1",
      exportedAt: null,
      filename: "generated-audio/2026/07/audio-1.mp3",
      lastError: "Failed.",
      sha256: null,
      status: "failed",
      targetHandleId: "target-1",
      updatedAt: "2026-07-01T18:45:22.000Z",
    })
    await saveBrowserArchiveExportLedgerEntry({
      audioId: "audio-1",
      exportedAt: "2026-07-01T18:45:23.000Z",
      filename: "generated-audio/2026/07/audio-1.mp3",
      lastError: null,
      sha256: null,
      status: "exported",
      targetHandleId: "target-2",
      updatedAt: "2026-07-01T18:45:23.000Z",
    })

    await clearBrowserArchiveExportLedgerForTarget("target-1")

    await expect(listBrowserArchiveExportLedger("target-1")).resolves.toHaveLength(0)
    await expect(listBrowserArchiveExportLedger("target-2")).resolves.toHaveLength(1)
  })
})
