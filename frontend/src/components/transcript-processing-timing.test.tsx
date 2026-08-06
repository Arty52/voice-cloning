import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { TranscriptProcessingTiming } from "./transcript-processing-timing"

describe("TranscriptProcessingTiming", () => {
  it("shows the persisted estimated range beside live elapsed time", () => {
    render(
      <TranscriptProcessingTiming
        elapsedMs={350_000}
        estimateRange={{ minSeconds: 40, maxSeconds: 115 }}
        isProcessing
      />
    )

    expect(screen.getByLabelText("Transcript Processing Elapsed Time")).toHaveTextContent("Elapsed 5m 50s")
    expect(screen.getByLabelText("Transcript Processing Estimated Time")).toHaveTextContent(
      "Estimated 40s to 1m 55s"
    )
  })

  it("keeps the finished treatment without a stale estimate", () => {
    render(
      <TranscriptProcessingTiming
        elapsedMs={12_000}
        estimateRange={{ minSeconds: 40, maxSeconds: 115 }}
        isProcessing={false}
      />
    )

    expect(screen.getByLabelText("Transcript Processing Elapsed Time")).toHaveTextContent("Finished In 12s")
    expect(screen.queryByLabelText("Transcript Processing Estimated Time")).not.toBeInTheDocument()
  })

  it("omits unavailable timing without rendering an empty status", () => {
    const { container } = render(
      <TranscriptProcessingTiming elapsedMs={null} estimateRange={null} isProcessing />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
