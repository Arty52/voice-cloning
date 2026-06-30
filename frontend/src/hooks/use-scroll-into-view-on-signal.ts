import { useEffect, useRef } from "react"

type ScrollAttentionSignal = number | string | null | undefined

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

export function useScrollIntoViewOnSignal<TElement extends HTMLElement>(
  signal: ScrollAttentionSignal
) {
  const targetRef = useRef<TElement | null>(null)
  const hasMountedRef = useRef(false)
  const previousSignalRef = useRef(signal)

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      previousSignalRef.current = signal
      return undefined
    }

    if (Object.is(previousSignalRef.current, signal)) {
      return undefined
    }
    previousSignalRef.current = signal

    if (signal === null || signal === undefined) {
      return undefined
    }

    const target = targetRef.current
    if (!target) {
      return undefined
    }

    const frameId = window.requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
        inline: "nearest",
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [signal])

  return targetRef
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches
}
