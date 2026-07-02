import { CircleHelp, HardDrive, RefreshCw, Trash2, Upload } from "lucide-react"

import { GeneratedAudioItem } from "@/components/generated-audio-item"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MenuSelect } from "@/components/ui/menu-select"
import { PendingWorkStatus } from "@/components/ui/pending-work-status"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
  GENERATED_AUDIO_STORAGE_LIMIT_PRESETS_BYTES,
  type GeneratedAudioUsage,
} from "@/lib/generated-audio-storage"
import type { GeneratedAudioServerExportItem, GeneratedAudioServerExportStatus } from "@/lib/generated-audio-export-api"
import { isTemporaryGeneratedAudioId } from "@/lib/generated-audio-view-model"
import { formatBytes, formatGeneratedAudioCountBadge } from "@/lib/formatters"
import type {
  GeneratedAudioMutation,
  GeneratedAudioPersistenceMode,
  GeneratedAudioServerExportMutation,
} from "@/hooks/use-generated-audio-library"
import type { AsyncStatus, GeneratedResult } from "@/types"

type GeneratedAudioPanelProps = {
  allItems: GeneratedResult[]
  items: GeneratedResult[]
  libraryStatus: AsyncStatus
  mutationStatus: GeneratedAudioMutation | null
  onClear: () => void
  onDelete: (id: string) => void
  onServerExport: (id: string) => void
  onServerExportAll: () => void
  onServerExportStatusRefresh: () => void
  onStorageLimitChange: (limitBytes: number) => void
  persistenceMode: GeneratedAudioPersistenceMode
  serverExportError: string | null
  serverExportMutation: GeneratedAudioServerExportMutation | null
  serverExportStatus: GeneratedAudioServerExportStatus | null
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
  onServerExport,
  onServerExportAll,
  onServerExportStatusRefresh,
  onStorageLimitChange,
  persistenceMode,
  serverExportError,
  serverExportMutation,
  serverExportStatus,
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
  const serverArchiveMode = persistenceMode === "server"
  const serverExportAvailable = serverArchiveMode && serverExportStatus?.available === true
  const isServerExportBusy = serverExportMutation !== null
  const isServerExportDisabled = !serverExportAvailable || isServerExportBusy || isBusy

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

      {mutationStatus && mutationLabel ? (
        <PendingWorkStatus
          aria-label={mutationLabel}
          className="mb-4"
          description={generatedAudioMutationDescription(mutationStatus)}
          statusLabel="Updating"
          title={mutationLabel}
        />
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

      <div className="mb-4 rounded-md border border-border bg-background/60 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload aria-hidden="true" className="size-4 text-primary" />
              Server Export
              <Badge variant={serverExportAvailable ? "accent" : "secondary"}>
                {serverExportBadgeLabel(persistenceMode, serverExportStatus)}
              </Badge>
              <ExportTimingTooltip
                label="Server Export Timing"
                text={serverExportWriteTiming(persistenceMode, serverExportStatus)}
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {serverExportSummary(persistenceMode, serverExportStatus)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!serverArchiveMode || isServerExportBusy || isBusy}
              onClick={onServerExportStatusRefresh}
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
            <Button
              disabled={isServerExportDisabled || !hasGeneratedAudio}
              onClick={onServerExportAll}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Upload aria-hidden="true" className="size-4" />
              {serverExportMutation === "export-all" ? "Exporting" : "Export All"}
            </Button>
          </div>
        </div>
        {serverExportError ? (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
            {serverExportError}
          </div>
        ) : null}
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
                isServerExportDisabled={isServerExportDisabled || isTemporaryGeneratedAudioId(item.id)}
                isServerExportPending={serverExportMutation === "export"}
                item={item}
                key={item.id}
                onDelete={onDelete}
                onServerExport={serverArchiveMode ? onServerExport : undefined}
                serverExportStatus={findServerExportStatus(item, serverExportStatus)}
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

function findServerExportStatus(
  item: GeneratedResult,
  serverExportStatus: GeneratedAudioServerExportStatus | null
): GeneratedAudioServerExportItem | null {
  if (!serverExportStatus) {
    return null
  }
  for (const status of serverExportStatus.items) {
    if (status.audioId !== item.id) {
      continue
    }
    if (!item.sha256 || status.sha256 === item.sha256) {
      return status
    }
  }
  return null
}

function serverExportBadgeLabel(
  persistenceMode: GeneratedAudioPersistenceMode,
  status: GeneratedAudioServerExportStatus | null
) {
  if (persistenceMode !== "server") {
    return "Server Archive Off"
  }
  if (!status) {
    return "Unknown"
  }
  return status.available ? "Configured" : "Not Configured"
}

function serverExportSummary(
  persistenceMode: GeneratedAudioPersistenceMode,
  status: GeneratedAudioServerExportStatus | null
) {
  if (persistenceMode !== "server") {
    return "Server export requires the server archive."
  }
  if (!status) {
    return "Server export status has not loaded."
  }
  if (!status.available) {
    return "Set GENERATED_AUDIO_EXPORT_DIR to enable server exports."
  }
  const exportedCount = status.items.filter((item) => item.status === "exported").length
  const failedCount = status.items.filter((item) => item.status === "failed").length
  if (failedCount > 0) {
    return `${exportedCount} exported, ${failedCount} failed.`
  }
  return `${exportedCount} exported.`
}

function serverExportWriteTiming(
  persistenceMode: GeneratedAudioPersistenceMode,
  status: GeneratedAudioServerExportStatus | null
) {
  if (persistenceMode !== "server") {
    return "Generated audio stays in browser storage until the server archive is available."
  }
  if (!status?.available) {
    return "Generated audio saves to the server archive on generation; configure the server export directory to mirror it."
  }
  return "Generated audio saves to the server archive on generation; use Export to mirror or retry the server export folder."
}

function ExportTimingTooltip({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="size-7 shrink-0 text-muted-foreground"
          size="icon"
          type="button"
          variant="ghost"
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72" side="top" sideOffset={6}>
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function GeneratedAudioSkeletonList() {
  return (
    <div aria-label="Loading Generated Audio Archive" className="flex flex-col gap-3" role="status">
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

function generatedAudioMutationDescription(mutationStatus: GeneratedAudioMutation) {
  if (mutationStatus === "clear") {
    return "Removing saved generated audio from the browser archive."
  }
  if (mutationStatus === "delete") {
    return "Removing the selected generated audio item."
  }
  return "Updating the browser storage cap."
}
