import { RefreshCw, Sparkles, X } from "lucide-react"
import type { Ref } from "react"
import { Button } from "@/components/ui/button"
import { Loading } from "@/components/ui/loading"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { dialogueRevisionState } from "@/lib/dialogue-revisions"
import type { GenerationPendingStatus } from "@/types"

export type GenerationBarProps = {
  barRef?: Ref<HTMLDivElement>
  canGenerate: boolean
  canRegenerateAll: boolean
  isDialogue: boolean
  isGenerating: boolean
  isRestoring?: boolean
  error?: string | null
  revision?: ReturnType<typeof dialogueRevisionState>
  rowCount: number
  characterCount: number
  pendingStatus?: GenerationPendingStatus | null
  onRegenerateAll: () => void
  onCancel: () => void
}

export function GenerationBar({ barRef, canGenerate, canRegenerateAll, isDialogue, isGenerating, isRestoring, error, revision, rowCount, characterCount, pendingStatus, onRegenerateAll, onCancel }: GenerationBarProps) {
  const changedCount = revision?.changedIds.length ?? 0
  const primaryLabel = !isDialogue ? "Generate" : !revision?.canRevise ? "Generate All" : `Generate Changes${changedCount ? ` (${changedCount})` : ""}`
  const detail = isRestoring ? "Restoring the saved dialogue and recording…" : isGenerating
    ? pendingStatus?.activeDetail ?? pendingStatus?.description ?? "Generating speech…"
    : error ?? (isDialogue ? revision?.fullGenerationReason : null) ??
      (isDialogue && revision?.canRevise && !changedCount ? revision.spacingChanged ? "Handoff spacing changed. Existing audio will be reassembled." : "All rows are up to date." : isDialogue ? `${rowCount} rows · ${characterCount.toLocaleString()} characters` : `${characterCount.toLocaleString()} characters`)
  const completed = pendingStatus?.segments.filter(segment => segment.status === "success").length ?? 0
  return (
    <div ref={barRef} aria-label="Generation Controls" role="region" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur-md sm:px-6 md:left-[var(--sidebar-offset)] lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 text-sm" aria-live="polite" role="status">
          {isGenerating && !isRestoring ? <p className="font-medium">{pendingStatus?.title ?? "Generating Speech"}{pendingStatus?.segments.length ? ` · ${completed}/${pendingStatus.segments.length} Rows` : ""}</p> : null}
          <p className={error && !isGenerating ? "text-destructive" : "text-muted-foreground"}>{detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button className="flex-1 sm:flex-none" disabled={!canGenerate || isGenerating || isRestoring} type="submit">
            {isGenerating ? <Loading aria-hidden="true" size="sm" /> : <Sparkles aria-hidden="true" />}
            {isRestoring ? "Restoring…" : isGenerating ? "Generating..." : primaryLabel}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={!canRegenerateAll ? 0 : undefined}>
                <Button aria-label="Regenerate All" disabled={!canRegenerateAll || isGenerating || isRestoring} onClick={onRegenerateAll} size="icon" type="button" variant="secondary"><RefreshCw aria-hidden="true" /></Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Regenerate All</TooltipContent>
          </Tooltip>
          {isGenerating && !isRestoring ? <Button onClick={onCancel} type="button" variant="secondary"><X aria-hidden="true" />Cancel</Button> : null}
        </div>
      </div>
    </div>
  )
}
