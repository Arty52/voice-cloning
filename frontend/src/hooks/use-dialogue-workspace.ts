import { useEffect, useRef, useState } from "react"
import { useDialogueDraftStorage } from "@/hooks/use-dialogue-draft-storage"
import { readDialogueDraft, type DialogueDraft } from "@/lib/dialogue-draft"
import type { useMultiVoiceSpeechGeneration } from "@/hooks/use-multi-voice-speech-generation"
import type { GeneratedResult, VoiceProvider } from "@/types"

type Options = {
  draft: DialogueDraft | null
  ready: boolean
  applyDraft: (draft: DialogueDraft | null) => void
  speech: ReturnType<typeof useMultiVoiceSpeechGeneration>
  providers: VoiceProvider[]
  archivedItems: GeneratedResult[]
  onResult: (id: string) => void
}

/** Coordinates hydration once dependencies load, independently of editor presentation. */
export function useDialogueWorkspace(options: Options) {
  const [initial] = useState(readDialogueDraft)
  const [hydrated, setHydrated] = useState(initial.envelope === null)
  const [isRestoring, setIsRestoring] = useState(false)
  const storage = useDialogueDraftStorage(hydrated && options.ready && !isRestoring ? options.draft : null, initial)
  const latest = useRef(options)
  const started = useRef(false)
  const restoreVersion = useRef(0)
  useEffect(() => { latest.current = options })

  async function restore(draft: DialogueDraft | null) {
    const version = ++restoreVersion.current
    setIsRestoring(true)
    const current = latest.current
    current.applyDraft(draft)
    if (draft?.speech.resultId) current.onResult(draft.speech.resultId)
    if (draft && (draft.speech.active || draft.speech.successful)) {
      const result = await current.speech.restoreRecovery(draft.speech, current.providers, current.archivedItems)
      if (version !== restoreVersion.current) return
      if (result) latest.current.onResult(result.id)
    } else {
      current.speech.resetGeneration()
    }
    if (version !== restoreVersion.current) return
    setIsRestoring(false)
    setHydrated(true)
  }
  const restoreRef = useRef(restore)
  useEffect(() => { restoreRef.current = restore })
  useEffect(() => {
    if (!options.ready || started.current) return
    started.current = true
    if (storage.initialDraft) void restoreRef.current(storage.initialDraft)
  }, [options.ready, storage.initialDraft])

  return {
    isRestoring: isRestoring || !hydrated || !options.ready,
    error: storage.error,
    conflict: storage.conflict !== null,
    keepCurrent: storage.keepCurrent,
    useSaved: () => { void restore(storage.acceptSaved()) },
  }
}
