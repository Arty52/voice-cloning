import { useMemo } from "react"

import { resolveVoiceTuningState } from "@/lib/voice-tuning"
import type { ProviderTuningMetadata, VoiceAsset } from "@/types"

type UseVoiceTuningOptions = {
  activeProviderId: string | null
  providerTuning: ProviderTuningMetadata
  selectedVoice: VoiceAsset | null
}

export function useVoiceTuning({ activeProviderId, providerTuning, selectedVoice }: UseVoiceTuningOptions) {
  const tuningState = useMemo(
    () =>
      resolveVoiceTuningState({
        activeProviderId,
        providerTuning,
        voice: selectedVoice,
      }),
    [activeProviderId, providerTuning, selectedVoice]
  )

  return {
    selectedTuningPresetId: tuningState.selectedPresetId,
    tuning: tuningState.values,
  }
}
