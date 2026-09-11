import type { StoredSpeechContext, StoredSpeechRun } from "@/lib/dialogue-draft"
import type { GeneratedAudioScriptSnapshot, SpeechJob, UserTuningPreset, VoiceAsset, VoiceProvider, VoiceTuningValues } from "@/types"

export type PersistContext = {
  dialogueId?: string
  providerId?: string | null
  backendDefaultModelId: string | null
  defaultVoice: Pick<VoiceAsset, "id" | "name">
  modelId: string | null
  provider: VoiceProvider | null
  scriptSnapshot: GeneratedAudioScriptSnapshot | null
  selectedTuningPresetId: string
  selectedUserTuningPreset: UserTuningPreset | null
  storageLimitBytes: number
  tuning: VoiceTuningValues
}
export type SuccessfulSpeechRun = { job: SpeechJob; context: PersistContext; resultId?: string }

export function speechResultId(job: SpeechJob) {
  const take = job.segments.reduce((sum, segment) => sum + segment.generationCount, 0)
  return `speech-${job.id}-${job.resultSha256}-${take}`
}

/** Persist references and submitted settings, never provider credentials or runtime audio. */
export function storeSpeechRun(jobId: string, context: PersistContext | null): StoredSpeechRun | null {
  if (!context?.dialogueId || context.scriptSnapshot?.mode !== "dialogue") return null
  return { jobId, context: {
    dialogueId: context.dialogueId,
    providerId: context.provider?.id ?? context.providerId ?? null,
    defaultVoice: { id: context.defaultVoice.id, name: context.defaultVoice.name },
    modelId: context.modelId, backendDefaultModelId: context.backendDefaultModelId,
    tuning: context.tuning, scriptSnapshot: context.scriptSnapshot,
    selectedTuningPresetId: context.selectedTuningPresetId, selectedUserTuningPreset: context.selectedUserTuningPreset,
    storageLimitBytes: context.storageLimitBytes,
  } }
}

export function restoreSpeechContext(context: StoredSpeechContext, providers: VoiceProvider[]): PersistContext {
  return { ...context, provider: providers.find(provider => provider.id === context.providerId) ?? null }
}
