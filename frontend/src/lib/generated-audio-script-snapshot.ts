import type {
  GeneratedAudioScriptSnapshot,
  GeneratedAudioScriptSnapshotAssignment,
  GeneratedAudioScriptSnapshotDialogueBlock,
  GeneratedAudioScriptSnapshotSpeakerMapping,
} from "@/types"
import type { MultiVoiceScriptBlock, SpeakerVoiceMapping } from "@/lib/dialogue-script"
import type { VoiceTextAssignment } from "@/lib/voice-assignments"

type BuildRangeScriptSnapshotInput = {
  assignments: VoiceTextAssignment[]
  segmentGapMs?: number | null
  sourceVoiceId: string | null | undefined
  text: string
}

type BuildDialogueScriptSnapshotInput = {
  dialogueBlocks: MultiVoiceScriptBlock[]
  segmentGapMs?: number | null
  sourceVoiceId: string | null | undefined
  speakerMappings: SpeakerVoiceMapping[]
  text: string
}

export function buildRangeScriptSnapshot({
  assignments,
  segmentGapMs = null,
  sourceVoiceId,
  text,
}: BuildRangeScriptSnapshotInput): GeneratedAudioScriptSnapshot {
  return {
    version: 1,
    mode: "range",
    text,
    sourceVoiceId: sourceVoiceId || null,
    assignments: assignments.map(copyAssignment),
    dialogueBlocks: [],
    speakerMappings: [],
    segmentGapMs: normalizeSegmentGapMs(segmentGapMs),
  }
}

export function buildDialogueScriptSnapshot({
  dialogueBlocks,
  segmentGapMs = null,
  sourceVoiceId,
  speakerMappings,
  text,
}: BuildDialogueScriptSnapshotInput): GeneratedAudioScriptSnapshot {
  return {
    version: 1,
    mode: "dialogue",
    text,
    sourceVoiceId: sourceVoiceId || null,
    assignments: [],
    dialogueBlocks: dialogueBlocks.map(copyDialogueBlock),
    speakerMappings: speakerMappings.map(copySpeakerMapping),
    segmentGapMs: normalizeSegmentGapMs(segmentGapMs),
  }
}

function copyAssignment(assignment: VoiceTextAssignment): GeneratedAudioScriptSnapshotAssignment {
  return {
    id: assignment.id,
    start: assignment.start,
    end: assignment.end,
    text: assignment.text,
    sourceText: assignment.sourceText,
    voiceId: assignment.voiceId,
    voiceName: assignment.voiceName,
  }
}

function copyDialogueBlock(block: MultiVoiceScriptBlock): GeneratedAudioScriptSnapshotDialogueBlock {
  return {
    id: block.id,
    speakerLabel: block.speakerLabel,
    text: block.text,
    voiceId: block.voiceId,
    voiceName: block.voiceName ?? null,
    voiceSettings: block.voiceSettings ? { ...block.voiceSettings } : null,
  }
}

function copySpeakerMapping(mapping: SpeakerVoiceMapping): GeneratedAudioScriptSnapshotSpeakerMapping {
  return {
    speakerLabel: mapping.speakerLabel,
    voiceId: mapping.voiceId,
  }
}

function normalizeSegmentGapMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.round(value))
}
