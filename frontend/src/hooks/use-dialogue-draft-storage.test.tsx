import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDialogueDraftStorage } from "./use-dialogue-draft-storage"
import { DIALOGUE_DRAFT_KEY, parseDialogueDraft, type DialogueDraft } from "@/lib/dialogue-draft"

const draft: DialogueDraft = {
  identity: "script", sourceText: "Speaker: Original.", sourceExpanded: false,
  blocks: [{ id: "row-1", speakerLabel: "Speaker", text: "Edited.", voiceId: null }],
  speakerMappings: [{ speakerLabel: "Speaker", voiceId: "voice" }], sourceVoiceId: "voice", providerId: "provider",
  modelId: "model", selectedUserTuningPresetId: null, naturalHandoffs: false,
  speech: { active: null, successful: null, resultId: null },
}
const envelope = (value = draft, writerId = "other") => JSON.stringify({ version: 1, writerId, revision: crypto.randomUUID(), draft: value })

describe("dialogue draft storage", () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
  it("restores original source and unsynthesized edits after remount", () => {
    const first = renderHook(() => useDialogueDraftStorage(draft))
    act(() => { vi.advanceTimersByTime(300) })
    first.unmount()
    const next = renderHook(() => useDialogueDraftStorage(null))
    expect(next.result.current.initialDraft).toEqual(draft)
  })
  it("flushes edits on page hide before the debounce", () => {
    renderHook(() => useDialogueDraftStorage(draft))
    act(() => { window.dispatchEvent(new Event("pagehide")) })
    expect(parseDialogueDraft(localStorage.getItem(DIALOGUE_DRAFT_KEY))?.draft).toEqual(draft)
  })
  it("does not overwrite a saved draft before hydration", () => {
    const saved = envelope()
    localStorage.setItem(DIALOGUE_DRAFT_KEY, saved)
    renderHook(() => useDialogueDraftStorage(null))
    act(() => { vi.advanceTimersByTime(500) })
    expect(localStorage.getItem(DIALOGUE_DRAFT_KEY)).toBe(saved)
  })
  it("rejects malformed drafts without crashing the editor", () => {
    for (const raw of ["{bad", envelope({ ...draft, blocks: [{ id: "bad/id" }] } as unknown as DialogueDraft), envelope({ ...draft, speech: { active: { jobId: "../wrong" } } } as unknown as DialogueDraft)]) expect(() => parseDialogueDraft(raw)).toThrow()
    localStorage.setItem(DIALOGUE_DRAFT_KEY, "invalid")
    const { result } = renderHook(() => useDialogueDraftStorage(null))
    expect(result.current.initialDraft).toBeNull()
    expect(result.current.error).toContain("could not be read")
  })
  it("reports storage failure while retaining the working draft", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded") })
    const { result } = renderHook(() => useDialogueDraftStorage(draft))
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.error).toContain("could not be saved")
  })
  it("pauses autosaving on another tab's update until Keep Current is chosen", () => {
    const { result, rerender } = renderHook(({ value }) => useDialogueDraftStorage(value), { initialProps: { value: draft } })
    act(() => { vi.advanceTimersByTime(300) })
    const other = envelope({ ...draft, sourceText: "Other tab" })
    localStorage.setItem(DIALOGUE_DRAFT_KEY, other)
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: DIALOGUE_DRAFT_KEY, newValue: other })) })
    expect(result.current.conflict).not.toBeNull()
    rerender({ value: { ...draft, sourceText: "My new edit" } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(localStorage.getItem(DIALOGUE_DRAFT_KEY)).toBe(other)
    act(() => { result.current.keepCurrent() })
    expect(parseDialogueDraft(localStorage.getItem(DIALOGUE_DRAFT_KEY))?.draft.sourceText).toBe("My new edit")
    expect(result.current.conflict).toBeNull()
  })
  it("returns the saved draft when resolving a conflict", () => {
    const { result } = renderHook(() => useDialogueDraftStorage(draft))
    const otherDraft = { ...draft, sourceText: "Other tab" }
    const other = envelope(otherDraft)
    localStorage.setItem(DIALOGUE_DRAFT_KEY, other)
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: DIALOGUE_DRAFT_KEY, newValue: other })) })
    act(() => { expect(result.current.acceptSaved()).toEqual(otherDraft) })
  })
})
