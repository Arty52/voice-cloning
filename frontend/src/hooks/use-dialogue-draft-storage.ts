import { useEffect, useRef, useState } from "react"
import { DIALOGUE_DRAFT_KEY, parseDialogueDraft, readDialogueDraft, type DialogueDraft, type DialogueDraftEnvelope } from "@/lib/dialogue-draft"

export function useDialogueDraftStorage(draft: DialogueDraft | null) {
  const [initial] = useState(readDialogueDraft)
  const [error, setError] = useState(initial.error)
  const [conflict, setConflict] = useState<{ envelope: DialogueDraftEnvelope | null } | null>(null)
  const [writerId] = useState(() => crypto.randomUUID())
  const seenRevision = useRef(initial.envelope?.revision ?? null)
  const savedJson = useRef(JSON.stringify(initial.envelope?.draft ?? null))
  const pending = useRef(draft)
  const paused = useRef(false)
  const mounted = useRef(true)
  const serialized = JSON.stringify(draft)

  function flush(force = false) {
    const next = pending.current
    if (!next || paused.current || (!force && JSON.stringify(next) === savedJson.current)) return
    try {
      const current = parseDialogueDraft(localStorage.getItem(DIALOGUE_DRAFT_KEY))
      if (!force && (current?.revision ?? null) !== seenRevision.current && current?.writerId !== writerId) {
        paused.current = true
        if (mounted.current) setConflict({ envelope: current })
        return
      }
      const envelope: DialogueDraftEnvelope = { version: 1, writerId, revision: crypto.randomUUID(), draft: next }
      localStorage.setItem(DIALOGUE_DRAFT_KEY, JSON.stringify(envelope))
      seenRevision.current = envelope.revision
      savedJson.current = JSON.stringify(next)
      if (mounted.current) setError(null)
    } catch {
      if (mounted.current) setError("This dialogue could not be saved locally. Keep this tab open to preserve your edits.")
    }
  }
  const flushRef = useRef(flush)
  useEffect(() => { pending.current = draft; flushRef.current = flush })
  useEffect(() => {
    const timer = window.setTimeout(() => flushRef.current(), 250)
    return () => window.clearTimeout(timer)
  }, [serialized])
  useEffect(() => {
    mounted.current = true
    function onStorage(event: StorageEvent) {
      if (event.key !== DIALOGUE_DRAFT_KEY && event.key !== null) return
      try {
        const incoming = parseDialogueDraft(event.newValue)
        if (incoming?.writerId === writerId || (incoming?.revision ?? null) === seenRevision.current) return
        paused.current = true
        setConflict({ envelope: incoming })
      } catch { setError("Another tab saved an unreadable dialogue draft. Your current edits are preserved."); paused.current = true }
    }
    const onHidden = () => { if (document.visibilityState === "hidden") flushRef.current() }
    const onPageHide = () => flushRef.current()
    window.addEventListener("storage", onStorage)
    window.addEventListener("pagehide", onPageHide)
    document.addEventListener("visibilitychange", onHidden)
    return () => {
      mounted.current = false
      flushRef.current()
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("pagehide", onPageHide)
      document.removeEventListener("visibilitychange", onHidden)
    }
  }, [writerId])

  function keepCurrent() { paused.current = false; flush(true); setConflict(null) }
  function acceptSaved() {
    const incoming = conflict?.envelope ?? null
    seenRevision.current = incoming?.revision ?? null
    savedJson.current = JSON.stringify(incoming?.draft ?? null)
    pending.current = null
    paused.current = false
    setConflict(null)
    return incoming?.draft ?? null
  }
  return { initialDraft: initial.envelope?.draft ?? null, error, conflict, keepCurrent, acceptSaved }
}
