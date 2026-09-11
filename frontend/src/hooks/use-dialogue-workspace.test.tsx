import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useDialogueWorkspace } from "./use-dialogue-workspace"
import { DIALOGUE_DRAFT_KEY, type DialogueDraft } from "@/lib/dialogue-draft"
import type { useMultiVoiceSpeechGeneration } from "./use-multi-voice-speech-generation"

const draft: DialogueDraft = {
  identity: "script", sourceText: "Speaker: Original", sourceExpanded: false,
  blocks: [{ id: "row-1", text: "Unsynthesized edit", speakerLabel: "Speaker", voiceId: "missing-voice" }],
  speakerMappings: [], sourceVoiceId: "missing-voice", providerId: "provider", modelId: "model",
  selectedUserTuningPresetId: null, naturalHandoffs: false,
  speech: { active: null, successful: null, resultId: null },
}
const save = () => localStorage.setItem(DIALOGUE_DRAFT_KEY, JSON.stringify({ version: 1, writerId: "previous-tab", revision: "revision", draft }))

describe("dialogue workspace recovery", () => {
  beforeEach(() => localStorage.clear())
  it("waits for dependencies then restores edits and identity without starting generation", async () => {
    save()
    const applyDraft = vi.fn()
    const resetGeneration = vi.fn()
    const restoreRecovery = vi.fn()
    const speech = { resetGeneration, restoreRecovery } as unknown as ReturnType<typeof useMultiVoiceSpeechGeneration>
    const { result, rerender } = renderHook(({ ready }) => useDialogueWorkspace({ draft: null, ready, applyDraft, speech, providers: [], archivedItems: [], onResult: vi.fn() }), { initialProps: { ready: false } })
    expect(result.current.isRestoring).toBe(true)
    expect(applyDraft).not.toHaveBeenCalled()
    await act(async () => { rerender({ ready: true }) })
    await waitFor(() => expect(result.current.isRestoring).toBe(false))
    expect(applyDraft).toHaveBeenCalledExactlyOnceWith(draft)
    expect(restoreRecovery).not.toHaveBeenCalled()
    expect(resetGeneration).toHaveBeenCalledTimes(1)
  })
  it("does not block a new workspace while metadata loads without a saved draft", () => {
    const applyDraft = vi.fn()
    const { result } = renderHook(() => useDialogueWorkspace({ draft: null, ready: false, applyDraft, speech: {} as ReturnType<typeof useMultiVoiceSpeechGeneration>, providers: [], archivedItems: [], onResult: vi.fn() }))
    expect(result.current.isRestoring).toBe(false)
    expect(applyDraft).not.toHaveBeenCalled()
  })
})
