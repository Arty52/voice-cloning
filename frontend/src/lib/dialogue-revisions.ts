import type { GeneratedAudioScriptSnapshot, SpeechJob, VoiceTuningValues } from "@/types"
import type { SpeechJobSegmentDraft } from "@/lib/voice-assignments"
import { voiceTuningValuesEqual } from "@/lib/voice-tuning"

export type DialogueBaseline = {
  dialogueId: string
  job: SpeechJob
  providerId: string | null
  modelId: string | null
  tuning: VoiceTuningValues
  scriptSnapshot: GeneratedAudioScriptSnapshot
}

export function dialogueRevisionState({ dialogueId, baseline, segments, providerId, modelId, tuning, defaults, naturalHandoffs }: {
  dialogueId: string
  baseline: DialogueBaseline | null
  segments: SpeechJobSegmentDraft[]
  providerId: string | null
  modelId: string | null
  tuning: VoiceTuningValues
  defaults: VoiceTuningValues
  naturalHandoffs: boolean
}) {
  let fullGenerationReason: string | null = null
  const linked = baseline?.dialogueId === dialogueId
  if (baseline && !linked) fullGenerationReason = "The imported script changed. Generate all rows to create a new recording."
  else if (baseline && (baseline.providerId !== providerId || baseline.modelId !== modelId)) fullGenerationReason = "The provider or model changed. Generate all rows to use these settings."
  else if (baseline && (segments.length !== baseline.job.segments.length || segments.some((s, i) => s.clientSegmentId !== baseline.job.segments[i].id))) fullGenerationReason = "The dialogue structure changed. Generate all rows to rebuild the recording."
  const canRevise = Boolean(baseline && linked && !fullGenerationReason)
  const changedIds = canRevise ? segments.filter((segment, i) => {
    const previous = baseline!.job.segments[i]
    return segment.text.trim() !== previous.text.trim() || segment.voiceId !== previous.voiceId || !voiceTuningValuesEqual(
      { ...defaults, ...(segment.voiceSettings ?? tuning) },
      { ...defaults, ...(previous.voiceSettings ?? baseline!.tuning) },
    )
  }).map(s => s.clientSegmentId!) : []
  const spacingChanged = Boolean(canRevise && naturalHandoffs !== (baseline!.job.segmentGapMs > 0))
  return { canRevise, changedIds, fullGenerationReason, linked, spacingChanged }
}

/** Only selected rows enter the recording snapshot; unrelated draft edits stay in the editor. */
export function revisionScriptSnapshot(base: GeneratedAudioScriptSnapshot, draft: GeneratedAudioScriptSnapshot, ids: string[]) {
  const selected = new Set(ids)
  const draftBlocks = new Map(draft.dialogueBlocks.map(block => [block.id, block]))
  return {
    ...base,
    dialogueBlocks: base.dialogueBlocks.map(block => selected.has(block.id) ? draftBlocks.get(block.id) ?? block : block),
  }
}
