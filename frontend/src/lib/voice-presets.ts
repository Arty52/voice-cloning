import type { VoicePreset, VoicePresetId } from "@/types"

export const DEFAULT_VOICE_PRESET_ID: VoicePresetId = "standardNarration"

export const FALLBACK_VOICE_PRESETS: VoicePreset[] = [
  {
    id: "standardNarration",
    label: "Standard Narration",
    description: "Balanced clone similarity for steady narration.",
  },
  {
    id: "animatedDialogue",
    label: "Animated Dialogue",
    description: "More expressive delivery for character reads.",
  },
]

export function normalizeVoicePresets(value: unknown): VoicePreset[] {
  if (!Array.isArray(value)) {
    return FALLBACK_VOICE_PRESETS
  }
  const presets = value.filter(isVoicePreset)
  return presets.length > 0 ? presets : FALLBACK_VOICE_PRESETS
}

export function voicePresetLabel(voicePresets: VoicePreset[], voicePresetId: VoicePresetId) {
  return voicePresets.find((preset) => preset.id === voicePresetId)?.label ?? voicePresetId
}

function isVoicePreset(value: unknown): value is VoicePreset {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const preset = value as Partial<VoicePreset>
  return (
    (preset.id === "standardNarration" || preset.id === "animatedDialogue") &&
    typeof preset.label === "string" &&
    typeof preset.description === "string"
  )
}
