import { afterEach, describe, expect, it, vi } from "vitest"

import {
  GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY,
  markGeneratedAudioArchiveImported,
  readGeneratedAudioArchiveMigrationState,
} from "./generated-audio-archive-migration"

describe("generated audio archive migration state", () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("returns empty state when localStorage reads are blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError")
    })

    const state = readGeneratedAudioArchiveMigrationState()

    expect(state.clearedIds.size).toBe(0)
    expect(state.conflictIds.size).toBe(0)
    expect(state.importedIds.size).toBe(0)
  })

  it("does not throw when localStorage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError")
    })

    expect(() => markGeneratedAudioArchiveImported(["audio-one"])).not.toThrow()
    expect(localStorage.getItem(GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY)).toBeNull()
  })
})
