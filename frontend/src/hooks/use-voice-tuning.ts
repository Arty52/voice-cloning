import { useMemo, useState } from "react"

import {
  CUSTOM_TUNING_PRESET_ID,
  presetValues,
  resolveVoiceTuningState,
} from "@/lib/voice-tuning"
import type {
  ProviderTuningControl,
  ProviderTuningMetadata,
  ProviderTuningPreset,
  ProviderTuningValue,
  VoiceAsset,
  VoiceTuningValues,
} from "@/types"

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
    () => ({
      scopeKey,
      ...resolveVoiceTuningState({
        activeProviderId,
        providerTuning,
        voice: selectedVoice,
      }),
    }),
    [activeProviderId, providerTuning, scopeKey, selectedVoice]
  )
  const activeTuningState = tuningState?.scopeKey === scopeKey ? tuningState : defaultTuningState

  function handleTuningValueChange(control: ProviderTuningControl, value: ProviderTuningValue) {
    setTuningState((current) => {
      const currentValues = current?.scopeKey === scopeKey ? current.values : defaultTuningState.values
      return {
        scopeKey,
        selectedPresetId: CUSTOM_TUNING_PRESET_ID,
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

function tuningScopeKey(activeProviderId: string | null, selectedVoice: VoiceAsset | null) {
  const savedProviderTuning =
    activeProviderId && selectedVoice ? selectedVoice.voiceSettingsByProvider[activeProviderId] ?? null : null
  return [
    activeProviderId ?? "none",
    selectedVoice?.id ?? "none",
    selectedVoice?.voicePresetId ?? "none",
    JSON.stringify(savedProviderTuning),
  ].join(":")
}
