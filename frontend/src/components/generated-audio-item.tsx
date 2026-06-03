import { Download, Trash2 } from "lucide-react"

import { AudioPlayer } from "@/components/audio-player"
import { GeneratedAudioMetadata } from "@/components/generated-audio-metadata"
import { GeneratedAudioSizeBadge } from "@/components/generated-audio-size-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatNumber } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import type { GeneratedResult } from "@/types"

type GeneratedAudioItemProps = {
  badge?: string
  className?: string
  isDeleteDisabled?: boolean
  item: GeneratedResult
  onDelete: (id: string) => void
}

export function GeneratedAudioItem({
  badge,
  className,
  isDeleteDisabled = false,
  item,
  onDelete,
}: GeneratedAudioItemProps) {
  return (
    <div className={cn("rounded-md border border-border bg-background/60 p-3", className)}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.voiceName}</div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">Voice {item.voiceId}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {badge ? <Badge>{badge}</Badge> : null}
          <Badge>{item.cacheState === "hit" ? "Cache Hit" : "Cache Miss"}</Badge>
        </div>
      </div>
      <GeneratedAudioMetadata generationElapsedMs={item.generationElapsedMs} tuningMetadata={item.tuningMetadata} />
      <AudioPlayer ariaLabel={`Generated voice playback for ${item.voiceName}`} src={item.url} />
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <span className="truncate font-mono">Model {item.modelId}</span>
        <span>
          {item.characterCount === null ? "Generated" : `${formatNumber(item.characterCount)} chars`}{" "}
          {item.generatedAt}
        </span>
        <GeneratedAudioSizeBadge sizeBytes={item.sizeBytes} />
      </div>
      {item.requestId ? (
        <div className="mt-2 truncate font-mono text-xs text-muted-foreground">Request {item.requestId}</div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          download={`voice-clone-${item.appVoiceId}-${item.id}.mp3`}
          href={item.url}
        >
          <Download aria-hidden="true" className="size-4" />
          Download
        </a>
        <Button
          aria-label={`Remove generated audio for ${item.voiceName}`}
          disabled={isDeleteDisabled}
          onClick={() => onDelete(item.id)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Remove
        </Button>
      </div>
    </div>
  )
}
