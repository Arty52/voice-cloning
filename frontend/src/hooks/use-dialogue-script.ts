import { useMemo, useState } from "react"

import {
  buildDialogueSpeechJobSegments,
  normalizeSpeakerLabel,
  parseSpeakerLabeledScript,
  type MultiVoiceScriptBlock,
  type SpeakerVoiceMapping,
} from "@/lib/dialogue-script"
import type { VoiceAsset } from "@/types"

export type DialogueInputMode = "range" | "dialogue"

export type UseDialogueScriptOptions = {
  defaultVoice: VoiceAsset | null
  voices: VoiceAsset[]
}

export function useDialogueScript({ defaultVoice, voices }: UseDialogueScriptOptions) {
  const [mode, setMode] = useState<DialogueInputMode>("range")
  const [blocks, setBlocks] = useState<MultiVoiceScriptBlock[]>([])
  const [speakerMappings, setSpeakerMappings] = useState<SpeakerVoiceMapping[]>([])
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(() => new Set())

  const speakerLabels = useMemo(() => uniqueSpeakerLabels(blocks), [blocks])
  const selectedBlockCount = selectedBlockIds.size
  const allBlocksSelected = blocks.length > 0 && blocks.every((block) => selectedBlockIds.has(block.id))
  const segmentBuild = useMemo(() => {
    if (!defaultVoice) {
      return {
        error: blocks.some((block) => block.text.trim()) ? "Select a default voice before generating." : null,
        missingSpeakerLabels: [],
        segments: [],
        text: "",
      }
    }
    return buildDialogueSpeechJobSegments({
      blocks,
      defaultVoice,
      speakerMappings,
      voices,
    })
  }, [blocks, defaultVoice, speakerMappings, voices])

  function importFromText(text: string) {
    const nextBlocks = parseSpeakerLabeledScript(text)
    setBlocks(nextBlocks)
    setSpeakerMappings((current) => mergeSpeakerMappings(current, uniqueSpeakerLabels(nextBlocks)))
    setSelectedBlockIds(new Set())
    setMode("dialogue")
  }

  function updateBlockText(blockId: string, text: string) {
    setBlocks((current) => current.map((block) => (block.id === blockId ? { ...block, text } : block)))
  }

  function updateBlockSpeakerLabel(blockId: string, speakerLabel: string) {
    const normalizedLabel = normalizeSpeakerLabel(speakerLabel)
    setBlocks((current) =>
      current.map((block) =>
        block.id === blockId
          ? {
              ...block,
              speakerLabel: normalizedLabel || null,
            }
          : block
      )
    )
    if (normalizedLabel) {
      setSpeakerMappings((current) => ensureSpeakerMapping(current, normalizedLabel))
    }
  }

  function updateBlockVoice(blockId: string, voice: VoiceAsset | null) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === blockId
          ? {
              ...block,
              voiceId: voice?.id ?? null,
              voiceName: voice?.name ?? null,
            }
          : block
      )
    )
  }

  function updateSpeakerMapping(speakerLabel: string, voice: VoiceAsset | null) {
    setSpeakerMappings((current) => upsertSpeakerMapping(current, speakerLabel, voice?.id ?? null))
  }

  function toggleBlockSelection(blockId: string, selected: boolean) {
    setSelectedBlockIds((current) => {
      const next = new Set(current)
      if (selected) {
        next.add(blockId)
      } else {
        next.delete(blockId)
      }
      return next
    })
  }

  function setAllBlocksSelected(selected: boolean) {
    setSelectedBlockIds(selected ? new Set(blocks.map((block) => block.id)) : new Set())
  }

  function clearSelectedBlocks() {
    setSelectedBlockIds(new Set())
  }

  function assignSelectedBlocks(voice: VoiceAsset) {
    const selectedBlocks = blocks.filter((block) => selectedBlockIds.has(block.id))
    if (selectedBlocks.length === 0) {
      return
    }

    const sharedSpeakerLabel = sharedSelectedSpeakerLabel(selectedBlocks)
    if (sharedSpeakerLabel) {
      setSpeakerMappings((current) => upsertSpeakerMapping(current, sharedSpeakerLabel, voice.id))
      setBlocks((current) =>
        current.map((block) =>
          selectedBlockIds.has(block.id) && block.speakerLabel === sharedSpeakerLabel
            ? { ...block, voiceId: null, voiceName: null }
            : block
        )
      )
      return
    }

    setBlocks((current) =>
      current.map((block) =>
        selectedBlockIds.has(block.id)
          ? {
              ...block,
              voiceId: voice.id,
              voiceName: voice.name,
            }
          : block
      )
    )
  }

  return {
    allBlocksSelected,
    assignSelectedBlocks,
    blocks,
    clearSelectedBlocks,
    importFromText,
    mode,
    segmentBuild,
    selectedBlockCount,
    selectedBlockIds,
    setAllBlocksSelected,
    setMode,
    speakerLabels,
    speakerMappings,
    toggleBlockSelection,
    updateBlockSpeakerLabel,
    updateBlockText,
    updateBlockVoice,
    updateSpeakerMapping,
  }
}

export type DialogueScriptController = ReturnType<typeof useDialogueScript>

function uniqueSpeakerLabels(blocks: MultiVoiceScriptBlock[]) {
  const labels: string[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    if (!block.speakerLabel || seen.has(block.speakerLabel)) {
      continue
    }
    seen.add(block.speakerLabel)
    labels.push(block.speakerLabel)
  }
  return labels
}

function mergeSpeakerMappings(current: SpeakerVoiceMapping[], speakerLabels: string[]) {
  let next = current
  for (const speakerLabel of speakerLabels) {
    if (!next.some((mapping) => mapping.speakerLabel === speakerLabel)) {
      next = [...next, { speakerLabel, voiceId: null }]
    }
  }
  return next.filter((mapping) => speakerLabels.includes(mapping.speakerLabel))
}

function upsertSpeakerMapping(
  mappings: SpeakerVoiceMapping[],
  speakerLabel: string,
  voiceId: string | null
) {
  if (mappings.some((mapping) => mapping.speakerLabel === speakerLabel)) {
    return mappings.map((mapping) => (mapping.speakerLabel === speakerLabel ? { ...mapping, voiceId } : mapping))
  }
  return [...mappings, { speakerLabel, voiceId }]
}

function ensureSpeakerMapping(mappings: SpeakerVoiceMapping[], speakerLabel: string) {
  if (mappings.some((mapping) => mapping.speakerLabel === speakerLabel)) {
    return mappings
  }
  return [...mappings, { speakerLabel, voiceId: null }]
}

function sharedSelectedSpeakerLabel(blocks: MultiVoiceScriptBlock[]) {
  const [firstBlock] = blocks
  if (!firstBlock?.speakerLabel) {
    return null
  }
  return blocks.every((block) => block.speakerLabel === firstBlock.speakerLabel) ? firstBlock.speakerLabel : null
}
