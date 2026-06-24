import { RefreshCw } from "lucide-react"
import { useState } from "react"

import { AudioPlayer } from "@/components/audio-player"
import { GeneratedAudioItem } from "@/components/generated-audio-item"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loading } from "@/components/ui/loading"
import { MenuSelect } from "@/components/ui/menu-select"
import { cn } from "@/lib/utils"
import type { GeneratedAudioMultiVoiceSegmentMetadata, GeneratedResult, RequestStatus, VoiceAsset } from "@/types"

type LatestGeneratedAudioPanelProps = {
  error: string | null
  isDeleteDisabled: boolean
  item: GeneratedResult | null
  onDelete: (id: string) => void
  onRegenerateSegment: (segmentId: string, voiceId?: string | null) => void
  segmentResultUrls: Record<string, string>
  status: RequestStatus
  storageError: string | null
  voices: VoiceAsset[]
}

export function LatestGeneratedAudioPanel({
  error,
  isDeleteDisabled,
  item,
  onDelete,
  onRegenerateSegment,
  segmentResultUrls,
  status,
  storageError,
  voices,
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
        <>
          <GeneratedAudioItem
            className={isGenerating ? "mt-4" : undefined}
            isDeleteDisabled={isDeleteDisabled}
            item={item}
            onDelete={onDelete}
          />
          {item.multiVoiceMetadata ? (
            <MultiVoiceSegmentResults
              disabled={isGenerating}
              onRegenerateSegment={onRegenerateSegment}
              segmentResultUrls={segmentResultUrls}
              segments={item.multiVoiceMetadata.segments}
              voices={voices}
            />
          ) : null}
        </>
      ) : null}
    </section>
  )
}

type MultiVoiceSegmentResultsProps = {
  disabled: boolean
  onRegenerateSegment: (segmentId: string, voiceId?: string | null) => void
  segmentResultUrls: Record<string, string>
  segments: GeneratedAudioMultiVoiceSegmentMetadata[]
  voices: VoiceAsset[]
}

function MultiVoiceSegmentResults({
  disabled,
  onRegenerateSegment,
  segmentResultUrls,
  segments,
  voices,
}: MultiVoiceSegmentResultsProps) {
  const [voiceSelections, setVoiceSelections] = useState<Record<string, string>>({})
  const voiceOptions = voices.map((voice) => ({ label: voice.name, value: voice.id }))

  return (
    <section aria-label="Multi-Voice Segments" className="mt-3 rounded-md border border-border bg-background/60 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Multi-Voice Segments</h3>
          <p className="mt-1 text-xs text-muted-foreground">Play or regenerate individual segments.</p>
        </div>
        <Badge>{segments.length} Segments</Badge>
      </div>
      <div className="grid gap-3">
        {segments.map((segment) => {
          const selectedVoiceId = voiceSelections[segment.id] ?? segment.voiceId
          const segmentUrl = segmentResultUrls[segment.id]
          return (
            <article className="rounded-md border border-border bg-card/70 p-3" key={segment.id}>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="accent">{segment.voiceName}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">Segment {segment.index + 1}</span>
                    {segment.generationCount > 1 ? <Badge>{segment.generationCount} Takes</Badge> : null}
                  </div>
                  <p className="mt-2 break-words text-sm leading-6">{formatSegmentExcerpt(segment.text)}</p>
                </div>
              </div>
              {segmentUrl ? (
                <AudioPlayer ariaLabel={`Generated segment ${segment.index + 1} playback`} src={segmentUrl} />
              ) : (
                <div className="rounded-md border border-dashed border-border bg-background/50 p-3 text-sm text-muted-foreground">
                  Segment audio is available only for the latest active job.
                </div>
              )}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <MenuSelect
                  ariaLabel={`Voice For Segment ${segment.index + 1}`}
                  disabled={disabled || voices.length === 0}
                  onChange={(voiceId) =>
                    setVoiceSelections((current) => ({
                      ...current,
                      [segment.id]: voiceId,
                    }))
                  }
                  options={voiceOptions}
                  value={selectedVoiceId}
                />
                <Button
                  disabled={disabled || !segmentUrl}
                  onClick={() => {
                    onRegenerateSegment(segment.id, selectedVoiceId === segment.voiceId ? null : selectedVoiceId)
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <RefreshCw aria-hidden="true" />
                  Regenerate
                </Button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function formatSegmentExcerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= 180) {
    return normalized
  }
  return `${normalized.slice(0, 179)}...`
}
