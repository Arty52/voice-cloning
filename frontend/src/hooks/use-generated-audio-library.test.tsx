import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useGeneratedAudioLibrary, type GeneratedAudioMutation } from "./use-generated-audio-library"
import {
  BYTES_PER_MEBIBYTE,
  GENERATED_AUDIO_DB_NAME,
  clearGeneratedAudio,
  listGeneratedAudio,
  saveGeneratedAudio,
  type SaveGeneratedAudioInput,
} from "@/lib/generated-audio-storage"
import { readGeneratedAudioArchiveMigrationState } from "@/lib/generated-audio-archive-migration"
import type { AsyncStatus } from "@/types"

type Snapshot = {
  itemCount: number
  mutation: GeneratedAudioMutation | null
  status: AsyncStatus
}

type ArchiveItem = {
  appVoiceId: string
  audioUrl: string
  cacheState: string
  characterCount: number | null
  contentType: string
  createdAt: string
  generationElapsedMs: number | null
  id: string
  modelId: string
  multiVoiceMetadata: null
  providerId: string
  requestId: string | null
  sha256: string
  sizeBytes: number
  tuningMetadata: null
  voiceId: string
  voiceName: string
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    request.onblocked = () => reject(new Error(`Unable to delete ${name}; database is blocked.`))
  })
}

function audioInput(overrides: Partial<SaveGeneratedAudioInput> = {}): SaveGeneratedAudioInput {
  return {
    appVoiceId: "default",
    blob: new Blob(["sample"], { type: "audio/mpeg" }),
    cacheState: "miss",
    characterCount: 54,
    modelId: "eleven_multilingual_v2",
    requestId: "req_test_123",
    voiceId: "voice-123",
    voiceName: "Default Voice",
    ...overrides,
  }
}

function archiveItem(overrides: Partial<ArchiveItem> = {}): ArchiveItem {
  const id = overrides.id ?? "server-audio"
  return {
    appVoiceId: "default",
    audioUrl: `/api/generated-audio/${id}/audio`,
    cacheState: "miss",
    characterCount: 54,
    contentType: "audio/mpeg",
    createdAt: "2026-05-28T10:01:00.000Z",
    generationElapsedMs: 1234,
    id,
    modelId: "eleven_multilingual_v2",
    multiVoiceMetadata: null,
    providerId: "elevenlabs",
    requestId: "req_test_123",
    sha256: `${id}-hash`,
    sizeBytes: 6,
    tuningMetadata: null,
    voiceId: "voice-123",
    voiceName: "Default Voice",
    ...overrides,
  }
}

function GeneratedAudioHarness({ onSnapshot }: { onSnapshot: (snapshot: Snapshot) => void }) {
  const library = useGeneratedAudioLibrary()
  const firstItemId = library.generatedAudioItems[0]?.id ?? null

  onSnapshot({
    itemCount: library.generatedAudioItems.length,
    mutation: library.generatedAudioMutation,
    status: library.generatedAudioStatus,
  })

  return (
    <div>
      <div data-testid="status">{library.generatedAudioStatus}</div>
      <div data-testid="mutation">{library.generatedAudioMutation ?? "none"}</div>
      <div data-testid="error">{library.generatedAudioStorageError ?? ""}</div>
      <div data-testid="first-url">{library.generatedAudioItems[0]?.url ?? ""}</div>
      <div data-testid="item-count">{library.generatedAudioItems.length}</div>
      <button disabled={!firstItemId} onClick={() => firstItemId && void library.handleDeleteGeneratedAudio(firstItemId)}>
        Delete First
      </button>
      <button onClick={() => void library.clearAllGeneratedAudio()}>Clear All</button>
      <button onClick={() => void library.applyGeneratedAudioStorageLimit(4)}>Lower Limit</button>
      <button onClick={() => void library.persistGeneratedAudio(audioInput({ id: "new-server-audio" }), 20 * BYTES_PER_MEBIBYTE)}>
        Save New
      </button>
    </div>
  )
}

function mockArchiveUnavailable() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input).split("?")[0] === "/api/generated-audio") {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "Generated audio archive persistence is not configured." }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
  )
}

function mockArchive(initialItems: ArchiveItem[] = [], options: { conflictIds?: string[] } = {}) {
  const items = new Map(initialItems.map((item) => [item.id, item]))
  const conflictIds = new Set(options.conflictIds ?? [])
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0]
    if (path === "/api/generated-audio" && !init) {
      return okJson({ items: sortedArchiveItems(items), usage: archiveUsage(items) })
    }
    if (path === "/api/generated-audio" && init?.method === "POST") {
      const formData = init.body as FormData
      const id = String(formData.get("id") ?? "")
      if (conflictIds.has(id)) {
        return jsonResponse({ detail: "Generated audio id already exists with different content." }, 409)
      }
      const existing = items.get(id)
      if (existing) {
        return okJson({ alreadyExisted: true, item: existing, prunedIds: [], usage: archiveUsage(items) })
      }
      const audioFile = formData.get("audioFile")
      const item = archiveItem({
        appVoiceId: String(formData.get("appVoiceId") ?? "default"),
        cacheState: String(formData.get("cacheState") ?? "miss"),
        characterCount: Number(formData.get("characterCount") ?? 0),
        createdAt: String(formData.get("createdAt") ?? "2026-05-28T10:01:00.000Z"),
        id,
        modelId: String(formData.get("modelId") ?? "eleven_multilingual_v2"),
        requestId: String(formData.get("requestId") ?? "req_test_123"),
        sizeBytes: audioFile instanceof File ? audioFile.size : 6,
        voiceId: String(formData.get("voiceId") ?? "voice-123"),
        voiceName: String(formData.get("voiceName") ?? "Default Voice"),
      })
      items.set(id, item)
      return okJson({ alreadyExisted: false, item, prunedIds: [], usage: archiveUsage(items) })
    }
    if (path.startsWith("/api/generated-audio/") && init?.method === "DELETE") {
      const id = decodeURIComponent(path.replace("/api/generated-audio/", ""))
      items.delete(id)
      return okJson({ prunedIds: [id], usage: archiveUsage(items) })
    }
    if (path === "/api/generated-audio" && init?.method === "DELETE") {
      const prunedIds = [...items.keys()]
      items.clear()
      return okJson({ prunedIds, usage: archiveUsage(items) })
    }
    if (path === "/api/generated-audio/storage-limit" && init?.method === "PUT") {
      return okJson({ prunedIds: [], usage: archiveUsage(items, 4) })
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function okJson(payload: unknown) {
  return jsonResponse(payload, 200)
}

function jsonResponse(payload: unknown, status: number) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  )
}

function sortedArchiveItems(items: Map<string, ArchiveItem>) {
  return [...items.values()].sort((first, second) => second.createdAt.localeCompare(first.createdAt))
}

function archiveUsage(items: Map<string, ArchiveItem>, limitBytes = 100 * BYTES_PER_MEBIBYTE) {
  const usedBytes = [...items.values()].reduce((total, item) => total + item.sizeBytes, 0)
  return {
    itemCount: items.size,
    limitBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    usedBytes,
  }
}

describe("useGeneratedAudioLibrary", () => {
  beforeEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
    localStorage.clear()
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated-audio")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    mockArchiveUnavailable()
  })

  afterEach(async () => {
    await clearGeneratedAudio()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("reports initial browser storage loading before settling", async () => {
    const snapshots: Snapshot[] = []

    render(<GeneratedAudioHarness onSnapshot={(snapshot) => snapshots.push(snapshot)} />)

    expect(snapshots.map((snapshot) => snapshot.status)).toContain("idle")
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"))
    expect(snapshots.map((snapshot) => snapshot.status)).toContain("loading")
    expect(screen.getByTestId("mutation")).toHaveTextContent("none")
  })

  it("reports delete, clear, and storage-limit mutation states", async () => {
    const user = userEvent.setup()
    const snapshots: Snapshot[] = []
    await saveGeneratedAudio(audioInput({ id: "first" }), 20)
    render(<GeneratedAudioHarness onSnapshot={(snapshot) => snapshots.push(snapshot)} />)

    await waitFor(() => expect(screen.getByTestId("item-count")).toHaveTextContent("1"))
    await user.click(screen.getByRole("button", { name: /delete first/i }))
    await waitFor(() => expect(screen.getByTestId("mutation")).toHaveTextContent("none"))

    await act(async () => {
      await saveGeneratedAudio(audioInput({ id: "second" }), 20)
    })
    await user.click(screen.getByRole("button", { name: /clear all/i }))
    await waitFor(() => expect(screen.getByTestId("mutation")).toHaveTextContent("none"))

    await user.click(screen.getByRole("button", { name: /lower limit/i }))
    await waitFor(() => expect(screen.getByTestId("mutation")).toHaveTextContent("none"))

    expect(snapshots.map((snapshot) => snapshot.mutation)).toContain("delete")
    expect(snapshots.map((snapshot) => snapshot.mutation)).toContain("clear")
    expect(snapshots.map((snapshot) => snapshot.mutation)).toContain("storage-limit")
  })

  it("loads generated audio from the server archive when available", async () => {
    const snapshots: Snapshot[] = []
    mockArchive([archiveItem({ id: "server-audio" })])

    render(<GeneratedAudioHarness onSnapshot={(snapshot) => snapshots.push(snapshot)} />)

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"))
    expect(screen.getByTestId("item-count")).toHaveTextContent("1")
    expect(screen.getByTestId("first-url")).toHaveTextContent("/api/generated-audio/server-audio/audio")
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(snapshots.map((snapshot) => snapshot.status)).toContain("loading")
  })

  it("keeps the server archive available when IndexedDB migration cannot be read", async () => {
    const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new Error("IndexedDB blocked")
    })
    try {
      mockArchive([archiveItem({ id: "server-audio" })])

      render(<GeneratedAudioHarness onSnapshot={() => undefined} />)

      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"))
      expect(screen.getByTestId("item-count")).toHaveTextContent("1")
      expect(screen.getByTestId("first-url")).toHaveTextContent("/api/generated-audio/server-audio/audio")
      expect(screen.getByTestId("error")).toHaveTextContent("")
    } finally {
      openSpy.mockRestore()
    }
  })

  it("imports browser generated audio oldest first in server mode", async () => {
    await saveGeneratedAudio(
      audioInput({
        createdAt: "2026-05-28T10:00:00.000Z",
        id: "old-audio",
      }),
      20
    )
    await saveGeneratedAudio(
      audioInput({
        createdAt: "2026-05-28T10:01:00.000Z",
        id: "new-audio",
      }),
      20
    )
    const fetchMock = mockArchive()

    render(<GeneratedAudioHarness onSnapshot={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"))
    const postedIds = fetchMock.mock.calls
      .filter(([input, init]) => String(input) === "/api/generated-audio" && init?.method === "POST")
      .map(([, init]) => String((init?.body as FormData).get("id")))
    expect(postedIds).toEqual(["old-audio", "new-audio"])
  })

  it("saves new generated audio to the server archive in server mode", async () => {
    const user = userEvent.setup()
    const fetchMock = mockArchive()

    render(<GeneratedAudioHarness onSnapshot={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"))
    await user.click(screen.getByRole("button", { name: /save new/i }))
    await waitFor(() => expect(screen.getByTestId("item-count")).toHaveTextContent("1"))

    const saveCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/generated-audio" && init?.method === "POST"
    )
    expect(saveCall).toBeDefined()
    expect(screen.getByTestId("first-url")).toHaveTextContent("/api/generated-audio/new-server-audio/audio")
  })

  it("keeps successful server archive saves when local migration bookkeeping fails", async () => {
    const user = userEvent.setup()
    const fetchMock = mockArchive()

    render(<GeneratedAudioHarness onSnapshot={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"))
    const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new Error("IndexedDB blocked")
    })
    try {
      await user.click(screen.getByRole("button", { name: /save new/i }))
      await waitFor(() => expect(screen.getByTestId("item-count")).toHaveTextContent("1"))

      const saveCall = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === "/api/generated-audio" && init?.method === "POST"
      )
      expect(saveCall).toBeDefined()
      expect(screen.getByTestId("first-url")).toHaveTextContent("/api/generated-audio/new-server-audio/audio")
      expect(screen.getByTestId("error")).toHaveTextContent("")
    } finally {
      openSpy.mockRestore()
    }
  })

  it("reports IndexedDB migration conflicts without deleting browser data", async () => {
    await saveGeneratedAudio(audioInput({ id: "conflicting-audio" }), 20)
    expect((await listGeneratedAudio()).map((record) => record.id)).toContain("conflicting-audio")
    mockArchive([], { conflictIds: ["conflicting-audio"] })

    render(<GeneratedAudioHarness onSnapshot={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"))
    expect(screen.getByTestId("error")).toHaveTextContent("1 browser audio item(s) conflicted")
    expect((await readGeneratedAudioArchiveMigrationState()).conflictIds.has("conflicting-audio")).toBe(true)
    expect((await listGeneratedAudio()).map((record) => record.id)).toContain("conflicting-audio")
  })

  it("does not resurrect IndexedDB records after clearing the server archive", async () => {
    const user = userEvent.setup()
    const fetchMock = mockArchive([archiveItem({ id: "persisted-audio" })])
    await saveGeneratedAudio(audioInput({ id: "persisted-audio" }), 20)
    const { unmount } = render(<GeneratedAudioHarness onSnapshot={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("item-count")).toHaveTextContent("1"))
    await user.click(screen.getByRole("button", { name: /clear all/i }))
    await waitFor(() => expect(screen.getByTestId("item-count")).toHaveTextContent("0"))
    expect((await readGeneratedAudioArchiveMigrationState()).clearedIds.has("persisted-audio")).toBe(true)
    const postCallCountAfterClear = fetchMock.mock.calls.filter(
      ([input, init]) => String(input) === "/api/generated-audio" && init?.method === "POST"
    ).length

    unmount()
    render(<GeneratedAudioHarness onSnapshot={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"))
    expect(screen.getByTestId("item-count")).toHaveTextContent("0")
    expect(
      fetchMock.mock.calls.filter(([input, init]) => String(input) === "/api/generated-audio" && init?.method === "POST")
    ).toHaveLength(postCallCountAfterClear)
  })
})
