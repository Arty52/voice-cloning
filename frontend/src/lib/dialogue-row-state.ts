import type { DialogueBaseline, dialogueRevisionState } from "@/lib/dialogue-revisions"
import type { SpeechJob } from "@/types"

export type DialogueRowState = { label: string; hasTake: boolean; previousTake: boolean; error: string | null; running: boolean }

export function dialogueRowState(id: string, baseline: DialogueBaseline | null, revision: ReturnType<typeof dialogueRevisionState>, activeJob: SpeechJob | null): DialogueRowState {
  const hasTake = Boolean(revision.linked && baseline?.job.segments.some(segment => segment.id === id && segment.status === "success"))
  const previousTake = hasTake && (revision.changedIds.includes(id) || Boolean(revision.fullGenerationReason))
  const active = activeJob?.id !== baseline?.job.id ? activeJob?.segments.find(segment => segment.id === id) : null
  if (active?.status === "error") return { label: "Error", hasTake, previousTake, error: active.error, running: false }
  if (active?.status === "running" || (active?.status === "pending" && ["pending", "running"].includes(activeJob?.status ?? ""))) {
    return { label: active.status === "running" ? "Generating" : "Queued", hasTake, previousTake, error: null, running: true }
  }
  return { label: previousTake ? "Changed" : hasTake ? "Up To Date" : "Not Generated", hasTake, previousTake, error: null, running: false }
}
