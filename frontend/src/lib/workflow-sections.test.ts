import { describe, expect, it } from "vitest"

import {
  DEFAULT_WORKFLOW_SECTION_ID,
  WORKFLOW_SECTIONS,
  buildWorkflowSectionStatuses,
  workflowSectionHash,
  workflowSectionIdFromHash,
  type WorkflowSectionStatusInput,
} from "@/lib/workflow-sections"

const baseStatusInput: WorkflowSectionStatusInput = {
  canUseProvider: true,
  generatedAudioCount: 0,
  generatedAudioMutation: null,
  generatedAudioStatus: "success",
  generatedAudioStorageError: null,
  keySource: "server",
  processingEnabledOperationCount: 1,
  processingOptionsError: null,
  processingOptionsStatus: "success",
  processingStatus: "idle",
  providerError: null,
  providerStatus: "success",
  selectedVoiceId: "demo-voice",
  speechError: null,
  speechStatus: "idle",
  voiceError: null,
  voiceStatus: "success",
}

describe("workflow sections", () => {
  it("keeps the extensible workflow order stable", () => {
    expect(WORKFLOW_SECTIONS.map((section) => section.id)).toEqual([
      "prepare",
      "voices",
      "generate",
      "archive",
      "provider",
    ])
    expect(WORKFLOW_SECTIONS[0]).toMatchObject({
      id: "prepare",
      label: "Prepare Samples",
      optional: true,
      stepLabel: "0",
    })
    expect(DEFAULT_WORKFLOW_SECTION_ID).toBe("voices")
  })

  it("maps section ids and invalid hashes to stable hashes", () => {
    expect(workflowSectionHash("generate")).toBe("#generate")
    expect(workflowSectionIdFromHash("#GENERATE")).toBe("generate")
    expect(workflowSectionIdFromHash("#unknown")).toBe("voices")
    expect(workflowSectionIdFromHash("")).toBe("voices")
  })

  it("derives required-step and error status labels from real workflow state", () => {
    const statuses = buildWorkflowSectionStatuses({
      ...baseStatusInput,
      canUseProvider: false,
      generatedAudioStorageError: "IndexedDB unavailable.",
      keySource: "missing",
      processingStatus: "error",
      selectedVoiceId: "",
      speechError: "Select a voice first.",
      speechStatus: "error",
    })

    expect(statuses.prepare).toMatchObject({ label: "Error", tone: "error" })
    expect(statuses.voices).toMatchObject({ label: "Select Voice", tone: "attention" })
    expect(statuses.generate).toMatchObject({ label: "Error", tone: "error" })
    expect(statuses.archive).toMatchObject({ label: "Error", tone: "error" })
    expect(statuses.provider).toMatchObject({ label: "Missing Key", tone: "attention" })
  })

  it("derives busy and complete status labels", () => {
    const statuses = buildWorkflowSectionStatuses({
      ...baseStatusInput,
      generatedAudioCount: 3,
      processingStatus: "processing",
      speechStatus: "generating",
    })

    expect(statuses.prepare).toMatchObject({ label: "Processing", tone: "busy" })
    expect(statuses.voices).toMatchObject({ label: "Ready", tone: "success" })
    expect(statuses.generate).toMatchObject({ label: "Generating", tone: "busy" })
    expect(statuses.archive).toMatchObject({ label: "3 Saved", tone: "success" })
    expect(statuses.provider).toMatchObject({ label: "Ready", tone: "success" })
  })
})
