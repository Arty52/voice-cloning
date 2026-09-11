import { useLayoutEffect, useRef, useState } from "react"

/** Reserve the measured space of a viewport-docked control, including wrapped mobile content. */
export function useElementHeight(fallback = 120) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === "undefined") return
    const measure = () => {
      const next = element.getBoundingClientRect().height
      if (next > 0) setHeight(Math.ceil(next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, height }
}
