import { Field, FieldLabel } from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { VoicePreset, VoicePresetId } from "@/types"

type VoicePresetToggleGroupProps = {
  disabled?: boolean
  id: string
  label: string
  onChange: (value: VoicePresetId) => void
  value: VoicePresetId
  voicePresets: VoicePreset[]
}

export function VoicePresetToggleGroup({
  disabled = false,
  id,
  label,
  onChange,
  value,
  voicePresets,
}: VoicePresetToggleGroupProps) {
  const labelId = `${id}-label`

  return (
    <Field>
      <FieldLabel id={labelId}>{label}</FieldLabel>
      <ToggleGroup
        aria-labelledby={labelId}
        className="grid w-full grid-cols-1 rounded-md border border-border bg-background/60 p-1 sm:grid-cols-2"
        disabled={disabled}
        onValueChange={(nextValue) => {
          if (isPresetId(nextValue, voicePresets)) {
            onChange(nextValue)
          }
        }}
        type="single"
        value={value}
        variant="default"
      >
        {voicePresets.map((preset) => (
          <ToggleGroupItem
            className="h-auto min-h-16 flex-col items-start gap-1 rounded px-3 py-2 text-left data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
            key={preset.id}
            value={preset.id}
          >
            <span className="text-sm font-medium">{preset.label}</span>
            <span className="text-xs leading-5 text-muted-foreground">{preset.description}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  )
}

function isPresetId(value: string, voicePresets: VoicePreset[]): value is VoicePresetId {
  return voicePresets.some((preset) => preset.id === value)
}
