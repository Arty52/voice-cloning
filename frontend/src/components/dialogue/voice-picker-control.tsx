import type { ReactNode } from "react"
import { VoicePicker } from "@/components/voice-picker"
import type { VoicePickerPreview } from "@/hooks/use-voice-picker-preview"
import type { VoiceAsset } from "@/types"

type VoicePickerControlProps = {
  description: string
  disabled: boolean
  disabledTooltip?: string | null
  onSelect: (voice: VoiceAsset) => void
  preview: VoicePickerPreview
  selectedVoiceId?: string
  title: string
  triggerIcon: ReactNode
  triggerLabel: string
  voices: VoiceAsset[]
}

export function VoicePickerControl({
  description,
  disabled,
  disabledTooltip,
  onSelect,
  preview,
  selectedVoiceId,
  title,
  triggerIcon,
  triggerLabel,
  voices,
}: VoicePickerControlProps) {
  return (
    <VoicePicker
      description={description}
      disabled={disabled}
      disabledTooltip={disabledTooltip}
      onSelect={(voiceId) => {
        const voice = voices.find((candidate) => candidate.id === voiceId)
        if (voice) {
          onSelect(voice)
        }
      }}
      options={preview.options}
      preview={preview}
      selectedVoiceId={selectedVoiceId}
      title={title}
      triggerIcon={triggerIcon}
      triggerLabel={triggerLabel}
    />
  )
}

