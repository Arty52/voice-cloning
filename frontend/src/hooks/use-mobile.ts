import { useEffect, useState } from "react"

const MOBILE_BREAKPOINT = 768

function readIsMobile() {
  if (typeof window === "undefined") {
    return false
  }
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(readIsMobile)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined
    }

    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const handleChange = () => setIsMobile(readIsMobile())

    handleChange()
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  return isMobile
}
