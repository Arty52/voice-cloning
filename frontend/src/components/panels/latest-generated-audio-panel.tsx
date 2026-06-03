import { GeneratedAudioItem } from "@/components/generated-audio-item"
import { Badge } from "@/components/ui/badge"
import { Loading } from "@/components/ui/loading"
import { cn } from "@/lib/utils"
import type { GeneratedResult, RequestStatus } from "@/types"

type LatestGeneratedAudioPanelProps = {
  error: string | null
  isDeleteDisabled: boolean
  item: GeneratedResult | null
  onDelete: (id: string) => void
  status: RequestStatus
  storageError: string | null
}

export function LatestGeneratedAudioPanel({
  error,
  isDeleteDisabled,
  item,
  onDelete,
  status,
  storageError,
}: LatestGeneratedAudioPanelProps) {
  const isCanceled = status === "canceled"
  const isGenerating = status === "generating"

  if (!isGenerating && !error && !storageError && !item) {
    return null
  }

  return (
    <section aria-busy={isGenerating} className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Latest Generated Audio</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ready for playback as soon as generation finishes.</p>
        </div>
        {item ? <Badge>Latest</Badge> : null}
      </div>

      {error ? (
        <div
          className={cn(
            "mb-4 rounded-md border p-3 text-sm",
            isCanceled
              ? "border-border bg-background/60 text-muted-foreground"
              : "border-destructive/40 bg-destructive/10 text-foreground"
          )}
          role={isCanceled ? "status" : "alert"}
        >
          {error}
        </div>
      ) : null}

      {storageError ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
          {storageError}
        </div>
      ) : null}

      {isGenerating ? (
        <div className="rounded-md border border-border bg-background/60 p-3">
          <Loading text="Generating Speech" variant="secondary" />
        </div>
      ) : null}

      {item ? (
        <GeneratedAudioItem
          badge="Latest"
          className={isGenerating ? "mt-4" : undefined}
          isDeleteDisabled={isDeleteDisabled}
          item={item}
          onDelete={onDelete}
        />
      ) : null}
    </section>
  )
}
