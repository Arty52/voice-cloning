import { Download, HardDrive, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MenuSelect } from "@/components/ui/menu-select"
import {
  DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
  GENERATED_AUDIO_STORAGE_LIMIT_PRESETS_BYTES,
  type GeneratedAudioUsage,
} from "@/lib/generated-audio-storage"
import { isTemporaryGeneratedAudioId } from "@/lib/generated-audio-view-model"
import { formatBytes, formatGeneratedAudioCountBadge, formatNumber } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import type { GeneratedAudioMutation } from "@/hooks/use-generated-audio-library"
import type { AsyncStatus, GeneratedResult, RequestStatus } from "@/types"

type GeneratedAudioPanelProps = {
  error: string | null
  items: GeneratedResult[]
  libraryStatus: AsyncStatus
  mutationStatus: GeneratedAudioMutation | null
  onClear: () => void
  onDelete: (id: string) => void
  onStorageLimitChange: (limitBytes: number) => void
  status: RequestStatus
  storageError: string | null
  storageLimitBytes: number
  usage: GeneratedAudioUsage | null
}

export function GeneratedAudioPanel({
  error,
  items,
  libraryStatus,
  mutationStatus,
  onClear,
  onDelete,
  onStorageLimitChange,
  status,
  storageError,
  storageLimitBytes,
  usage,
}: GeneratedAudioPanelProps) {
  const isCanceled = status === "canceled"
  const resolvedUsage = usage ?? {
    itemCount: items.length,
    limitBytes: storageLimitBytes || DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
    remainingBytes: storageLimitBytes || DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
    usedBytes: 0,
  }
  const usagePercent =
    resolvedUsage.limitBytes > 0 ? Math.min(100, Math.round((resolvedUsage.usedBytes / resolvedUsage.limitBytes) * 100)) : 0
  const savedItemCount =
    usage?.itemCount ?? items.filter((item) => !isTemporaryGeneratedAudioId(item.id)).length
  const temporaryItemCount = Math.max(0, items.length - savedItemCount)
  const itemCountBadge = formatGeneratedAudioCountBadge(savedItemCount, temporaryItemCount)
  const isBusy = libraryStatus === "idle" || libraryStatus === "loading" || mutationStatus !== null

  return (
    <section aria-busy={isBusy} className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Generated Audio</h2>
          <p className="mt-1 text-sm text-muted-foreground">Saved in this browser for playback and download.</p>
        </div>
        {itemCountBadge ? <Badge>{itemCountBadge}</Badge> : null}
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

      <div className="mb-4 rounded-md border border-border bg-background/60 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <HardDrive aria-hidden="true" className="size-4 text-primary" />
              Browser Storage
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {formatBytes(resolvedUsage.usedBytes)} / {formatBytes(resolvedUsage.limitBytes)}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>Cap</span>
            <MenuSelect
              ariaLabel="Cap"
              onChange={(value) => onStorageLimitChange(Number(value))}
              options={GENERATED_AUDIO_STORAGE_LIMIT_PRESETS_BYTES.map((limitBytes) => ({
                label: formatBytes(limitBytes),
                value: String(limitBytes),
              }))}
              value={String(storageLimitBytes)}
            />
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${usagePercent}%` }} />
        </div>
      </div>

      {items.length > 0 ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={onClear} size="sm" type="button" variant="secondary">
              <Trash2 aria-hidden="true" className="size-4" />
              Clear All
            </Button>
          </div>
          {items.map((item, index) => (
            <div className="rounded-md border border-border bg-background/60 p-3" key={item.id}>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{item.voiceName}</div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">Voice {item.voiceId}</div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {index === 0 ? <Badge>Latest</Badge> : null}
                  <Badge>{item.cacheState === "hit" ? "Cache Hit" : "Cache Miss"}</Badge>
                </div>
              </div>
              <audio aria-label={`Generated voice playback for ${item.voiceName}`} controls src={item.url} />
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <span className="truncate font-mono">Model {item.modelId}</span>
                <span>
                  {item.characterCount === null ? "Generated" : `${formatNumber(item.characterCount)} chars`}{" "}
                  {item.generatedAt}
                </span>
                <span className="font-mono">{formatBytes(item.sizeBytes)}</span>
              </div>
              {item.requestId ? <div className="mt-2 truncate font-mono text-xs text-muted-foreground">Request {item.requestId}</div> : null}
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
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-background/50 p-5 text-sm text-muted-foreground">
          No generated speech yet.
        </div>
      )}
    </section>
  )
}
