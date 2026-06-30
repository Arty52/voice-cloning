import { Check, Upload, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type PrepareAudioWorkflow = "addVoice" | "processAudio"

type PrepareAudioChoicePanelProps = {
  disabled: boolean
  onSelect: (workflow: PrepareAudioWorkflow) => void
  selectedWorkflow: PrepareAudioWorkflow | null
}

const PREPARE_AUDIO_OPTIONS: Array<{
  cta: string
  description: string
  icon: typeof Upload
  title: string
  value: PrepareAudioWorkflow
}> = [
  {
    cta: "Add Voice",
    description: "Upload or record a clean, ready-to-save voice sample.",
    icon: Upload,
    title: "Upload Ready Voice Sample",
    value: "addVoice",
  },
  {
    cta: "Process Source Media",
    description: "Extract usable speech from a longer audio or video source.",
    icon: Wand2,
    title: "Process Source Media",
    value: "processAudio",
  },
]

export function PrepareAudioChoicePanel({
  disabled,
  onSelect,
  selectedWorkflow,
}: PrepareAudioChoicePanelProps) {
  return (
    <section className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-base font-medium">Choose Audio Workflow</h2>
        <p className="text-sm text-muted-foreground">Start with the audio task that matches your source.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {PREPARE_AUDIO_OPTIONS.map((option) => {
          const Icon = option.icon
          const isSelected = selectedWorkflow === option.value
          return (
            <button
              aria-label={`${option.title}: ${option.cta}`}
              aria-pressed={isSelected}
              className={cn(
                "flex min-h-40 flex-col items-start justify-between gap-4 rounded-md border border-border bg-background/60 p-4 text-left outline-none transition-[background-color,box-shadow] hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                isSelected && "border-primary bg-primary/10 hover:bg-primary/10"
              )}
              disabled={disabled}
              key={option.value}
              onClick={() => onSelect(option.value)}
              type="button"
            >
              <span className="flex w-full items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                  <Icon aria-hidden="true" data-icon="inline-start" />
                  <span className="min-w-0">{option.title}</span>
                </span>
                {isSelected ? <Check aria-label="Selected prepare audio workflow" data-icon="inline-end" /> : null}
              </span>
              <span className="text-xs leading-5 text-muted-foreground">{option.description}</span>
              <Button asChild size="sm" variant={isSelected ? "primary" : "secondary"}>
                <span>{option.cta}</span>
              </Button>
            </button>
          )
        })}
      </div>
    </section>
  )
}
