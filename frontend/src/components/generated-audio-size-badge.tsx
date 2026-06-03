import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { buildGeneratedAudioSizeDisplay } from "@/lib/generated-audio-view-model"

type GeneratedAudioSizeBadgeProps = {
  sizeBytes: number
}

export function GeneratedAudioSizeBadge({ sizeBytes }: GeneratedAudioSizeBadgeProps) {
  const display = buildGeneratedAudioSizeDisplay(sizeBytes)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          aria-label={display.ariaLabel}
          className="w-fit cursor-help font-mono tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          variant="accent"
        >
          {display.visibleLabel}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{display.detailLabel}</span>
          <span className="font-mono tabular-nums opacity-80">{display.exactLabel}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
