import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GENERATED_AUDIO_DB_NAME } from "@/lib/generated-audio-storage"

import { useArchiveExportDirectory } from "./use-archive-export-directory"

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    request.onblocked = () => reject(new Error(`Unable to delete ${name}; database is blocked.`))
  })
}

describe("useArchiveExportDirectory", () => {
  beforeEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
  })

  it("treats canceled folder selection as a neutral action", async () => {
    vi.stubGlobal(
      "showDirectoryPicker",
      vi.fn().mockRejectedValue(new DOMException("The user aborted a request.", "AbortError"))
    )
    const { result } = renderHook(() => useArchiveExportDirectory([]))

    await act(async () => {
      await result.current.selectBrowserExportDirectory()
    })

    expect(result.current.browserExportError).toBeNull()
    expect(result.current.browserExportMutation).toBeNull()
  })

  it("still reports unsupported browser folder selection", async () => {
    vi.stubGlobal("showDirectoryPicker", undefined)
    const { result } = renderHook(() => useArchiveExportDirectory([]))

    await act(async () => {
      await result.current.selectBrowserExportDirectory()
    })

    await waitFor(() => {
      expect(result.current.browserExportError).toBe("Browser folder export is not supported in this browser.")
    })
    expect(result.current.browserExportMutation).toBeNull()
  })
})
