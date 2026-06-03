import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useGeneratedAudioLibrary, type GeneratedAudioMutation } from "./use-generated-audio-library"
import {
  GENERATED_AUDIO_DB_NAME,
  clearGeneratedAudio,
  saveGeneratedAudio,
  type SaveGeneratedAudioInput,
} from "@/lib/generated-audio-storage"
import type { AsyncStatus } from "@/types"

type Snapshot = {
  itemCount: number
  mutation: GeneratedAudioMutation | null
  status: AsyncStatus
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
      <div data-testid="item-count">{library.generatedAudioItems.length}</div>
      <button disabled={!firstItemId} onClick={() => firstItemId && void library.handleDeleteGeneratedAudio(firstItemId)}>
        Delete First
      </button>
      <button onClick={() => void library.clearAllGeneratedAudio()}>Clear All</button>
      <button onClick={() => void library.applyGeneratedAudioStorageLimit(4)}>Lower Limit</button>
    </div>
  )
}

describe("useGeneratedAudioLibrary", () => {
  beforeEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
    localStorage.clear()
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated-audio")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
  })

  afterEach(async () => {
    await clearGeneratedAudio()
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
})
