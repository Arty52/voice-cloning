import { Badge } from "@/components/ui/badge"
import { TuningInfo } from "@/components/tuning-info"
import { SLIDERS, TUNING_PRESETS } from "@/constants"
import { cn } from "@/lib/utils"
import type { SliderConfig, TuningPreset, TuningPresetId, VoiceTuning } from "@/types"

type VoiceTuningPanelProps = {
  isGenerating: boolean
  onPresetApply: (preset: TuningPreset) => void
  onSpeakerBoostChange: (checked: boolean) => void
  onTuningValueChange: (key: SliderConfig["id"], value: string) => void
  selectedTuningPreset: TuningPresetId
  tuning: VoiceTuning
}

export function VoiceTuningPanel({
  isGenerating,
  onPresetApply,
  onSpeakerBoostChange,
  onTuningValueChange,
  selectedTuningPreset,
  tuning,
}: VoiceTuningPanelProps) {
  return (
    <section className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Voice Tuning</h2>
          <p className="mt-1 text-sm text-muted-foreground">Adjust ElevenLabs voice settings before generating.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedTuningPreset === "custom" ? <Badge>Custom</Badge> : null}
          <Badge>Per Request</Badge>
        </div>
      </div>
      <div className="mb-4 space-y-2">
        <div className="text-sm font-medium">Preset</div>
        <div
          aria-label="Voice tuning presets"
          className="grid gap-1 rounded-md border border-border bg-background/60 p-1 sm:grid-cols-2"
          role="group"
        >
          {TUNING_PRESETS.map((preset) => {
            const isSelected = selectedTuningPreset === preset.id
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
      <div className="grid gap-4 sm:grid-cols-2">
        {SLIDERS.map((slider) => (
          <div className="space-y-2" key={slider.id}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-1.5">
                <label className="font-medium" htmlFor={slider.id}>
                  {slider.label}
                </label>
                <TuningInfo description={slider.help} id={slider.id} label={slider.label} />
              </div>
              <span className="font-mono text-xs text-muted-foreground">{tuning[slider.id].toFixed(2)}</span>
            </div>
            <input
              className="h-2 w-full accent-primary"
              disabled={isGenerating}
              id={slider.id}
              max={slider.max}
              min={slider.min}
              onChange={(event) => onTuningValueChange(slider.id, event.target.value)}
              step={slider.step}
              type="range"
              value={tuning[slider.id]}
            />
          </div>
        ))}
      </div>
      <label className="mt-4 flex items-center justify-between gap-4 rounded-md border border-border bg-background/60 p-3 text-sm">
        <span className="font-medium">Speaker Boost</span>
        <input
          checked={tuning.useSpeakerBoost}
          className="size-5 accent-primary"
          disabled={isGenerating}
          onChange={(event) => onSpeakerBoostChange(event.target.checked)}
          type="checkbox"
        />
      </label>
    </section>
  )
}
