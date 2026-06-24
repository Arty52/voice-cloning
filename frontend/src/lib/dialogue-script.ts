import type { VoiceAsset, VoiceTuningValues } from "@/types"
import type { SpeechJobSegmentDraft } from "@/lib/voice-assignments"

export type MultiVoiceScriptBlock = {
  id: string
  speakerLabel: string | null
  text: string
  voiceId: string | null
  voiceName?: string | null
  voiceSettings?: VoiceTuningValues | null
}

export type SpeakerVoiceMapping = {
  speakerLabel: string
  voiceId: string | null
}

export type DialogueSpeechSegmentBuildResult = {
  error: string | null
  missingSpeakerLabels: string[]
  segments: SpeechJobSegmentDraft[]
  text: string
}

type VoiceChoice = Pick<VoiceAsset, "id" | "name">

type BuildDialogueSpeechJobSegmentsInput = {
  blocks: MultiVoiceScriptBlock[]
  defaultVoice: VoiceChoice
  speakerMappings: SpeakerVoiceMapping[]
  voices: VoiceChoice[]
}

const SPEAKER_LABEL_PATTERN = /^([\p{L}\p{N}][\p{L}\p{N}\p{M} ._'()-]{0,48}):[ \t]+(.+)$/u
const EMPTY_SPEAKER_LABEL_PATTERN = /^([\p{L}\p{N}][\p{L}\p{N}\p{M} ._'()-]{0,48}):[ \t]*$/u
const SPEAKER_COLOR_COUNT = 6

export function parseSpeakerLabeledScript(text: string): MultiVoiceScriptBlock[] {
  const blocks: MultiVoiceScriptBlock[] = []

  for (const line of text.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (!trimmedLine) {
      continue
    }

    const match = SPEAKER_LABEL_PATTERN.exec(trimmedLine)
    if (match) {
      const speakerLabel = normalizeSpeakerLabel(match[1])
      const dialogueText = match[2].trim()
      if (!dialogueText) {
        continue
      }
      blocks.push(createScriptBlock({ speakerLabel, text: dialogueText }, blocks.length))
      continue
    }

    if (EMPTY_SPEAKER_LABEL_PATTERN.test(trimmedLine)) {
      continue
    }

    blocks.push(createScriptBlock({ speakerLabel: null, text: trimmedLine }, blocks.length))
  }

  return blocks
}

export function buildDialogueSpeechJobSegments({
  blocks,
  defaultVoice,
  speakerMappings,
  voices,
}: BuildDialogueSpeechJobSegmentsInput): DialogueSpeechSegmentBuildResult {
  const voicesById = new Map(voices.map((voice) => [voice.id, voice]))
  const mappingsBySpeaker = new Map(speakerMappings.map((mapping) => [mapping.speakerLabel, mapping.voiceId]))
  const missingSpeakerLabels = new Set<string>()
  const segments: SpeechJobSegmentDraft[] = []
  let text = ""
  let voiceMissing = false

  for (const block of blocks) {
    const dialogueText = block.text.trim()
    if (!dialogueText) {
      continue
    }

    const segmentText = text ? `\n${dialogueText}` : dialogueText
    const start = text.length
    text += segmentText
    const resolvedVoice = resolveBlockVoice({
      block,
      defaultVoice,
      mappingsBySpeaker,
      missingSpeakerLabels,
      voicesById,
    })
    if (!resolvedVoice) {
      if (block.voiceId || (block.speakerLabel && mappingsBySpeaker.get(block.speakerLabel))) {
        voiceMissing = true
      }
      continue
    }

    segments.push({
      assignmentId: resolvedVoice.assignmentKind === "assigned" ? block.id : null,
      assignmentKind: resolvedVoice.assignmentKind,
      clientSegmentId: block.id,
      end: text.length,
      start,
      text: segmentText,
      voiceId: resolvedVoice.voice.id,
      voiceName: resolvedVoice.voice.name,
      voiceSettings: block.voiceSettings ?? null,
    })
  }

  if (missingSpeakerLabels.size > 0) {
    const labels = [...missingSpeakerLabels].sort((first, second) => first.localeCompare(second))
    return {
      error: `Map voices for labeled speakers before generating: ${labels.join(", ")}.`,
      missingSpeakerLabels: labels,
      segments: [],
      text,
    }
  }

  if (voiceMissing) {
    return {
      error: "Some dialogue voices are no longer in the Voice Library. Update speaker mappings or row voices before generating.",
      missingSpeakerLabels: [],
      segments: [],
      text,
    }
  }

  if (segments.length === 0) {
    return {
      error: "Add dialogue text before generating.",
      missingSpeakerLabels: [],
      segments: [],
      text: "",
    }
  }

  return {
    error: null,
    missingSpeakerLabels: [],
    segments,
    text,
  }
}

export function speakerColorIndex(speakerLabel: string | null) {
  if (!speakerLabel) {
    return 0
  }

  let hash = 0
  for (const character of speakerLabel) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return hash % SPEAKER_COLOR_COUNT
}

export function speakerColorClassName(speakerLabel: string | null) {
  return `dialogue-speaker-${speakerColorIndex(speakerLabel)}`
}

export function normalizeSpeakerLabel(label: string) {
  return label.trim().replace(/\s+/g, " ")
}

function createScriptBlock(
  block: Pick<MultiVoiceScriptBlock, "speakerLabel" | "text">,
  index: number
): MultiVoiceScriptBlock {
  return {
    id: `dialogue-block-${index + 1}`,
    speakerLabel: block.speakerLabel,
    text: block.text,
    voiceId: null,
    voiceName: null,
    voiceSettings: null,
  }
}

function resolveBlockVoice({
  block,
  defaultVoice,
  mappingsBySpeaker,
  missingSpeakerLabels,
  voicesById,
}: {
  block: MultiVoiceScriptBlock
  defaultVoice: VoiceChoice
  mappingsBySpeaker: Map<string, string | null>
  missingSpeakerLabels: Set<string>
  voicesById: Map<string, VoiceChoice>
}): { assignmentKind: "assigned" | "default"; voice: VoiceChoice } | null {
  if (block.voiceId) {
    const voice = voicesById.get(block.voiceId)
    return voice ? { assignmentKind: "assigned", voice } : null
  }

  if (block.speakerLabel) {
    const mappedVoiceId = mappingsBySpeaker.get(block.speakerLabel)
    if (!mappedVoiceId) {
      missingSpeakerLabels.add(block.speakerLabel)
      return null
    }
    const voice = voicesById.get(mappedVoiceId)
    return voice ? { assignmentKind: "assigned", voice } : null
  }

  return { assignmentKind: "default", voice: defaultVoice }
}
