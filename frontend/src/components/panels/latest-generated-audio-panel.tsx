import { ChevronDown, RefreshCw } from "lucide-react"
import { useState } from "react"

import { AudioPlayer } from "@/components/audio-player"
import { GeneratedAudioItem } from "@/components/generated-audio-item"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Loading } from "@/components/ui/loading"
import { MenuSelect } from "@/components/ui/menu-select"
import { Separator } from "@/components/ui/separator"
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
              key={`${item.multiVoiceMetadata.jobId}:${item.multiVoiceMetadata.resultSha256 ?? ""}`}
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
  const [isOpen, setIsOpen] = useState(false)
  const [voiceSelections, setVoiceSelections] = useState<Record<string, string>>({})

  return (
    <section
      aria-label="Multi-Voice Segment Controls"
      className="mt-3 overflow-hidden rounded-md border border-dashed border-border bg-muted/20"
    >
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Segment Controls</h3>
            <p className="mt-1 text-xs text-muted-foreground">Segment-level playback and regeneration.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge>{segments.length} Segments</Badge>
            <CollapsibleTrigger asChild>
              <Button size="sm" type="button" variant="secondary">
                <ChevronDown
                  aria-hidden="true"
                  className={cn("transition-transform", isOpen ? "rotate-180" : null)}
                  data-icon="inline-start"
                />
                {isOpen ? "Hide Segments" : "Show Segments"}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent>
          <Separator />
          <div className="grid gap-2 p-3">
            {segments.map((segment) => {
              const selectedVoiceId = voiceSelections[segment.id] ?? segment.voiceId
              const voiceOptions = segmentVoiceOptions(voices, segment)
              const segmentUrl = segmentResultUrls[segment.id]
              return (
                <article className="rounded-md border border-border/70 bg-background/40 p-3" key={segment.id}>
                  <div className="mb-3 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">Segment {segment.index + 1}</span>
                      <Badge variant="accent">{segment.voiceName}</Badge>
                      {segment.generationCount > 1 ? <Badge>{segment.generationCount} Takes</Badge> : null}
                    </div>
                    <p className="break-words text-sm leading-6 text-muted-foreground">
                      {formatSegmentExcerpt(segment.text)}
                    </p>
                  </div>
                  {segmentUrl ? (
                    <AudioPlayer
                      ariaLabel={`Generated segment ${segment.index + 1} playback`}
                      className="rounded-md bg-background/30"
                      src={segmentUrl}
                    />
                  ) : (
                    <div className="rounded-md border border-dashed border-border bg-background/50 p-3 text-sm text-muted-foreground">
                      Segment audio is available only for the latest active job.
                    </div>
                  )}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <MenuSelect
                      ariaLabel={`Voice For Segment ${segment.index + 1}`}
                      disabled={disabled || voiceOptions.length === 0}
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
                      <RefreshCw aria-hidden="true" data-icon="inline-start" />
                      Regenerate
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
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

function segmentVoiceOptions(voices: VoiceAsset[], segment: GeneratedAudioMultiVoiceSegmentMetadata) {
  const options = voices.map((voice) => ({ label: voice.name, value: voice.id }))
  if (!options.some((option) => option.value === segment.voiceId)) {
    options.unshift({ label: segment.voiceName, value: segment.voiceId })
  }
  return options
}
