import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as api from "@/lib/api"
import { useTranscriptionSettings, TRANSCRIPTION_SETTINGS_KEY } from "./use-transcription-settings"
import type { TranscriptionEnginesResponse } from "@/types"

vi.mock("@/lib/api", () => ({ fetchTranscriptionEngines: vi.fn() }))
const catalog: TranscriptionEnginesResponse = {
  defaultEngineId: "faster-whisper", nativeDiarizationReady: false,
  engines: [
    { id: "faster-whisper", label: "Whisper CPU", model: "medium", device: "cpu", languages: ["en", "fr"], ready: true, unavailableReason: null },
    { id: "parakeet-mlx", label: "Parakeet MLX", model: "parakeet", device: "apple-gpu", languages: ["en"], ready: false, unavailableReason: "Prepare the model." },
  ],
}
beforeEach(() => { localStorage.clear(); vi.mocked(api.fetchTranscriptionEngines).mockReset(); vi.mocked(api.fetchTranscriptionEngines).mockResolvedValue(catalog) })

describe("Transcription Settings", () => {
  it("keeps the compatibility default and persists explicit choices without falling back from an unavailable engine", async () => {
    const { result, unmount } = renderHook(useTranscriptionSettings)
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.options).toEqual({ engineId: "faster-whisper", language: "en", detectSpeakers: true })
    act(() => result.current.selectLanguage("fr"))
    act(() => result.current.selectEngine("parakeet-mlx"))
    act(() => result.current.setDetectSpeakers(false))
    expect(result.current.options).toEqual({ engineId: "parakeet-mlx", language: "en", detectSpeakers: false })
    expect(result.current.ready).toBe(false)
    expect(result.current.unavailableReason).toBe("Prepare the model.")
    act(() => result.current.selectLanguage("fr"))
    expect(result.current.options.language).toBe("en")
    unmount()
    const restored = renderHook(useTranscriptionSettings)
    await waitFor(() => expect(restored.result.current.status).toBe("success"))
    expect(restored.result.current.options.engineId).toBe("parakeet-mlx")
    expect(restored.result.current.options.detectSpeakers).toBe(false)
  })
  it("recovers readiness after refresh without changing an unknown saved selection", async () => {
    localStorage.setItem(TRANSCRIPTION_SETTINGS_KEY, JSON.stringify({ engineId: "retired", language: "en", detectSpeakers: true }))
    const { result } = renderHook(useTranscriptionSettings)
    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.ready).toBe(false)
    expect(result.current.options.engineId).toBe("retired")
    act(() => result.current.selectEngine("parakeet-mlx"))
    vi.mocked(api.fetchTranscriptionEngines).mockResolvedValue({ ...catalog, engines: catalog.engines.map((engine) => ({ ...engine, ready: true })) })
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.options.engineId).toBe("parakeet-mlx")
  })
})
