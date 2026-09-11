import type { MultiVoiceScriptBlock, SpeakerVoiceMapping } from "@/lib/dialogue-script"
import type { GeneratedAudioScriptSnapshot, UserTuningPreset, VoiceTuningValues } from "@/types"

export const DIALOGUE_DRAFT_KEY = "voice-cloning.dialogueDraft.v1"
export type StoredSpeechContext = {
  dialogueId: string
  providerId: string | null
  defaultVoice: { id: string; name: string }
  modelId: string | null
  backendDefaultModelId: string | null
  tuning: VoiceTuningValues
  scriptSnapshot: GeneratedAudioScriptSnapshot
  selectedTuningPresetId: string
  selectedUserTuningPreset: UserTuningPreset | null
  storageLimitBytes: number
}
export type StoredSpeechRun = { jobId: string; context: StoredSpeechContext }
export type DialogueSpeechRecovery = { active: StoredSpeechRun | null; successful: StoredSpeechRun | null; resultId: string | null }
export type DialogueDraft = {
  identity: string
  sourceText: string
  sourceExpanded: boolean
  blocks: MultiVoiceScriptBlock[]
  speakerMappings: SpeakerVoiceMapping[]
  sourceVoiceId: string | null
  providerId: string | null
  modelId: string
  selectedUserTuningPresetId: string | null
  naturalHandoffs: boolean
  speech: DialogueSpeechRecovery
}
export type DialogueDraftEnvelope = { version: 1; writerId: string; revision: string; draft: DialogueDraft }

export function readDialogueDraft(): { envelope: DialogueDraftEnvelope | null; error: string | null } {
  try { return { envelope: parseDialogueDraft(localStorage.getItem(DIALOGUE_DRAFT_KEY)), error: null } }
  catch { return { envelope: null, error: "The saved dialogue draft could not be read. Your current work is still available." } }
}

export function parseDialogueDraft(raw: string | null): DialogueDraftEnvelope | null {
  if (!raw) return null
  if (raw.length > 2_000_000) throw new Error("Draft is too large")
  const value: unknown = JSON.parse(raw)
  if (!record(value) || value.version !== 1 || !string(value.writerId) || !string(value.revision) || !draft(value.draft)) throw new Error("Invalid dialogue draft")
  return value as DialogueDraftEnvelope
}

function draft(value: unknown): value is DialogueDraft {
  return record(value) && string(value.identity) && string(value.sourceText) && typeof value.sourceExpanded === "boolean" &&
    Array.isArray(value.blocks) && value.blocks.every(block) && new Set(value.blocks.map(b => b.id)).size === value.blocks.length &&
    Array.isArray(value.speakerMappings) && value.speakerMappings.every(mapping) && nullableString(value.sourceVoiceId) && nullableString(value.providerId) &&
    string(value.modelId) && nullableString(value.selectedUserTuningPresetId) && typeof value.naturalHandoffs === "boolean" &&
    record(value.speech) && run(value.speech.active) && run(value.speech.successful) && nullableString(value.speech.resultId)
}
function run(value: unknown): boolean {
  return value === null || (record(value) && /^[A-Za-z0-9_-]+$/.test(String(value.jobId)) && string(value.jobId) && context(value.context))
}
function context(value: unknown): boolean {
  if (!record(value)) return false
  return string(value.dialogueId) && nullableString(value.providerId) && record(value.defaultVoice) && string(value.defaultVoice.id) && string(value.defaultVoice.name) &&
    nullableString(value.modelId) && nullableString(value.backendDefaultModelId) && tuning(value.tuning) && snapshot(value.scriptSnapshot) &&
    string(value.selectedTuningPresetId) && Number.isFinite(value.storageLimitBytes) && Number(value.storageLimitBytes) > 0 && preset(value.selectedUserTuningPreset)
}
function preset(value: unknown): boolean {
  return value === null || (record(value) && string(value.id) && string(value.name) && string(value.providerId) && nullableString(value.voicePresetId) && tuning(value.settings) && string(value.createdAt) && string(value.updatedAt))
}
function snapshot(value: unknown): boolean {
  return record(value) && value.version === 1 && value.mode === "dialogue" && string(value.text) && nullableString(value.sourceVoiceId) &&
    Array.isArray(value.assignments) && value.assignments.length === 0 && Array.isArray(value.dialogueBlocks) && value.dialogueBlocks.every(block) &&
    Array.isArray(value.speakerMappings) && value.speakerMappings.every(mapping) && (value.segmentGapMs === null || (Number.isFinite(value.segmentGapMs) && Number(value.segmentGapMs) >= 0))
}
function block(value: unknown): value is MultiVoiceScriptBlock {
  return record(value) && string(value.id) && /^[A-Za-z0-9_-]+$/.test(value.id) && string(value.text) && nullableString(value.speakerLabel) && nullableString(value.voiceId) &&
    (value.voiceName === undefined || nullableString(value.voiceName)) && (value.voiceSettings == null || tuning(value.voiceSettings))
}
function mapping(value: unknown): value is SpeakerVoiceMapping { return record(value) && string(value.speakerLabel) && nullableString(value.voiceId) }
function tuning(value: unknown): boolean { return record(value) && Object.values(value).every(v => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) }
function nullableString(value: unknown): boolean { return value === null || string(value) }
function string(value: unknown): value is string { return typeof value === "string" }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
