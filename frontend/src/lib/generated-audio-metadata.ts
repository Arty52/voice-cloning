import type {
  GeneratedAudioAdjustedSetting,
  GeneratedAudioTuningMetadata,
  ProviderTuningControl,
  ProviderTuningValue,
  VoiceProvider,
  VoiceTuningValues,
} from "@/types"

type BuildGeneratedAudioTuningMetadataInput = {
  provider: VoiceProvider | null | undefined
  selectedPresetId: string
  tuning: VoiceTuningValues
}

const NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
})

export function buildGeneratedAudioTuningMetadata({
  provider,
  selectedPresetId,
  tuning,
}: BuildGeneratedAudioTuningMetadataInput): GeneratedAudioTuningMetadata | null {
  if (!provider) {
    return null
  }

  const preset =
    selectedPresetId === "custom"
      ? null
      : provider.tuning.presets.find((candidate) => candidate.id === selectedPresetId) ?? null
  const adjustedSettings = provider.tuning.controls
    .map((control) => adjustedSettingForControl(control, provider.tuning.defaultValues, tuning))
    .filter((setting): setting is GeneratedAudioAdjustedSetting => setting !== null)

  return {
    adjustedSettings,
    mode: preset ? "preset" : adjustedSettings.length > 0 ? "custom" : "default",
    presetId: preset?.id ?? null,
    presetLabel: preset?.label ?? null,
    providerId: provider.id,
    providerLabel: provider.label,
  }
}

function adjustedSettingForControl(
  control: ProviderTuningControl,
  defaultValues: VoiceTuningValues,
  tuning: VoiceTuningValues
): GeneratedAudioAdjustedSetting | null {
  const nominalValue = defaultValues[control.id] ?? control.defaultValue
  const submittedValue = tuning[control.id] ?? nominalValue

  if (submittedValue === nominalValue) {
    return null
  }

  return {
    id: control.id,
    label: control.label,
    nominalValue,
    nominalValueLabel: formatTuningValue(control, nominalValue),
    value: submittedValue,
    valueLabel: formatTuningValue(control, submittedValue),
  }
}

function formatTuningValue(control: ProviderTuningControl, value: ProviderTuningValue) {
  if (control.type === "select") {
    return control.options?.find((option) => String(option.value) === String(value))?.label ?? String(value)
  }

  if (control.type === "toggle") {
    return value === true || value === "true" ? "On" : "Off"
  }

  if (typeof value === "number") {
    return NUMBER_FORMATTER.format(value)
  }

  return String(value)
}
