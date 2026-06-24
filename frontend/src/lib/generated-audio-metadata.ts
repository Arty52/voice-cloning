import type {
  GeneratedAudioAdjustedSetting,
  GeneratedAudioMultiVoiceMetadata,
  GeneratedAudioTuningMetadata,
  ProviderTuningControl,
  ProviderTuningValue,
  SpeechJob,
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

export function buildGeneratedAudioMultiVoiceMetadata(job: SpeechJob): GeneratedAudioMultiVoiceMetadata {
  const voiceCounts = new Map<string, { segmentCount: number; voiceId: string; voiceName: string }>()
  for (const segment of job.segments) {
    const current = voiceCounts.get(segment.voiceId)
    if (current) {
      current.segmentCount += 1
    } else {
      voiceCounts.set(segment.voiceId, {
        segmentCount: 1,
        voiceId: segment.voiceId,
        voiceName: segment.voiceName,
      })
    }
  }

  return {
    jobId: job.id,
    resultSha256: job.resultSha256,
    segmentCount: job.segments.length,
    segments: job.segments.map((segment) => ({
      assignmentKind: segment.assignmentKind,
      characterCount: segment.characterCount,
      generationCount: segment.generationCount,
      id: segment.id,
      index: segment.index,
      resultSha256: segment.resultSha256,
      text: segment.text,
      voiceId: segment.voiceId,
      voiceName: segment.voiceName,
      voiceSettings: segment.voiceSettings,
    })),
    voices: Array.from(voiceCounts.values()),
  }
}

function adjustedSettingForControl(
  control: ProviderTuningControl,
  defaultValues: VoiceTuningValues,
  tuning: VoiceTuningValues
): GeneratedAudioAdjustedSetting | null {
  const nominalValue = defaultValues[control.id] ?? control.defaultValue
  const submittedValue = tuning[control.id] ?? nominalValue

  if (tuningValuesEquivalent(control, submittedValue, nominalValue)) {
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

function tuningValuesEquivalent(
  control: ProviderTuningControl,
  left: ProviderTuningValue,
  right: ProviderTuningValue
) {
  return comparisonValue(control, left) === comparisonValue(control, right)
}

function comparisonValue(control: ProviderTuningControl, value: ProviderTuningValue) {
  if (control.type === "toggle") {
    return value === true || value === "true"
  }

  if (control.type === "slider") {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : String(value)
  }

  return String(value)
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
