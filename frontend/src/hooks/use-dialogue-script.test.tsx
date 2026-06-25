import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { VoiceAsset } from "@/types"

import { useDialogueScript } from "./use-dialogue-script"

const narrator = voice("narrator", "Narrator")
const skippy = voice("skippy", "Skippy Voice")
const vegeta = voice("vegeta", "Vegeta Voice")
const voices = [narrator, skippy, vegeta]

describe("useDialogueScript", () => {
  it("imports speaker-labeled text into dialogue mode", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Skippy: Hello.\nVegeta: Hello back.")
    })

    expect(result.current.mode).toBe("dialogue")
    expect(result.current.blocks).toEqual([
      expect.objectContaining({ speakerLabel: "Skippy", text: "Hello." }),
      expect.objectContaining({ speakerLabel: "Vegeta", text: "Hello back." }),
    ])
    expect(result.current.speakerMappings).toEqual([
      { speakerLabel: "Skippy", voiceId: null },
      { speakerLabel: "Vegeta", voiceId: null },
    ])
    expect(result.current.segmentBuild.error).toBe("Map voices for labeled speakers before generating: Skippy, Vegeta.")
  })

  it("builds generation text after speaker mappings are set", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Skippy: Hello.\nVegeta: Hello back.")
      result.current.updateSpeakerMapping("Skippy", skippy)
      result.current.updateSpeakerMapping("Vegeta", vegeta)
    })

    expect(result.current.segmentBuild.error).toBeNull()
    expect(result.current.segmentBuild.text).toBe("Hello.\nHello back.")
    expect(result.current.segmentBuild.segments.map((segment) => segment.text).join("")).toBe(
      result.current.segmentBuild.text
    )
    expect(result.current.segmentBuild.segments.map((segment) => segment.voiceId)).toEqual(["skippy", "vegeta"])
  })

  it("keeps omitted saved tuning options stable across rerenders", () => {
    const { rerender, result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Narration only.")
    })

    const segmentBuild = result.current.segmentBuild
    rerender()

    expect(result.current.segmentBuild).toBe(segmentBuild)
  })

  it("normalizes labels when updating speaker mappings", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Skippy: Hello.")
      result.current.updateSpeakerMapping("  Skippy  ", skippy)
    })

    expect(result.current.speakerMappings).toContainEqual({ speakerLabel: "Skippy", voiceId: "skippy" })
    expect(result.current.segmentBuild.error).toBeNull()
  })

  it("updates row text and speaker labels", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Narration only.")
      result.current.updateBlockSpeakerLabel("dialogue-block-1", "Skippy")
      result.current.updateBlockText("dialogue-block-1", "Updated line.")
    })

    expect(result.current.blocks[0]).toMatchObject({
      speakerLabel: "Skippy",
      text: "Updated line.",
    })
    expect(result.current.speakerMappings).toContainEqual({ speakerLabel: "Skippy", voiceId: null })
  })

  it("preserves existing speaker mappings when a row is relabeled", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Skippy: One.\nVegeta: Two.")
      result.current.updateSpeakerMapping("Skippy", skippy)
      result.current.updateBlockSpeakerLabel("dialogue-block-2", "Skippy")
    })

    expect(result.current.speakerMappings).toContainEqual({ speakerLabel: "Skippy", voiceId: "skippy" })
    expect(result.current.segmentBuild.error).toBeNull()
    expect(result.current.segmentBuild.segments.map((segment) => segment.voiceId)).toEqual(["skippy", "skippy"])
  })

  it("bulk assignment updates a shared speaker mapping", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Skippy: One.\nSkippy: Two.")
    })
    act(() => {
      result.current.toggleBlockSelection("dialogue-block-1", true)
      result.current.toggleBlockSelection("dialogue-block-2", true)
    })
    act(() => {
      result.current.assignSelectedBlocks(skippy)
    })

    expect(result.current.speakerMappings).toContainEqual({ speakerLabel: "Skippy", voiceId: "skippy" })
    expect(result.current.blocks.every((block) => block.voiceId === null)).toBe(true)
    expect(result.current.segmentBuild.error).toBeNull()
  })

  it("keeps internal selected rows isolated from returned set mutations", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Skippy: One.\nUnlabeled.")
      result.current.toggleBlockSelection("dialogue-block-1", true)
    })
    ;(result.current.selectedBlockIds as Set<string>).add("dialogue-block-2")
    act(() => {
      result.current.assignSelectedBlocks(skippy)
    })

    expect(result.current.selectedBlockCount).toBe(1)
    expect(result.current.speakerMappings).toContainEqual({ speakerLabel: "Skippy", voiceId: "skippy" })
    expect(result.current.blocks.map((block) => block.voiceId)).toEqual([null, null])
  })

  it("bulk assignment on mixed rows writes row overrides", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Skippy: One.\nUnlabeled.")
    })
    act(() => {
      result.current.setAllBlocksSelected(true)
    })
    act(() => {
      result.current.assignSelectedBlocks(vegeta)
    })

    expect(result.current.speakerMappings).toContainEqual({ speakerLabel: "Skippy", voiceId: null })
    expect(result.current.blocks.map((block) => block.voiceId)).toEqual(["vegeta", "vegeta"])
    expect(result.current.segmentBuild.error).toBeNull()
    expect(result.current.segmentBuild.segments.map((segment) => segment.voiceId)).toEqual(["vegeta", "vegeta"])
  })

  it("carries imported row tuning into generated segment drafts", () => {
    const { result } = renderHook(() => useDialogueScript({ defaultVoice: narrator, voices }))

    act(() => {
      result.current.importFromText("Skippy: One.")
      result.current.updateSpeakerMapping("Skippy", skippy)
      result.current.updateBlockVoiceSettings("dialogue-block-1", { speed: 1.18 })
    })

    expect(result.current.blocks[0]).toMatchObject({
      voiceSettings: { speed: 1.18 },
    })
    expect(result.current.segmentBuild.segments[0]).toMatchObject({
      clientSegmentId: "dialogue-block-1",
      voiceId: "skippy",
      voiceSettings: { speed: 1.18 },
    })
  })

  it("falls back to saved mapped-voice tuning after row tuning is cleared", () => {
    const { result } = renderHook(() =>
      useDialogueScript({
        defaultVoice: narrator,
        voiceSettingsByVoiceId: { skippy: { stability: 0.31 } },
        voices,
      })
    )

    act(() => {
      result.current.importFromText("Skippy: One.")
      result.current.updateSpeakerMapping("Skippy", skippy)
      result.current.updateBlockVoiceSettings("dialogue-block-1", { speed: 1.18 })
    })
    act(() => {
      result.current.updateBlockVoiceSettings("dialogue-block-1", null)
    })

    expect(result.current.blocks[0].voiceSettings).toBeNull()
    expect(result.current.segmentBuild.segments[0]).toMatchObject({
      voiceId: "skippy",
      voiceSettings: { stability: 0.31 },
    })
  })
})

function voice(id: string, name: string): VoiceAsset {
  return {
    contentType: "audio/mpeg",
    createdAt: "2026-06-23T00:00:00.000Z",
    filePath: `${id}.mp3`,
    id,
    name,
    processingSteps: [],
    sampleMode: "excerpt",
    sha256: `${id}-hash`,
    source: "upload",
    sourceContentType: null,
    sourceFilePath: null,
    sourceSha256: null,
    voicePresetId: "standardNarration",
    voiceSettingsByProvider: {},
    windowDurationSeconds: null,
    windowStartSeconds: null,
  }
}
