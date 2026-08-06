import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { TranscriptPipelineActivity } from "./transcript-pipeline-activity"

describe("TranscriptPipelineActivity", () => {
  it("renders the readable engine label with an indeterminate processing status", () => {
    render(<TranscriptPipelineActivity engine="pyannote-community-1 + faster-whisper" isProcessing />)

    const activity = screen.getByRole("status")

    expect(activity).toHaveAccessibleName("Transcript is processing. Progress percentage is unavailable.")
    expect(activity).toHaveTextContent("pyannote-community-1 + faster-whisper")
    expect(activity.querySelector(".transcript-pipeline-activity__sweep")).toBeInTheDocument()
  })

  it("keeps the static engine badge once processing is complete", () => {
    render(<TranscriptPipelineActivity engine="pyannote-community-1 + faster-whisper" isProcessing={false} />)

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.getByText("pyannote-community-1 + faster-whisper")).toBeInTheDocument()
    expect(document.querySelector(".transcript-pipeline-activity__sweep")).not.toBeInTheDocument()
  })
})
