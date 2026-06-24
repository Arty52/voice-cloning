import { ChevronDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { VoiceTuningControls } from "@/components/voice-tuning-controls"
import { cn } from "@/lib/utils"
import type {
  ProviderTuningControl,
  ProviderTuningPreset,
  ProviderTuningValue,
  VoiceTuningValues,
} from "@/types"

type VoiceTuningPanelProps = {
  controls: ProviderTuningControl[]
  isExpanded: boolean
  isGenerating: boolean
  isLoading: boolean
  onExpandedChange: (isExpanded: boolean) => void
  onPresetApply: (preset: ProviderTuningPreset) => void
  onTuningValueChange: (control: ProviderTuningControl, value: ProviderTuningValue) => void
  presets: ProviderTuningPreset[]
  selectedTuningPresetId: string
  tuning: VoiceTuningValues
}

export function VoiceTuningPanel({
  controls,
  isExpanded,
  isGenerating,
  isLoading,
  onExpandedChange,
  onPresetApply,
  onTuningValueChange,
  presets,
  selectedTuningPresetId,
  tuning,
}: VoiceTuningPanelProps) {
  if (controls.length === 0) {
    return isLoading ? <VoiceTuningSkeleton /> : null
  }

  const controlsId = "voice-tuning-controls"

  return (
    <Collapsible asChild onOpenChange={onExpandedChange} open={isExpanded}>
      <section aria-busy={isLoading} className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-medium">Voice Tuning</h2>
            <p className="mt-1 text-sm text-muted-foreground">Adjust provider voice settings before generating.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedTuningPresetId === "custom" ? <Badge>Custom</Badge> : null}
            <Badge>Per Request</Badge>
            <CollapsibleTrigger asChild>
              <Button aria-controls={controlsId} size="sm" type="button" variant="secondary">
                {isExpanded ? "Hide Controls" : "Show Controls"}
                <ChevronDown
                  aria-hidden="true"
                  className={cn("transition-transform", isExpanded && "rotate-180")}
                  data-icon="inline-end"
                />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent id={controlsId}>
          <div className="mt-4 flex flex-col gap-4">
            {presets.length > 0 ? (
              <div className="flex flex-col gap-2">
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
            <VoiceTuningControls
              controls={controls}
              disabled={isGenerating}
              idPrefix="voice-tuning"
              onTuningValueChange={onTuningValueChange}
              tuning={tuning}
            />
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function VoiceTuningSkeleton() {
  return (
    <section aria-busy="true" className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-6 w-20 shrink-0" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2" aria-label="Loading Voice Tuning" role="status">
        {[0, 1, 2, 3].map((item) => (
          <div aria-hidden="true" className="flex flex-col gap-2" key={item}>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </div>
    </section>
  )
}
