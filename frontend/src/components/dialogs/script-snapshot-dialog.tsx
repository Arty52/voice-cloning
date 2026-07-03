import { FileText } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { GeneratedAudioScriptSnapshot } from "@/types"

type ScriptSnapshotDialogProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
  snapshot: GeneratedAudioScriptSnapshot | null
}

export function ScriptSnapshotDialog({ onOpenChange, open, snapshot }: ScriptSnapshotDialogProps) {
  if (!snapshot) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generated Script Snapshot</DialogTitle>
          <DialogDescription>
            {snapshot.mode === "dialogue" ? "Dialogue Rows" : "Range Assignments"} Snapshot
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 text-sm">
          <Badge>{snapshot.mode === "dialogue" ? "Dialogue" : "Range"}</Badge>
          <Badge variant="secondary">Version {snapshot.version}</Badge>
          <Badge variant="secondary">{snapshot.segmentGapMs === 0 ? "Natural Handoffs Off" : "Natural Handoffs On"}</Badge>
          {snapshot.sourceVoiceId ? <Badge variant="secondary">Source Voice {snapshot.sourceVoiceId}</Badge> : null}
        </div>

        <section aria-label="Submitted Script" className="grid gap-2">
          <h3 className="text-sm font-medium">Submitted Script</h3>
          <ScrollArea className="max-h-56 rounded-md border border-border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6">{snapshot.text}</pre>
          </ScrollArea>
        </section>

        {snapshot.assignments.length > 0 ? (
          <section aria-label="Range Assignments" className="grid gap-2">
            <h3 className="text-sm font-medium">Range Assignments</h3>
            <div className="grid gap-2">
              {snapshot.assignments.map((assignment) => (
                <div className="rounded-md border border-border p-3 text-sm" key={assignment.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{assignment.voiceName}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {assignment.start}-{assignment.end}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{assignment.text}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {snapshot.dialogueBlocks.length > 0 ? (
          <section aria-label="Dialogue Rows" className="grid gap-2">
            <h3 className="text-sm font-medium">Dialogue Rows</h3>
            <div className="grid gap-2">
              {snapshot.dialogueBlocks.map((block, index) => (
                <div className="rounded-md border border-border p-3 text-sm" key={block.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Row {index + 1}</Badge>
                    {block.speakerLabel ? <Badge>{block.speakerLabel}</Badge> : null}
                    {block.voiceName ? <Badge variant="secondary">{block.voiceName}</Badge> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{block.text}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {snapshot.speakerMappings.length > 0 ? (
          <section aria-label="Speaker Mappings" className="grid gap-2">
            <h3 className="text-sm font-medium">Speaker Mappings</h3>
            <div className="flex flex-wrap gap-2">
              {snapshot.speakerMappings.map((mapping) => (
                <Badge key={mapping.speakerLabel} variant="secondary">
                  {mapping.speakerLabel}: {mapping.voiceId ?? "Unmapped"}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <FileText aria-hidden="true" className="size-4" />
            <span>Saved With Generated Audio</span>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
