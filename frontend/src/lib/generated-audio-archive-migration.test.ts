import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY,
  markGeneratedAudioArchiveCleared,
  markGeneratedAudioArchiveImported,
  readGeneratedAudioArchiveMigrationState,
} from "./generated-audio-archive-migration"
import { GENERATED_AUDIO_DB_NAME } from "./generated-audio-storage"

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    request.onblocked = () => reject(new Error(`Unable to delete ${name}; database is blocked.`))
  })
}

describe("generated audio archive migration state", () => {
  beforeEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
    localStorage.clear()
  })

  afterEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("returns empty state when localStorage reads are blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError")
    })

    const state = await readGeneratedAudioArchiveMigrationState()

    expect(state.clearedIds.size).toBe(0)
    expect(state.conflictIds.size).toBe(0)
    expect(state.importedIds.size).toBe(0)
  })

  it("stores migration ids in IndexedDB", async () => {
    await markGeneratedAudioArchiveImported(["audio-one"])
    await markGeneratedAudioArchiveCleared(["audio-two"])

    const state = await readGeneratedAudioArchiveMigrationState()

    expect(state.importedIds.has("audio-one")).toBe(true)
    expect(state.clearedIds.has("audio-two")).toBe(true)
    expect(localStorage.getItem(GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY)).toBeNull()
  })

  it("imports legacy localStorage ids once", async () => {
    localStorage.setItem(GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY, JSON.stringify(["legacy-audio"]))

    expect((await readGeneratedAudioArchiveMigrationState()).importedIds.has("legacy-audio")).toBe(true)
    localStorage.setItem(GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY, JSON.stringify(["new-local-only"]))

    expect((await readGeneratedAudioArchiveMigrationState()).importedIds.has("new-local-only")).toBe(false)
  })
})
