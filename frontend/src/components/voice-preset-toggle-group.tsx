import { Field, FieldLabel } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
          <Tooltip key={preset.id}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                className="h-10 min-w-0 rounded border border-transparent px-3 text-center text-sm font-medium text-muted-foreground aria-checked:border-primary/60 aria-checked:bg-primary/10 aria-checked:text-foreground aria-checked:shadow-sm aria-checked:ring-1 aria-checked:ring-primary/30 aria-checked:hover:bg-primary/10"
                value={preset.id}
              >
                <span className="min-w-0 truncate">{preset.label}</span>
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent className="max-w-64" side="top" sideOffset={6}>
              <div className="flex flex-col gap-1">
                <span className="font-medium">{preset.label}</span>
                <span>{preset.description}</span>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </Field>
  )
}

function isPresetId(value: string, voicePresets: VoicePreset[]): value is VoicePresetId {
  return voicePresets.some((preset) => preset.id === value)
}
