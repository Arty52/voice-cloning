import { HardDrive, Trash2 } from "lucide-react"

import { GeneratedAudioItem } from "@/components/generated-audio-item"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loading } from "@/components/ui/loading"
import { MenuSelect } from "@/components/ui/menu-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
  GENERATED_AUDIO_STORAGE_LIMIT_PRESETS_BYTES,
  type GeneratedAudioUsage,
} from "@/lib/generated-audio-storage"
import { isTemporaryGeneratedAudioId } from "@/lib/generated-audio-view-model"
import { formatBytes, formatGeneratedAudioCountBadge } from "@/lib/formatters"
import type { GeneratedAudioMutation } from "@/hooks/use-generated-audio-library"
import type { AsyncStatus, GeneratedResult } from "@/types"

type GeneratedAudioPanelProps = {
  allItems: GeneratedResult[]
  items: GeneratedResult[]
  libraryStatus: AsyncStatus
  mutationStatus: GeneratedAudioMutation | null
  onClear: () => void
  onDelete: (id: string) => void
  onStorageLimitChange: (limitBytes: number) => void
  storageError: string | null
  storageLimitBytes: number
  usage: GeneratedAudioUsage | null
}

export function GeneratedAudioPanel({
  allItems,
  items,
  libraryStatus,
  mutationStatus,
  onClear,
  onDelete,
  onStorageLimitChange,
  storageError,
  storageLimitBytes,
  usage,
}: GeneratedAudioPanelProps) {
  const resolvedUsage = usage ?? {
    itemCount: allItems.length,
    limitBytes: storageLimitBytes || DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
    remainingBytes: storageLimitBytes || DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
    usedBytes: 0,
  }
  const usagePercent =
    resolvedUsage.limitBytes > 0 ? Math.min(100, Math.round((resolvedUsage.usedBytes / resolvedUsage.limitBytes) * 100)) : 0
  const savedItemCount =
    usage?.itemCount ?? allItems.filter((item) => !isTemporaryGeneratedAudioId(item.id)).length
  const temporaryItemCount = Math.max(0, allItems.length - savedItemCount)
  const itemCountBadge = formatGeneratedAudioCountBadge(savedItemCount, temporaryItemCount)
  const isLibraryLoading = libraryStatus === "idle" || libraryStatus === "loading"
  const isBusy = isLibraryLoading || mutationStatus !== null
  const mutationLabel = mutationStatus ? generatedAudioMutationLabel(mutationStatus) : null
  const hasGeneratedAudio = allItems.length > 0

  return (
    <section aria-busy={isBusy} className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Generated Audio Archive</h2>
          <p className="mt-1 text-sm text-muted-foreground">Saved in this browser for later playback and download.</p>
        </div>
        {itemCountBadge ? <Badge>{itemCountBadge}</Badge> : null}
      </div>

      {storageError ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
          {storageError}
        </div>
      ) : null}

      {mutationLabel ? (
        <div className="mb-4 flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
          <Loading text={mutationLabel} variant="secondary" />
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
              disabled={mutationStatus === "storage-limit"}
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

      {isLibraryLoading ? (
        <GeneratedAudioSkeletonList />
      ) : (
        <div className="flex flex-col gap-3">
          {hasGeneratedAudio ? (
            <div className="flex justify-end">
              <Button disabled={mutationStatus === "clear"} onClick={onClear} size="sm" type="button" variant="secondary">
                <Trash2 aria-hidden="true" className="size-4" />
                Clear All
              </Button>
            </div>
          ) : null}
          {items.length > 0 ? (
            items.map((item) => (
              <GeneratedAudioItem
                isDeleteDisabled={mutationStatus === "delete"}
                item={item}
                key={item.id}
                onDelete={onDelete}
              />
            ))
          ) : (
            <div className="rounded-md border border-dashed border-border bg-background/50 p-5 text-sm text-muted-foreground">
              {hasGeneratedAudio ? "No archived generated speech yet." : "No generated speech yet."}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function GeneratedAudioSkeletonList() {
  return (
    <div aria-label="Loading Generated Audio" className="flex flex-col gap-3" role="status">
      {[0, 1].map((item) => (
        <div aria-hidden="true" className="rounded-md border border-border bg-background/60 p-3" key={item}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-36 max-w-full" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-6 w-16 shrink-0" />
          </div>
          <Skeleton className="h-11 w-full" />
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

function generatedAudioMutationLabel(mutationStatus: GeneratedAudioMutation) {
  if (mutationStatus === "clear") {
    return "Clearing Audio"
  }
  if (mutationStatus === "delete") {
    return "Removing Audio"
  }
  return "Updating Storage"
}
