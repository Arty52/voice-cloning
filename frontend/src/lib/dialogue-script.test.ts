import { describe, expect, it } from "vitest"

import {
  buildDialogueSpeechJobSegments,
  normalizeSpeakerLabel,
  parseSpeakerLabeledScript,
  speakerColorIndex,
  type MultiVoiceScriptBlock,
  type SpeakerVoiceMapping,
} from "./dialogue-script"

const narrator = { id: "narrator", name: "Narrator" }
const skippy = { id: "skippy", name: "Skippy Voice" }
const vegeta = { id: "vegeta", name: "Vegeta Voice" }
const voices = [narrator, skippy, vegeta]

describe("speaker-labeled dialogue parsing", () => {
  it("parses labeled and unlabeled dialogue lines into ordered blocks", () => {
    const blocks = parseSpeakerLabeledScript(`
Skippy: Hello world.

Vegeta: It is going.
This is unlabeled narration.
Skippy: Magnificently.
`)

    expect(blocks).toEqual([
      expect.objectContaining({ id: "dialogue-block-1", speakerLabel: "Skippy", text: "Hello world." }),
      expect.objectContaining({ id: "dialogue-block-2", speakerLabel: "Vegeta", text: "It is going." }),
      expect.objectContaining({ id: "dialogue-block-3", speakerLabel: null, text: "This is unlabeled narration." }),
      expect.objectContaining({ id: "dialogue-block-4", speakerLabel: "Skippy", text: "Magnificently." }),
    ])
  })

  it("keeps ambiguous colon text unlabeled unless it has a clear speaker prefix", () => {
    const blocks = parseSpeakerLabeledScript(`
https://example.test/path
Note: this is still a labeled script line.
Skippy:
Skippy: Hello.
`)

    expect(blocks).toEqual([
      expect.objectContaining({ speakerLabel: null, text: "https://example.test/path" }),
      expect.objectContaining({ speakerLabel: "Note", text: "this is still a labeled script line." }),
      expect.objectContaining({ speakerLabel: "Skippy", text: "Hello." }),
    ])
  })

  it("normalizes speaker label whitespace", () => {
    expect(normalizeSpeakerLabel("  Captain   Rex  ")).toBe("Captain Rex")
  })
})

describe("dialogue speech job segment building", () => {
  it("builds ordered segments whose text exactly matches the submitted job text", () => {
    const blocks = parseSpeakerLabeledScript(`
Skippy: Hello world.
Vegeta: It is going.
Narration between them.
`)
    const result = buildDialogueSpeechJobSegments({
      blocks,
      defaultVoice: narrator,
      speakerMappings: mappings([
        ["Skippy", "skippy"],
        ["Vegeta", "vegeta"],
      ]),
      voices,
    })

    expect(result.error).toBeNull()
    expect(result.text).toBe("Hello world.\nIt is going.\nNarration between them.")
    expect(result.segments.map((segment) => segment.text).join("")).toBe(result.text)
    expect(result.segments).toEqual([
      expect.objectContaining({
        assignmentKind: "assigned",
        clientSegmentId: "dialogue-block-1",
        text: "Hello world.",
        voiceId: "skippy",
      }),
      expect.objectContaining({
        assignmentKind: "assigned",
        clientSegmentId: "dialogue-block-2",
        text: "\nIt is going.",
        voiceId: "vegeta",
      }),
      expect.objectContaining({
        assignmentKind: "default",
        text: "\nNarration between them.",
        voiceId: "narrator",
      }),
    ])
  })

  it("lets row voice overrides take precedence over speaker mappings", () => {
    const blocks = withOverrides(parseSpeakerLabeledScript("Skippy: Hello."), {
      voiceId: "vegeta",
      voiceName: "Vegeta Voice",
    })

    const result = buildDialogueSpeechJobSegments({
      blocks,
      defaultVoice: narrator,
      speakerMappings: mappings([["Skippy", "skippy"]]),
      voices,
    })

    expect(result.error).toBeNull()
    expect(result.segments[0]).toMatchObject({
      assignmentKind: "assigned",
      voiceId: "vegeta",
      voiceName: "Vegeta Voice",
    })
  })

  it("blocks generation when labeled speakers are not mapped", () => {
    const result = buildDialogueSpeechJobSegments({
      blocks: parseSpeakerLabeledScript("Skippy: Hello.\nVegeta: Hello."),
      defaultVoice: narrator,
      speakerMappings: mappings([["Skippy", "skippy"]]),
      voices,
    })

    expect(result).toEqual({
      error: "Map voices for labeled speakers before generating: Vegeta.",
      missingSpeakerLabels: ["Vegeta"],
      segments: [],
      text: "Hello.\nHello.",
    })
  })

  it("reports removed row or mapped voices", () => {
    const result = buildDialogueSpeechJobSegments({
      blocks: parseSpeakerLabeledScript("Skippy: Hello."),
      defaultVoice: narrator,
      speakerMappings: mappings([["Skippy", "missing"]]),
      voices,
    })

    expect(result).toMatchObject({
      error: "Some dialogue voices are no longer in the Voice Library. Update speaker mappings or row voices before generating.",
      segments: [],
      text: "Hello.",
    })
  })

  it("uses stable speaker color buckets", () => {
    expect(speakerColorIndex("Skippy")).toBe(speakerColorIndex("Skippy"))
    expect(speakerColorIndex("Skippy")).toBeGreaterThanOrEqual(0)
    expect(speakerColorIndex("Skippy")).toBeLessThan(6)
  })
})

function mappings(entries: [string, string | null][]): SpeakerVoiceMapping[] {
  return entries.map(([speakerLabel, voiceId]) => ({ speakerLabel, voiceId }))
}

function withOverrides(
  blocks: MultiVoiceScriptBlock[],
  override: Partial<MultiVoiceScriptBlock>
): MultiVoiceScriptBlock[] {
  return blocks.map((block) => ({ ...block, ...override }))
}
