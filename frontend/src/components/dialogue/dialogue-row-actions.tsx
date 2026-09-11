import { Loader2, Pause, Play, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { useGeneratedAudioPlayback } from "@/hooks/use-generated-audio-playback"
import type { DialogueRowState } from "@/lib/dialogue-row-state"

export type DialogueRowActionsProps = {
  id: string
  index: number
  state: DialogueRowState
  canRegenerate: boolean
  onRegenerate?: (id: string) => void
  playback?: ReturnType<typeof useGeneratedAudioPlayback>
}

export function DialogueRowActions({ id, index, state, canRegenerate, onRegenerate, playback }: DialogueRowActionsProps) {
  const source = state.hasTake ? playback?.segmentSources.get(id) : null
  const current = source && playback?.controller.snapshot.source?.id === source.id && playback.controller.snapshot.source.url === source.url
  const isPlaying = current && playback?.controller.snapshot.status === "playing"
  const playLabel = `${isPlaying ? "Pause" : "Play"} Dialogue Row ${index + 1}${state.previousTake ? " Previous Take" : ""}`
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Badge variant={state.previousTake ? "accent" : "secondary"} role="status">
        {state.running ? <Loader2 className="mr-1 size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{state.label}
      </Badge>
      {source && playback ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label={playLabel} type="button" size="icon" variant="secondary" onClick={() => {
              if (!current) playback.activateSegment(id)
              playback.controller.dispatch({ type: isPlaying ? "pause" : "play" })
            }}>{isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
          </TooltipTrigger>
          <TooltipContent>{state.previousTake ? "Previous Take" : `Play Row ${index + 1}`}</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={!canRegenerate ? 0 : undefined}>
            <Button aria-label={`Regenerate Dialogue Row ${index + 1}`} disabled={!canRegenerate} onClick={() => onRegenerate?.(id)} type="button" size="icon" variant="secondary"><RefreshCw aria-hidden="true" /></Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{state.hasTake ? `Regenerate Row ${index + 1}` : "Generate All To Create The First Take"}</TooltipContent>
      </Tooltip>
    </div>
  )
}
