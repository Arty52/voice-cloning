import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { SampleProcessingController } from "@/hooks/use-sample-processing"
import type { PreparedSamplesResult, SampleProcessingJob, VoicePreset } from "@/types"

import { SampleProcessingPanel } from "./sample-processing-panel"

const voicePresets: VoicePreset[] = [
  {
    id: "standardNarration",
    label: "Standard Narration",
    description: "Balanced narration.",
  },
  {
    id: "animatedDialogue",
    label: "Animated Dialogue",
    description: "Expressive dialogue.",
  },
]

const preparedSamplesResult: PreparedSamplesResult = {
  kind: "preparedSamples",
  warnings: ["Speaker detection unavailable; returned single-speaker candidates."],
  candidates: [
    {
      candidateId: "candidate-1",
      rank: 1,
      score: 92.4,
      speakerId: "speaker-1",
      speakerLabel: "Speaker 1",
      sourceWindow: {
        startSeconds: 10,
        endSeconds: 88,
        durationSeconds: 78,
      },
      durationSeconds: 119.6,
      sampleRateHz: 16000,
      contentType: "audio/wav",
      sha256: "candidate-1-hash",
      warnings: [],
      result: {
        filename: "candidate-1.wav",
        contentType: "audio/wav",
        sha256: "candidate-1-hash",
      },
    },
    {
      candidateId: "candidate-2",
      rank: 1,
      score: 81.7,
      speakerId: "speaker-2",
      speakerLabel: "Speaker 2",
      sourceWindow: {
        startSeconds: 96,
        endSeconds: 158,
        durationSeconds: 62,
      },
      durationSeconds: 61.2,
      sampleRateHz: 16000,
      contentType: "audio/wav",
      sha256: "candidate-2-hash",
      warnings: ["Clipping detected in this window."],
      result: {
        filename: "candidate-2.wav",
        contentType: "audio/wav",
        sha256: "candidate-2-hash",
      },
    },
  ],
}

const preparedJob: SampleProcessingJob = {
  id: "job-prepare",
  operationId: "prepareVoice",
  operationLabel: "Prepare Voice",
  status: "success",
  processingPresetId: null,
  processingPresetLabel: null,
  sourceName: "Conversation",
  sourceFilename: "conversation.wav",
  sourceContentType: "audio/wav",
  sourceSha256: "source-hash",
  sourceSizeBytes: 3_355_443,
  sourcePreference: "original",
  engine: "ffmpeg",
  workflowMode: "single",
  steps: [],
  activeStepId: null,
  estimatedDurationRangeSeconds: {
    minSeconds: 60,
    maxSeconds: 180,
  },
  progressPhases: [
    {
      id: "job-prepare-phase-complete",
      label: "Complete",
      status: "success",
      startedAt: "2026-06-23T00:00:58+00:00",
      completedAt: "2026-06-23T00:01:00+00:00",
      error: null,
      detail: "2 Candidates",
    },
  ],
  activeProgressPhaseId: null,
  createdAt: "2026-06-23T00:00:00+00:00",
  updatedAt: "2026-06-23T00:00:01+00:00",
  error: null,
  result: preparedSamplesResult,
}

describe("SampleProcessingPanel ranked candidates", () => {
  it("groups candidates by speaker and exposes preview and save controls", () => {
    const processing = {
      activeStep: null,
      activeProgressPhase: null,
      canCancel: false,
      canCleanVoice: true,
      canDetectSpeakers: false,
      canSave: false,
      canSaveSelectedCandidates: false,
      canSaveSelectedSpeakers: false,
      canStart: true,
      canUseOriginalRecording: false,
      candidateNameAssignments: {
        "candidate-1": "Conversation Speaker 1",
        "candidate-2": "Conversation Speaker 2",
      },
      candidateResultUrls: {
        "candidate-1": "/api/sample-processing/jobs/job-prepare/candidates/candidate-1/result",
        "candidate-2": "/api/sample-processing/jobs/job-prepare/candidates/candidate-2/result",
      },
      candidateSaveError: "Unable to add prepared voices.",
      candidateSaveStatus: "idle",
      candidateVoicePresetIds: {
        "candidate-1": "standardNarration",
        "candidate-2": "animatedDialogue",
      },
      effectiveSourcePreference: "active",
      enabledOperations: [],
      error: null,
      handleCancelProcessing: vi.fn(),
      handleCandidateNameChange: vi.fn(),
      handleCandidateSaveSelectionChange: vi.fn(),
      handleCandidateVoicePresetChange: vi.fn(),
      handleSaveCandidateVoices: vi.fn((event?: { preventDefault: () => void }) => event?.preventDefault()),
      handleSaveProcessedVoice: vi.fn(),
      handleSaveSpeakerVoices: vi.fn(),
      handleSourceFileSelect: vi.fn(),
      handleSourceModeChange: vi.fn(),
      handleStartProcessing: vi.fn((event: { preventDefault: () => void }) => event.preventDefault()),
      isPrepareVoiceSelected: true,
      isProcessing: false,
      job: preparedJob,
      mediaSource: {
        deleteCurrentSource: vi.fn(),
        error: null,
        hasChapters: false,
        manualDurationSeconds: 300,
        manualRange: { startSeconds: 0, endSeconds: 120 },
        preview: null,
        selectedChapterIds: [],
        selectedChapters: [],
        selectedDurationSeconds: 0,
        selectedRanges: [],
        setChapterSelected: vi.fn(),
        setManualRangeSeconds: vi.fn(),
        showPreview: vi.fn(),
        source: null,
        status: "idle",
        uploadSource: vi.fn(),
      },
      operations: [],
      optionsError: null,
      optionsStatus: "success",
      prepareCleanVoice: true,
      prepareDetectSpeakers: false,
      prepareEstimateRangeSeconds: {
        minSeconds: 60,
        maxSeconds: 180,
      },
      prepareTrimCandidates: true,
      preparedSamplesResult,
      processingElapsedMs: null,
      progressPhases: preparedJob.progressPhases,
      recommendedWorkflowOrder: [],
      resultUrl: null,
      selectedCandidateIds: ["candidate-1"],
      selectedOperationIds: ["prepareVoice"],
      selectedWorkflowSteps: [],
      setPrepareCleanVoice: vi.fn(),
      setPrepareDetectSpeakers: vi.fn(),
      setPrepareTrimCandidates: vi.fn(),
      setSourcePreference: vi.fn(),
      setSourceVoiceId: vi.fn(),
      setWorkflowStepSelected: vi.fn(),
      sourceFile: null,
      sourceMode: "upload",
      sourceVoices: [],
      sourceVoiceId: "",
      speakerSeparationResult: null,
      speakerSourceUrl: null,
      status: "success",
    } as unknown as SampleProcessingController

    render(
      <TooltipProvider>
        <SampleProcessingPanel
          isCollapsible={false}
          isExpanded={true}
          onToggleExpanded={vi.fn()}
          processing={processing}
          voicePresets={voicePresets}
        />
      </TooltipProvider>
    )

    expect(screen.getByText("Ranked Candidates")).toBeInTheDocument()
    expect(screen.getByText("Estimated Time 1m 0s to 3m 0s")).toBeInTheDocument()
    expect(screen.getByText("Workflow Progress")).toBeInTheDocument()
    expect(screen.getAllByText("Complete").length).toBeGreaterThan(0)
    expect(screen.getByText("2 Candidates")).toBeInTheDocument()
    expect(screen.getByText("Speaker 1")).toBeInTheDocument()
    expect(screen.getByText("Speaker 2")).toBeInTheDocument()
    expect(screen.getByText("Speaker detection unavailable; returned single-speaker candidates.")).toBeInTheDocument()
    expect(screen.getByText("Clipping detected in this window.")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Conversation Speaker 1")).toBeInTheDocument()
    expect(screen.getByText("2:00")).toBeInTheDocument()
    expect(screen.getAllByText("Standard Narration").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Animated Dialogue").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Add Selected Voices" })).toBeDisabled()
    expect(screen.getByText("Unable to add prepared voices.")).toBeInTheDocument()

    const candidatePreview = screen.getByRole("group", { name: "Speaker 1 candidate 1 preview" })
    expect(within(candidatePreview).getByRole("button", { name: "Play Audio" })).toBeInTheDocument()
    expect(candidatePreview.querySelector("audio")?.getAttribute("src")).toBe(
      "/api/sample-processing/jobs/job-prepare/candidates/candidate-1/result"
    )
  })
})
