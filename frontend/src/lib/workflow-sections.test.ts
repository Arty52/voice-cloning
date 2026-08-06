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
  transcriptError: null,
  transcriptStatus: "idle",
  transcriptUnavailableReason: null,
  voiceError: null,
  voiceStatus: "success",
}

describe("workflow sections", () => {
  it("keeps the extensible workflow order stable", () => {
    expect(WORKFLOW_SECTIONS.map((section) => section.id)).toEqual([
      "overview",
      "prepare",
      "voices",
      "generate",
      "archive",
      "provider",
      "transcript",
    ])
    expect(WORKFLOW_SECTIONS[0]).toMatchObject({
      group: "workflow",
      id: "overview",
      label: "Overview",
      optional: false,
      overviewBadgeLabel: "Start",
      stepLabel: "Start",
    })
    expect(WORKFLOW_SECTIONS.at(-1)).toMatchObject({
      group: "features",
      id: "transcript",
      label: "Transcript",
      optional: false,
      overviewBadgeLabel: null,
      stepLabel: "Feature",
    })
    expect(WORKFLOW_SECTIONS.find((section) => section.id === "archive")).toMatchObject({
      overviewBadgeLabel: null,
      stepLabel: "Optional",
    })
    expect(DEFAULT_WORKFLOW_SECTION_ID).toBe("overview")
  })

  it("maps section ids and invalid hashes to stable hashes", () => {
    expect(workflowSectionHash("generate")).toBe("#generate")
    expect(workflowSectionIdFromHash("#GENERATE")).toBe("generate")
    expect(workflowSectionIdFromHash("#unknown")).toBe("overview")
    expect(workflowSectionIdFromHash("")).toBe("overview")
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

    expect(statuses.overview).toMatchObject({ label: "Start Here", tone: "neutral" })
    expect(statuses.prepare).toMatchObject({ label: "Error", tone: "error" })
    expect(statuses.transcript).toMatchObject({ label: "Available", tone: "neutral" })
    expect(statuses.voices).toMatchObject({ label: "Select Voice", tone: "attention" })
    expect(statuses.generate).toMatchObject({ label: "Error", tone: "error" })
    expect(statuses.archive).toMatchObject({ label: "Error", tone: "error" })
    expect(statuses.provider).toMatchObject({ label: "Needs Key", tone: "attention" })
  })

  it("derives error statuses without relying on truthy error messages", () => {
    const statusOnlyStatuses = buildWorkflowSectionStatuses({
      ...baseStatusInput,
      generatedAudioStatus: "error",
      processingOptionsStatus: "error",
      providerStatus: "error",
      speechStatus: "error",
      voiceStatus: "error",
    })

    expect(statusOnlyStatuses.prepare).toMatchObject({ label: "Error", tone: "error" })
    expect(statusOnlyStatuses.transcript).toMatchObject({ label: "Available", tone: "neutral" })
    expect(statusOnlyStatuses.voices).toMatchObject({ label: "Error", tone: "error" })
    expect(statusOnlyStatuses.generate).toMatchObject({ label: "Error", tone: "error" })
    expect(statusOnlyStatuses.archive).toMatchObject({ label: "Error", tone: "error" })
    expect(statusOnlyStatuses.provider).toMatchObject({ label: "Limited", tone: "attention" })

    const emptyMessageStatuses = buildWorkflowSectionStatuses({
      ...baseStatusInput,
      generatedAudioStorageError: "",
      processingOptionsError: "",
      providerError: "",
      voiceError: "",
    })

    expect(emptyMessageStatuses.prepare).toMatchObject({ label: "Error", tone: "error" })
    expect(emptyMessageStatuses.voices).toMatchObject({ label: "Error", tone: "error" })
    expect(emptyMessageStatuses.archive).toMatchObject({ label: "Error", tone: "error" })
    expect(emptyMessageStatuses.provider).toMatchObject({ label: "Limited", tone: "attention" })
  })

  it("derives busy and complete status labels", () => {
    const statuses = buildWorkflowSectionStatuses({
      ...baseStatusInput,
      generatedAudioCount: 3,
      processingStatus: "processing",
      speechStatus: "generating",
      transcriptStatus: "processing",
    })

    expect(statuses.prepare).toMatchObject({ label: "Processing", tone: "busy" })
    expect(statuses.transcript).toMatchObject({ label: "Processing", tone: "busy" })
    expect(statuses.voices).toMatchObject({ label: "Ready", tone: "success" })
    expect(statuses.generate).toMatchObject({ label: "Generating", tone: "busy" })
    expect(statuses.archive).toMatchObject({ label: "3 Saved", tone: "success" })
    expect(statuses.provider).toMatchObject({ label: "Ready", tone: "success" })
  })

  it("derives transcript ready and unavailable status labels", () => {
    expect(
      buildWorkflowSectionStatuses({ ...baseStatusInput, transcriptStatus: "success" }).transcript
    ).toMatchObject({ label: "Ready", tone: "success" })
    expect(
      buildWorkflowSectionStatuses({
        ...baseStatusInput,
        processingOptionsStatus: "loading",
        transcriptStatus: "success",
      }).transcript
    ).toMatchObject({ label: "Ready", tone: "success" })
    expect(
      buildWorkflowSectionStatuses({
        ...baseStatusInput,
        processingOptionsStatus: "loading",
        transcriptUnavailableReason: "Speaker detection is unavailable.",
      }).transcript
    ).toMatchObject({ label: "Unavailable", tone: "attention" })
  })

  it("distinguishes transcript startup from processing errors", () => {
    expect(
      buildWorkflowSectionStatuses({ ...baseStatusInput, transcriptStatus: "starting" }).transcript
    ).toMatchObject({ label: "Starting", tone: "busy" })
    expect(
      buildWorkflowSectionStatuses({
        ...baseStatusInput,
        transcriptError: "Choose a supported audio file.",
      }).transcript
    ).toMatchObject({ label: "Error", tone: "error" })
  })
})
