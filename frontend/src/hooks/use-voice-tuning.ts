import { useMemo, useState } from "react"

import { DEFAULT_VOICE_PRESET_ID } from "@/lib/voice-presets"
import type {
  ProviderTuningControl,
  ProviderTuningMetadata,
  ProviderTuningPreset,
  ProviderTuningValue,
  VoiceAsset,
  VoicePresetId,
  VoiceTuningValues,
} from "@/types"

const CUSTOM_PRESET_ID = "custom"

type TuningState = {
  scopeKey: string
  selectedPresetId: string
  values: VoiceTuningValues
}

type UseVoiceTuningOptions = {
  activeProviderId: string | null
  providerTuning: ProviderTuningMetadata
  selectedVoice: VoiceAsset | null
}

export function useVoiceTuning({ activeProviderId, providerTuning, selectedVoice }: UseVoiceTuningOptions) {
  const [tuningState, setTuningState] = useState<TuningState | null>(null)
  const scopeKey = tuningScopeKey(activeProviderId, selectedVoice)
  const defaultTuningState = useMemo(
    () => buildDefaultTuningState(scopeKey, providerTuning, selectedVoice?.voicePresetId ?? DEFAULT_VOICE_PRESET_ID),
    [providerTuning, scopeKey, selectedVoice?.voicePresetId]
  )
  const activeTuningState = tuningState?.scopeKey === scopeKey ? tuningState : defaultTuningState

  function handleTuningValueChange(control: ProviderTuningControl, value: ProviderTuningValue) {
    setTuningState((current) => {
      const currentValues = current?.scopeKey === scopeKey ? current.values : defaultTuningState.values
      return {
        scopeKey,
        selectedPresetId: CUSTOM_PRESET_ID,
        values: {
          ...currentValues,
          [control.id]: value,
        },
      }
    })
  }

  function handlePresetApply(preset: ProviderTuningPreset) {
    setTuningState({
      scopeKey,
      selectedPresetId: preset.id,
      values: presetValues(providerTuning, preset),
    })
  }

  return {
    handlePresetApply,
    handleTuningValueChange,
    selectedTuningPresetId: activeTuningState.selectedPresetId,
    tuning: activeTuningState.values,
  }
}

function buildDefaultTuningState(
  scopeKey: string,
  providerTuning: ProviderTuningMetadata,
  voicePresetId: VoicePresetId
): TuningState {
  const voicePreset = providerTuning.presets.find((preset) => preset.voicePresetId === voicePresetId)
  if (voicePreset) {
    return {
      scopeKey,
      selectedPresetId: voicePreset.id,
      values: presetValues(providerTuning, voicePreset),
    }
  }

  const defaultValues = providerTuning.defaultValues ?? {}
  return {
    scopeKey,
    selectedPresetId: findMatchingPresetId(providerTuning.presets, defaultValues) ?? CUSTOM_PRESET_ID,
    values: defaultValues,
  }
}

function tuningScopeKey(activeProviderId: string | null, selectedVoice: VoiceAsset | null) {
  return [
    activeProviderId ?? "none",
    selectedVoice?.id ?? "none",
    selectedVoice?.voicePresetId ?? DEFAULT_VOICE_PRESET_ID,
  ].join(":")
}

function presetValues(providerTuning: ProviderTuningMetadata, preset: ProviderTuningPreset): VoiceTuningValues {
  return {
    ...(providerTuning.defaultValues ?? {}),
    ...preset.values,
  }
}

function findMatchingPresetId(presets: ProviderTuningPreset[], values: VoiceTuningValues) {
  return presets.find((preset) => tuningValuesMatch(preset.values, values))?.id ?? null
}

function tuningValuesMatch(left: VoiceTuningValues, right: VoiceTuningValues) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false
    }
  }
  return true
}
