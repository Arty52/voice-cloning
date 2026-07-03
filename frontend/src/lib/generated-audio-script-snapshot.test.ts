import { describe, expect, it } from "vitest"

import { buildDialogueScriptSnapshot, buildRangeScriptSnapshot } from "./generated-audio-script-snapshot"

describe("generated audio script snapshots", () => {
  it("builds range snapshots from text and assignments", () => {
    const snapshot = buildRangeScriptSnapshot({
      text: "Narrator starts. Villain replies.",
      sourceVoiceId: "narrator",
      segmentGapMs: 0.4,
      assignments: [
        {
          id: "assignment-1",
          start: 17,
          end: 33,
          text: "Villain replies.",
          sourceText: "Narrator starts. Villain replies.",
          voiceId: "villain",
          voiceName: "Villain",
        },
      ],
    })

    expect(snapshot).toEqual({
      version: 1,
      mode: "range",
      text: "Narrator starts. Villain replies.",
      sourceVoiceId: "narrator",
      assignments: [
        {
          id: "assignment-1",
          start: 17,
          end: 33,
          text: "Villain replies.",
          sourceText: "Narrator starts. Villain replies.",
          voiceId: "villain",
          voiceName: "Villain",
        },
      ],
      dialogueBlocks: [],
      speakerMappings: [],
      segmentGapMs: 0,
    })
  })

  it("builds dialogue snapshots from editable rows and speaker mappings", () => {
    const snapshot = buildDialogueScriptSnapshot({
      text: "Hello.\nHi.",
      sourceVoiceId: "narrator",
      segmentGapMs: null,
      dialogueBlocks: [
        {
          id: "dialogue-block-1",
          speakerLabel: "Narrator",
          text: "Hello.",
          voiceId: null,
          voiceName: null,
          voiceSettings: null,
        },
        {
          id: "dialogue-block-2",
          speakerLabel: "Villain",
          text: "Hi.",
          voiceId: "villain",
          voiceName: "Villain",
          voiceSettings: { stability: 0.42 },
        },
      ],
      speakerMappings: [
        { speakerLabel: "Narrator", voiceId: "narrator" },
        { speakerLabel: "Villain", voiceId: "villain" },
      ],
    })

    expect(snapshot).toEqual({
      version: 1,
      mode: "dialogue",
      text: "Hello.\nHi.",
      sourceVoiceId: "narrator",
      assignments: [],
      dialogueBlocks: [
        {
          id: "dialogue-block-1",
          speakerLabel: "Narrator",
          text: "Hello.",
          voiceId: null,
          voiceName: null,
          voiceSettings: null,
        },
        {
          id: "dialogue-block-2",
          speakerLabel: "Villain",
          text: "Hi.",
          voiceId: "villain",
          voiceName: "Villain",
          voiceSettings: { stability: 0.42 },
        },
      ],
      speakerMappings: [
        { speakerLabel: "Narrator", voiceId: "narrator" },
        { speakerLabel: "Villain", voiceId: "villain" },
      ],
      segmentGapMs: null,
    })
  })
})
