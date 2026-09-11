import { dialogueRowState } from "./dialogue-row-state"
import { describe, expect, it } from "vitest"
import { dialogueRevisionState, revisionScriptSnapshot, type DialogueBaseline } from "./dialogue-revisions"
import type { SpeechJobSegmentDraft } from "./voice-assignments"
import type { GeneratedAudioScriptSnapshot, SpeechJob } from "@/types"

const segments: SpeechJobSegmentDraft[] = ["one", "two"].map((id, index) => ({
  clientSegmentId: id, text: `${id}.`, voiceId: "voice", voiceName: "Voice", voiceSettings: null,
  assignmentId: id, assignmentKind: "assigned", start: index * 4, end: index * 4 + 4,
}))
const snapshot: GeneratedAudioScriptSnapshot = { version: 1, mode: "dialogue", text: "one.two.", sourceVoiceId: "voice", assignments: [], speakerMappings: [], segmentGapMs: 0,
  dialogueBlocks: segments.map(s => ({ id: s.clientSegmentId!, text: s.text, voiceId: null, speakerLabel: "Speaker" })),
}
const baseline: DialogueBaseline = { dialogueId: "script", providerId: "provider", modelId: "model", tuning: { speed: 1 }, scriptSnapshot: snapshot,
  job: { text: "one.two.", defaultVoiceId: "voice", activeSegmentId: null, resultSha256: "hash", error: null, createdAt: "now", updatedAt: "now", id: "job", status: "success", segmentGapMs: 0, segments: segments.map((s, i) => ({ ...s, id: s.clientSegmentId, index: i, status: "success", generationCount: 1, characterCount: 4, requestId: null, resultSha256: "hash", cacheState: null, error: null, voiceSettings: { speed: 1 } })) } as SpeechJob,
}
const input = { dialogueId: "script", baseline, segments, providerId: "provider", modelId: "model", tuning: { speed: 1 }, defaults: { speed: 1 }, naturalHandoffs: false }

describe("dialogue revisions", () => {
  it("marks only changed effective inputs and clears reverted edits", () => {
    expect(dialogueRevisionState(input).changedIds).toEqual([])
    expect(dialogueRevisionState({ ...input, segments: [{ ...segments[0], text: "Edited." }, segments[1]] }).changedIds).toEqual(["one"])
    expect(dialogueRevisionState({ ...input, tuning: { speed: 1.1 } }).changedIds).toEqual(["one", "two"])
    expect(dialogueRevisionState({ ...input, segments: [{ ...segments[0], voiceId: "other" }, segments[1]] }).changedIds).toEqual(["one"])
    expect(dialogueRevisionState(input).changedIds).toEqual([])
  })
  it("respects row overrides when inherited tuning changes", () => {
    expect(dialogueRevisionState({ ...input, tuning: { speed: 1.2 }, segments: [{ ...segments[0], voiceSettings: { speed: 1 } }, segments[1]] }).changedIds).toEqual(["two"])
  })
  it("requires a full take for replacement scripts, providers, models, or row structure", () => {
    for (const change of [{ dialogueId: "new" }, { providerId: "other" }, { modelId: "other" }, { segments: [segments[0]] }, { segments: [...segments].reverse() }]) {
      expect(dialogueRevisionState({ ...input, ...change })).toMatchObject({ canRevise: false, fullGenerationReason: expect.any(String) })
    }
    expect(dialogueRevisionState({ ...input, baseline: null }).canRevise).toBe(false)
  })
  it("detects assembly-only changes", () => {
    expect(dialogueRevisionState({ ...input, naturalHandoffs: true })).toMatchObject({ changedIds: [], spacingChanged: true })
  })
  it("keeps other unsynthesized row edits out of the recording snapshot", () => {
    const draft = { ...snapshot, dialogueBlocks: snapshot.dialogueBlocks.map(b => ({ ...b, text: "Draft edit." })) }
    const revised = revisionScriptSnapshot(snapshot, draft, ["one"])
    expect(revised.dialogueBlocks.map(b => b.text)).toEqual(["Draft edit.", "two."])
    expect(snapshot.dialogueBlocks[0].text).toBe("one.")
  })
})


describe("dialogue row recording state", () => {
  it("never links reused row positions to another dialogue identity", () => {
    expect(dialogueRowState("one", baseline, dialogueRevisionState({ ...input, dialogueId: "new" }), null).hasTake).toBe(false)
  })
  it("keeps old audio during running and failed revisions", () => {
    const revision = dialogueRevisionState({ ...input, segments: [{ ...segments[0], text: "Edit." }, segments[1]] })
    const active = { ...baseline.job, id: "revision", status: "running", segments: [{ ...baseline.job.segments[0], status: "running" }] } as SpeechJob
    expect(dialogueRowState("one", baseline, revision, active)).toMatchObject({ label: "Generating", hasTake: true, previousTake: true, running: true })
    active.segments[0].status = "error"
    active.segments[0].error = "Provider unavailable"
    expect(dialogueRowState("one", baseline, revision, active)).toMatchObject({ label: "Error", error: "Provider unavailable", hasTake: true })
    expect(dialogueRowState("two", baseline, revision, active)).toMatchObject({ label: "Up To Date", previousTake: false })
  })
})
