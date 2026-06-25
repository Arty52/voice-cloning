import { DEFAULT_VOICE_PRESET_ID } from "@/lib/voice-presets"
import type {
  ProviderTuningMetadata,
  ProviderTuningPreset,
  VoiceAsset,
  VoicePresetId,
  VoiceTuningValues,
} from "@/types"

export const CUSTOM_TUNING_PRESET_ID = "custom"

export type ResolvedVoiceTuningState = {
  selectedPresetId: string
  values: VoiceTuningValues
}

export function resolveVoiceTuningState({
  activeProviderId,
  providerTuning,
  voice,
}: {
  activeProviderId: string | null
  providerTuning: ProviderTuningMetadata
  voice: Pick<VoiceAsset, "voicePresetId" | "voiceSettingsByProvider"> | null
}): ResolvedVoiceTuningState {
  const savedProviderTuning = activeProviderId ? voice?.voiceSettingsByProvider[activeProviderId] : null
  if (savedProviderTuning) {
    return {
      selectedPresetId: CUSTOM_TUNING_PRESET_ID,
      values: savedProviderTuning,
    }
  }

  return resolvePresetVoiceTuningState({
    providerTuning,
    voicePresetId: voice?.voicePresetId ?? DEFAULT_VOICE_PRESET_ID,
  })
}

export function resolvePresetVoiceTuningState({
  providerTuning,
  voicePresetId,
}: {
  providerTuning: ProviderTuningMetadata
  voicePresetId: VoicePresetId
}): ResolvedVoiceTuningState {
  const voicePreset = providerTuning.presets.find((preset) => preset.voicePresetId === voicePresetId)
  if (voicePreset) {
    return {
      selectedPresetId: voicePreset.id,
      values: presetValues(providerTuning, voicePreset),
    }
  }

  const defaultValues = providerTuning.defaultValues ?? {}
  return {
    selectedPresetId: findMatchingPresetId(providerTuning.presets, defaultValues) ?? CUSTOM_TUNING_PRESET_ID,
    values: defaultValues,
  }
}

export function resolveSavedVoiceTuning(
  activeProviderId: string | null,
  voice: Pick<VoiceAsset, "voiceSettingsByProvider"> | null
) {
  return activeProviderId ? voice?.voiceSettingsByProvider[activeProviderId] ?? null : null
}

export function presetValues(providerTuning: ProviderTuningMetadata, preset: ProviderTuningPreset): VoiceTuningValues {
  return {
    ...(providerTuning.defaultValues ?? {}),
    ...preset.values,
  }
}

export function voiceTuningValuesEqual(
  left: VoiceTuningValues | null | undefined,
  right: VoiceTuningValues | null | undefined
) {
  if (!left && !right) {
    return true
  }
  if (!left || !right) {
    return false
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false
    }
  }
  return true
}

function findMatchingPresetId(presets: ProviderTuningPreset[], values: VoiceTuningValues) {
  return presets.find((preset) => voiceTuningValuesEqual(preset.values, values))?.id ?? null
}
