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
    windowDurationSeconds: null,
    windowStartSeconds: null,
  }
}
