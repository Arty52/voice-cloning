import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as workspace from "@/hooks/use-dialogue-workspace"
import { DIALOGUE_DRAFT_KEY } from "@/lib/dialogue-draft"
import type { GeneratedAudioScriptSnapshot, VoiceAsset } from "@/types"

import { useVoiceStudioController } from "./use-voice-studio-controller"

const controllerMocks = vi.hoisted(() => ({
  selectedVoiceId: "narrator",
  voiceStatus: "success",
  presetStatus: "success",
  providerId: null as string | null,
  voices: [] as VoiceAsset[],
}))

vi.mock("@/hooks/use-provider-keys", () => ({
  useProviderKeys: () => ({
    activeProvider: null,
    activeProviderId: controllerMocks.providerId,
    activeProviderKey: null,
    canUseProvider: false,
    keySource: "missing",
    providerError: null,
    providerStatus: "success",
  }),
}))

vi.mock("@/hooks/use-voice-library", async () => {
  const React = await import("react")
  return {
    useVoiceLibrary: () => {
      const [selectedVoiceId, setSelectedVoiceId] = React.useState(controllerMocks.selectedVoiceId)
      const selectedVoice = controllerMocks.voices.find((candidate) => candidate.id === selectedVoiceId) ?? null
      return {
        addSavedVoice: vi.fn(),
        defaultVoiceId: controllerMocks.voices[0]?.id ?? "",
        deleteVoice: vi.fn(),
        selectedVoice,
        selectedVoiceId,
        setSelectedVoiceId,
        setVoiceError: vi.fn(),
        updateVoice: vi.fn(),
        updateVoiceSettings: vi.fn(),
        voiceError: null,
        voiceStatus: controllerMocks.voiceStatus,
        voices: controllerMocks.voices,
      }
    },
  }
})

vi.mock("@/hooks/use-voice-metadata", () => ({
  useVoiceMetadata: () => ({
    backendDefaultModelId: null,
    modelStatus: "success",
    restoreSelectedModelId: vi.fn(),
    models: [],
    selectedModelId: "",
  }),
}))

vi.mock("@/hooks/use-user-tuning-presets", () => ({
  useUserTuningPresets: () => ({ presets: [], status: controllerMocks.presetStatus }),
}))

vi.mock("@/hooks/use-generated-audio-library", () => ({
  useGeneratedAudioLibrary: () => ({
    applyGeneratedAudioStorageLimit: vi.fn(),
    clearAllGeneratedAudio: vi.fn(),
    generatedAudioItems: [],
    generatedAudioMutation: null,
    generatedAudioStatus: "success",
    generatedAudioStorageError: null,
    generatedAudioUsage: null,
    persistGeneratedAudio: vi.fn(),
    storageLimitBytes: 100,
  }),
}))

vi.mock("@/hooks/use-speech-generation", () => ({
  useSpeechGeneration: () => ({
    cancelGeneration: vi.fn(),
    error: null,
    generateSpeech: vi.fn(),
    generationElapsedMs: null,
    isGenerating: false,
    status: "idle",
  }),
}))

vi.mock("@/hooks/use-multi-voice-speech-generation", () => ({
  useMultiVoiceSpeechGeneration: () => ({
    canCancel: false,
    cancelGeneration: vi.fn(),
    error: null,
    generateSpeech: vi.fn(),
    generationElapsedMs: null,
    isGenerating: false,
    job: null,
    regenerateSegment: vi.fn(),
    regenerateVoiceSegments: vi.fn(),
    resetGeneration: vi.fn(),
    resultUrl: null,
    segmentResultUrls: {},
    status: "idle",
  }),
}))

vi.mock("@/hooks/use-voice-sample-input", () => ({
  useVoiceSampleInput: () => ({}),
}))

vi.mock("@/hooks/use-sample-processing", () => ({
  useSampleProcessing: () => ({
    enabledOperations: [],
    optionsError: null,
    optionsStatus: "success",
    status: "idle",
  }),
}))

vi.mock("@/hooks/use-voice-tuning", () => ({
  useVoiceTuning: () => ({
    selectedTuningPresetId: "default",
    tuning: {},
  }),
}))

vi.mock("@/hooks/use-workflow-navigation", async () => {
  const React = await import("react")
  return {
    useWorkflowNavigation: () => {
      const [activeSectionId, setActiveSectionId] = React.useState("voice")
      return {
        activeSectionId,
        navigateToSection: setActiveSectionId,
      }
    },
  }
})

const narrator = voice("narrator", "Narrator")
const villain = voice("villain", "Villain")

describe("useVoiceStudioController script snapshot restore", () => {
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame

  beforeEach(() => {
    originalRequestAnimationFrame = window.requestAnimationFrame
    controllerMocks.selectedVoiceId = "narrator"
    controllerMocks.voiceStatus = "success"
    controllerMocks.presetStatus = "success"
    controllerMocks.providerId = null
    controllerMocks.voices = [narrator, villain]
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof window.requestAnimationFrame
  })

  afterEach(() => {
    localStorage.removeItem(DIALOGUE_DRAFT_KEY)
    window.requestAnimationFrame = originalRequestAnimationFrame
    vi.restoreAllMocks()
  })

  it("waits for presets before restoring and requires a choice if the saved preset disappeared", async () => {
    controllerMocks.presetStatus = "loading"
    localStorage.setItem(DIALOGUE_DRAFT_KEY, JSON.stringify({ version: 1, writerId: "saved", revision: "saved", draft: {
      identity: "script", sourceText: "Narrator: Saved.", sourceExpanded: false,
      blocks: [{ id: "row-1", speakerLabel: "Narrator", text: "Saved.", voiceId: null }], speakerMappings: [],
      sourceVoiceId: "narrator", providerId: null, modelId: "", selectedUserTuningPresetId: "missing-preset", naturalHandoffs: false,
      speech: { active: null, successful: null, resultId: null },
    } }))
    const { result, rerender } = renderHook(() => useVoiceStudioController())
    expect(result.current.dialogueWorkspace.isRestoring).toBe(true)
    expect(result.current.dialogue.mode).toBe("range")
    controllerMocks.presetStatus = "success"
    rerender()
    await waitFor(() => expect(result.current.dialogueWorkspace.isRestoring).toBe(false))
    expect(result.current.dialogue.mode).toBe("dialogue")
    expect(result.current.canGenerate).toBe(false)
    expect(result.current.scriptRestoreWarning).toContain("saved tuning preset is unavailable")
  })

  it("keeps the workspace draft stable until an input changes", () => {
    const workspaceSpy = vi.spyOn(workspace, "useDialogueWorkspace")
    const { result, rerender } = renderHook(() => useVoiceStudioController())
    act(() => result.current.dialogue.importFromText("Narrator: Original."))
    const draft = workspaceSpy.mock.calls.at(-1)![0].draft
    expect(draft).not.toBeNull()
    rerender()
    expect(workspaceSpy.mock.calls.at(-1)![0].draft).toBe(draft)
    act(() => result.current.dialogue.updateBlockText(result.current.dialogue.blocks[0].id, "Edited."))
    expect(workspaceSpy.mock.calls.at(-1)![0].draft).not.toBe(draft)
    expect(workspaceSpy.mock.calls.at(-1)![0].draft?.blocks[0].text).toBe("Edited.")
  })

  it("preserves the saved provider until the current provider is explicitly chosen", async () => {
    controllerMocks.providerId = "new-provider"
    const workspaceSpy = vi.spyOn(workspace, "useDialogueWorkspace")
    localStorage.setItem(DIALOGUE_DRAFT_KEY, JSON.stringify({ version: 1, writerId: "saved", revision: "saved", draft: {
      identity: "script", sourceText: "Narrator: Saved.", sourceExpanded: false,
      blocks: [{ id: "row-1", speakerLabel: "Narrator", text: "Saved.", voiceId: null }], speakerMappings: [],
      sourceVoiceId: "narrator", providerId: "saved-provider", modelId: "", selectedUserTuningPresetId: null, naturalHandoffs: false,
      speech: { active: null, successful: null, resultId: null },
    } }))
    const { result } = renderHook(() => useVoiceStudioController())
    await waitFor(() => expect(result.current.dialogueWorkspace.isRestoring).toBe(false))
    expect(result.current.draftProviderChange).toMatchObject({ saved: "saved-provider", current: "new-provider" })
    expect(workspaceSpy.mock.calls.at(-1)![0].draft?.providerId).toBe("saved-provider")
    expect(result.current.canGenerate).toBe(false)
    act(() => result.current.draftProviderChange!.onAccept())
    expect(result.current.draftProviderChange).toBeNull()
    expect(workspaceSpy.mock.calls.at(-1)![0].draft?.providerId).toBe("new-provider")
    expect(result.current.multiVoiceSpeech.generateSpeech).not.toHaveBeenCalled()
  })

  it("restores range text, assignments, source voice, and disabled Natural Handoffs", () => {
    const { result } = renderHook(() => useVoiceStudioController())

    act(() => {
      result.current.restoreScriptSnapshot(rangeSnapshot())
    })

    expect(result.current.text).toBe("Narrator starts. Villain replies.")
    expect(result.current.voiceLibrary.selectedVoiceId).toBe("villain")
    expect(result.current.naturalHandoffsEnabled).toBe(false)
    expect(result.current.dialogue.mode).toBe("range")
    expect(result.current.voiceAssignments).toEqual(rangeSnapshot().assignments)
    expect(result.current.scriptRestoreWarning).toBeNull()
    expect(result.current.activeSectionId).toBe("generate")
  })

  it("keeps restored text and assignments when referenced voices are missing", () => {
    controllerMocks.voices = [narrator]
    const { result } = renderHook(() => useVoiceStudioController())
    const snapshot = rangeSnapshot({
      sourceVoiceId: "missing-source",
      assignments: [
        {
          id: "assignment-1",
          start: 0,
          end: 8,
          text: "Missing.",
          sourceText: "Missing.",
          voiceId: "missing-voice",
          voiceName: "Missing Voice",
        },
      ],
      text: "Missing.",
    })

    act(() => {
      result.current.restoreScriptSnapshot(snapshot)
    })

    expect(result.current.voiceLibrary.selectedVoiceId).toBe("narrator")
    expect(result.current.text).toBe("Missing.")
    expect(result.current.voiceAssignments).toEqual(snapshot.assignments)
    expect(result.current.scriptRestoreWarning).toContain("no longer in the Voice Library")
  })

  it("does not report missing voices before the Voice Library finishes loading", () => {
    controllerMocks.voiceStatus = "loading"
    controllerMocks.voices = []
    const { result } = renderHook(() => useVoiceStudioController())
    const snapshot = rangeSnapshot({
      sourceVoiceId: "villain",
      assignments: [
        {
          id: "assignment-1",
          start: 0,
          end: 8,
          text: "Pending.",
          sourceText: "Pending.",
          voiceId: "villain",
          voiceName: "Villain",
        },
      ],
      text: "Pending.",
    })

    act(() => {
      result.current.restoreScriptSnapshot(snapshot)
    })

    expect(result.current.voiceLibrary.selectedVoiceId).toBe("narrator")
    expect(result.current.text).toBe("Pending.")
    expect(result.current.voiceAssignments).toEqual(snapshot.assignments)
    expect(result.current.scriptRestoreWarning).toBeNull()
  })

  it("restores dialogue rows, speaker mappings, source voice, and enabled Natural Handoffs", () => {
    const { result } = renderHook(() => useVoiceStudioController())

    act(() => {
      result.current.restoreScriptSnapshot(dialogueSnapshot())
    })

    expect(result.current.text).toBe("Hello.\nHi.")
    expect(result.current.voiceLibrary.selectedVoiceId).toBe("narrator")
    expect(result.current.naturalHandoffsEnabled).toBe(true)
    expect(result.current.voiceAssignments).toEqual([])
    expect(result.current.dialogue.mode).toBe("dialogue")
    expect(result.current.dialogue.blocks).toEqual(dialogueSnapshot().dialogueBlocks)
    expect(result.current.dialogue.speakerMappings).toEqual(dialogueSnapshot().speakerMappings)
    expect(result.current.scriptRestoreWarning).toBeNull()
  })

  it("confirms before replacing dirty draft script state", () => {
    const { result } = renderHook(() => useVoiceStudioController())

    act(() => {
      result.current.setText("Unsaved draft.")
    })
    act(() => {
      result.current.restoreScriptSnapshot(rangeSnapshot())
    })

    expect(result.current.text).toBe("Unsaved draft.")
    expect(result.current.confirmation.confirmation).toMatchObject({
      confirmLabel: "Replace Script",
      destructive: true,
      title: "Replace Draft Script?",
    })

    act(() => {
      result.current.confirmation.confirmation?.onConfirm()
    })

    expect(result.current.text).toBe("Narrator starts. Villain replies.")
    expect(result.current.voiceAssignments).toEqual(rangeSnapshot().assignments)
  })
})

function rangeSnapshot(
  overrides: Partial<GeneratedAudioScriptSnapshot> = {}
): GeneratedAudioScriptSnapshot {
  return {
    version: 1,
    mode: "range",
    text: "Narrator starts. Villain replies.",
    sourceVoiceId: "villain",
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
    ...overrides,
  }
}

function dialogueSnapshot(): GeneratedAudioScriptSnapshot {
  return {
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
  }
}

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
