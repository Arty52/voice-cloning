import { Badge } from "@/components/ui/badge"
import { TuningInfo } from "@/components/tuning-info"
import { cn } from "@/lib/utils"
import type {
  ProviderTuningControl,
  ProviderTuningPreset,
  ProviderTuningValue,
  VoiceTuningValues,
} from "@/types"

type VoiceTuningPanelProps = {
  controls: ProviderTuningControl[]
  isGenerating: boolean
  isLoading: boolean
  onPresetApply: (preset: ProviderTuningPreset) => void
  onTuningValueChange: (control: ProviderTuningControl, value: ProviderTuningValue) => void
  presets: ProviderTuningPreset[]
  selectedTuningPresetId: string
  tuning: VoiceTuningValues
}

export function VoiceTuningPanel({
  controls,
  isGenerating,
  isLoading,
  onPresetApply,
  onTuningValueChange,
  presets,
  selectedTuningPresetId,
  tuning,
}: VoiceTuningPanelProps) {
  if (controls.length === 0) {
    return null
  }

  return (
    <section aria-busy={isLoading} className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Voice Tuning</h2>
          <p className="mt-1 text-sm text-muted-foreground">Adjust provider voice settings before generating.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedTuningPresetId === "custom" ? <Badge>Custom</Badge> : null}
          <Badge>Per Request</Badge>
        </div>
      </div>
      {presets.length > 0 ? (
        <div className="mb-4 space-y-2">
          <div className="text-sm font-medium">Preset</div>
          <div
            aria-label="Voice tuning presets"
            className="grid gap-1 rounded-md border border-border bg-background/60 p-1 sm:grid-cols-2"
            role="group"
          >
            {presets.map((preset) => {
              const isSelected = selectedTuningPresetId === preset.id
              return (
                <button
                  aria-pressed={isSelected}
                  className={cn(
                    "rounded px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "bg-secondary text-secondary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  disabled={isGenerating}
                  key={preset.id}
                  onClick={() => onPresetApply(preset)}
                  type="button"
                >
                  <span className="block font-medium">{preset.label}</span>
                  <span className="mt-1 block text-xs leading-5">{preset.description}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {controls.map((control) => (
          <TuningControl
            control={control}
            disabled={isGenerating}
            key={control.id}
            onChange={onTuningValueChange}
            value={tuning[control.id] ?? control.defaultValue}
          />
        ))}
      </div>
    </section>
  )
}

function TuningControl({
  control,
  disabled,
  onChange,
  value,
}: {
  control: ProviderTuningControl
  disabled: boolean
  onChange: (control: ProviderTuningControl, value: ProviderTuningValue) => void
  value: ProviderTuningValue
}) {
  const controlId = `voice-tuning-${control.id}`

  if (control.type === "toggle") {
    return (
      <div
        className="flex items-center justify-between gap-4 rounded-md border border-border bg-background/60 p-3 text-sm"
      >
        <div className="flex items-center gap-1.5">
          <label className="font-medium" htmlFor={controlId} id={`${controlId}-label`}>
            {control.label}
          </label>
          <TuningInfo description={control.description} id={controlId} label={control.label} />
        </div>
        <input
          aria-labelledby={`${controlId}-label`}
          checked={value === true}
          className="size-5 accent-primary"
          disabled={disabled}
          id={controlId}
          onChange={(event) => onChange(control, event.target.checked)}
          type="checkbox"
        />
      </div>
    )
  }

  if (control.type === "select") {
    return (
      <div className="block space-y-2 text-sm font-medium">
        <div className="flex items-center gap-1.5">
          <label htmlFor={controlId} id={`${controlId}-label`}>
            {control.label}
          </label>
          <TuningInfo description={control.description} id={controlId} label={control.label} />
        </div>
        <select
          aria-labelledby={`${controlId}-label`}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          id={controlId}
          onChange={(event) => onChange(control, selectedOptionValue(control, event.target.value))}
          value={String(value)}
        >
          {(control.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const numericValue = typeof value === "number" ? value : Number(value)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-1.5">
          <label className="font-medium" htmlFor={controlId}>
            {control.label}
          </label>
          <TuningInfo description={control.description} id={controlId} label={control.label} />
        </div>
        <span className="font-mono text-xs text-muted-foreground">{numericValue.toFixed(2)}</span>
      </div>
      <input
        className="h-2 w-full accent-primary"
        disabled={disabled}
        id={controlId}
        max={control.max}
        min={control.min}
        onChange={(event) => onChange(control, Number(event.target.value))}
        step={control.step}
        type="range"
        value={Number.isNaN(numericValue) ? Number(control.defaultValue) || 0 : numericValue}
      />
      {control.capability ? <div className="text-xs text-muted-foreground">{control.capability}</div> : null}
    </div>
  )
}

function selectedOptionValue(control: ProviderTuningControl, selectedValue: string): ProviderTuningValue {
  const option = (control.options ?? []).find((candidate) => String(candidate.value) === selectedValue)
  return option ? option.value : selectedValue
}
