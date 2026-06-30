import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useScrollIntoViewOnSignal } from "./use-scroll-into-view-on-signal"

type FrameRequest = {
  callback: FrameRequestCallback
  id: number
}

describe("useScrollIntoViewOnSignal", () => {
  let frameId: number
  let frameRequests: FrameRequest[]
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    frameId = 0
    frameRequests = []
    scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        frameId += 1
        frameRequests.push({ callback, id: frameId })
        return frameId
      }),
    })
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("does not scroll on initial mount", () => {
    render(<ScrollAttentionProbe signal={1} />)

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it("scrolls the target when the signal changes", () => {
    const { rerender } = render(<ScrollAttentionProbe signal={1} />)

    rerender(<ScrollAttentionProbe signal={2} />)

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)
    flushFrame(1)
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    })
  })

  it("uses auto scrolling when reduced motion is preferred", () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    const { rerender } = render(<ScrollAttentionProbe signal="idle" />)

    rerender(<ScrollAttentionProbe signal="active" />)
    flushFrame(1)

    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)")
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
      inline: "nearest",
    })
  })

  it("cancels pending frames when the signal changes before scrolling", () => {
    const { rerender } = render(<ScrollAttentionProbe signal={1} />)

    rerender(<ScrollAttentionProbe signal={2} />)
    rerender(<ScrollAttentionProbe signal={3} />)

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2)
    flushFrame(2)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it("cancels pending frames on unmount", () => {
    const { rerender, unmount } = render(<ScrollAttentionProbe signal={1} />)

    rerender(<ScrollAttentionProbe signal={2} />)
    unmount()

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  function flushFrame(id: number) {
    const frame = frameRequests.find((request) => request.id === id)
    expect(frame).toBeDefined()
    act(() => {
      frame?.callback(0)
    })
  }
})

function ScrollAttentionProbe({ signal }: { signal: number | string }) {
  const attentionRef = useScrollIntoViewOnSignal<HTMLDivElement>(signal)

  return <div data-testid="target" ref={attentionRef} />
}
