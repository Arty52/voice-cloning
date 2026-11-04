import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { TranscriptionExecution } from "./transcription-execution"
import type { SampleProcessingJob } from "@/types"

it("shows actual devices and failed speaker detection without hiding successful text", () => {
  const job = {
    transcriptionProgress: { transcription: { status: "success", elapsedSeconds: 1.25 }, diarization: { status: "error", elapsedSeconds: 2 } },
    result: { kind: "transcript", speakers: [], transcript: { items: [] }, metadata: {
      device: "apple-gpu", warnings: ["Speaker detection failed. Transcript text is available without speaker assignments."],
    } },
  } as unknown as SampleProcessingJob
  render(<TranscriptionExecution job={job} />)
  expect(screen.getByText("ASR: Apple GPU")).toBeVisible()
  expect(screen.getByText("Unassigned Speakers")).toBeVisible()
  expect(screen.getByText("Speaker Detection: Failed · 2.0s")).toBeVisible()
  expect(screen.getByText(/Transcript text is available/)).toBeVisible()
})
