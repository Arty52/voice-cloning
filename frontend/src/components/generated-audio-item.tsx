import { Download, FileText, FolderUp, RotateCcw, Trash2, Upload } from "lucide-react"

import { AudioPlayer } from "@/components/audio-player"
import { GeneratedAudioMetadata } from "@/components/generated-audio-metadata"
import { GeneratedAudioSizeBadge } from "@/components/generated-audio-size-badge"
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu"
import { Badge } from "@/components/ui/badge"
import type { GeneratedAudioServerExportItem } from "@/lib/generated-audio-export-api"
import type { BrowserArchiveExportLedgerEntry } from "@/lib/generated-audio-export-ledger"
import { formatNumber } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import type { GeneratedResult } from "@/types"

type GeneratedAudioItemProps = {
  badge?: string
  browserExportStatus?: BrowserArchiveExportLedgerEntry | null
  className?: string
  isBrowserExportDisabled?: boolean
  isBrowserExportPending?: boolean
  isDeleteDisabled?: boolean
  isServerExportDisabled?: boolean
  isServerExportPending?: boolean
  item: GeneratedResult
  onBrowserExport?: (id: string) => void
  onDelete: (id: string) => void
  onRestoreScriptSnapshot?: (item: GeneratedResult) => void
  onServerExport?: (id: string) => void
  onViewScriptSnapshot?: (item: GeneratedResult) => void
  serverExportStatus?: GeneratedAudioServerExportItem | null
}

export function GeneratedAudioItem({
  badge,
  browserExportStatus = null,
  className,
  isBrowserExportDisabled = false,
  isBrowserExportPending = false,
  isDeleteDisabled = false,
  isServerExportDisabled = false,
  isServerExportPending = false,
  item,
  onBrowserExport,
  onDelete,
  onRestoreScriptSnapshot,
  onServerExport,
  onViewScriptSnapshot,
  serverExportStatus = null,
}: GeneratedAudioItemProps) {
  const serverExportLabel = serverExportActionLabel(serverExportStatus)
  const browserExportLabel = browserExportActionLabel(browserExportStatus)
  const actionItems = buildGeneratedAudioActionItems({
    browserExportLabel,
    isBrowserExportDisabled,
    isBrowserExportPending,
    isDeleteDisabled,
    isServerExportDisabled,
    isServerExportPending,
    item,
    onBrowserExport,
    onDelete,
    onRestoreScriptSnapshot,
    onServerExport,
    onViewScriptSnapshot,
    serverExportLabel,
  })

  return (
    <div className={cn("rounded-md border border-border bg-background/60 p-3", className)}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.voiceName}</div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">Voice {item.voiceId}</div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {badge ? <Badge>{badge}</Badge> : null}
            {serverExportStatus ? (
              <Badge variant={serverExportStatus.status === "exported" ? "accent" : "secondary"}>
                {serverExportBadgeLabel(serverExportStatus)}
              </Badge>
            ) : null}
            {browserExportStatus ? (
              <Badge variant={browserExportStatus.status === "exported" ? "accent" : "secondary"}>
                {browserExportBadgeLabel(browserExportStatus)}
              </Badge>
            ) : null}
            {item.multiVoiceMetadata ? <Badge variant="accent">Multi-Voice</Badge> : null}
            <Badge>{cacheBadgeLabel(item)}</Badge>
          </div>
          <ActionMenu ariaLabel={`Open generated audio actions for ${item.voiceName}`} items={actionItems} />
        </div>
      </div>
      {item.multiVoiceMetadata ? <GeneratedAudioMultiVoiceSummary item={item} /> : null}
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
    </div>
  )
}

type GeneratedAudioActionInput = {
  browserExportLabel: string
  isBrowserExportDisabled: boolean
  isBrowserExportPending: boolean
  isDeleteDisabled: boolean
  isServerExportDisabled: boolean
  isServerExportPending: boolean
  item: GeneratedResult
  onBrowserExport?: (id: string) => void
  onDelete: (id: string) => void
  onRestoreScriptSnapshot?: (item: GeneratedResult) => void
  onServerExport?: (id: string) => void
  onViewScriptSnapshot?: (item: GeneratedResult) => void
  serverExportLabel: string
}

function buildGeneratedAudioActionItems({
  browserExportLabel,
  isBrowserExportDisabled,
  isBrowserExportPending,
  isDeleteDisabled,
  isServerExportDisabled,
  isServerExportPending,
  item,
  onBrowserExport,
  onDelete,
  onRestoreScriptSnapshot,
  onServerExport,
  onViewScriptSnapshot,
  serverExportLabel,
}: GeneratedAudioActionInput): ActionMenuItem[] {
  const items: ActionMenuItem[] = []

  if (item.scriptSnapshot && onViewScriptSnapshot) {
    items.push({
      icon: <FileText aria-hidden="true" className="size-4" />,
      label: viewScriptSnapshotLabel(item),
      onSelect: () => onViewScriptSnapshot(item),
    })
  }

  if (item.scriptSnapshot && onRestoreScriptSnapshot) {
    items.push({
      icon: <RotateCcw aria-hidden="true" className="size-4" />,
      label: restoreScriptSnapshotLabel(item),
      onSelect: () => onRestoreScriptSnapshot(item),
    })
  }

  items.push({
    download: `voice-clone-${item.appVoiceId}-${item.id}.mp3`,
    href: item.url,
    icon: <Download aria-hidden="true" className="size-4" />,
    label: "Download",
  })

  if (onServerExport) {
    items.push({
      disabled: isServerExportDisabled || isServerExportPending,
      icon: <Upload aria-hidden="true" className="size-4" />,
      label: isServerExportPending ? "Exporting" : serverExportLabel,
      onSelect: () => onServerExport(item.id),
    })
  }

  if (onBrowserExport) {
    items.push({
      disabled: isBrowserExportDisabled || isBrowserExportPending,
      icon: <FolderUp aria-hidden="true" className="size-4" />,
      label: isBrowserExportPending ? "Mirroring" : browserExportLabel,
      onSelect: () => onBrowserExport(item.id),
    })
  }

  items.push({
    destructive: true,
    disabled: isDeleteDisabled,
    icon: <Trash2 aria-hidden="true" className="size-4" />,
    label: "Remove",
    onSelect: () => onDelete(item.id),
  })

  return items
}

function restoreScriptSnapshotLabel(item: GeneratedResult) {
  return item.scriptSnapshot?.mode === "dialogue" ? "Use Dialogue" : "Use Text"
}

function viewScriptSnapshotLabel(item: GeneratedResult) {
  return item.scriptSnapshot?.mode === "dialogue" ? "View Dialogue" : "View Text"
}

function serverExportBadgeLabel(status: GeneratedAudioServerExportItem) {
  return status.status === "exported" ? "Server Exported" : "Export Failed"
}

function serverExportActionLabel(status: GeneratedAudioServerExportItem | null) {
  if (!status) {
    return "Export"
  }
  return status.status === "failed" ? "Retry Export" : "Export Again"
}

function browserExportBadgeLabel(status: BrowserArchiveExportLedgerEntry) {
  return status.status === "exported" ? "Browser Exported" : "Browser Export Failed"
}

function browserExportActionLabel(status: BrowserArchiveExportLedgerEntry | null) {
  if (!status) {
    return "Browser Export"
  }
  return status.status === "failed" ? "Retry Browser Export" : "Browser Export Again"
}

function GeneratedAudioMultiVoiceSummary({ item }: { item: GeneratedResult }) {
  const metadata = item.multiVoiceMetadata
  if (!metadata) {
    return null
  }

  return (
    <div className="mb-3 rounded-md border border-border bg-card/70 p-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-2">
        <Badge>{metadata.segmentCount} Segments</Badge>
        {metadata.voices.map((voice) => (
          <Badge key={voice.voiceId} variant="secondary">
            {voice.voiceName} x{voice.segmentCount}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function cacheBadgeLabel(item: GeneratedResult) {
  if (item.multiVoiceMetadata) {
    return "Combined Result"
  }
  return item.cacheState === "hit" ? "Cache Hit" : "Cache Miss"
}
