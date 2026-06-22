import {
  Archive,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FileAudio,
  KeyRound,
  Loader2,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react"

import type { AsyncStatus, ProviderKeySource, RequestStatus } from "@/types"
import type { GeneratedAudioMutation } from "@/hooks/use-generated-audio-library"
import type { SampleProcessingStatus } from "@/hooks/use-sample-processing"

export type WorkflowSectionId = "prepare" | "voices" | "generate" | "archive" | "provider"

export type WorkflowSection = {
  description: string
  hash: `#${WorkflowSectionId}`
  icon: LucideIcon
  id: WorkflowSectionId
  label: string
  optional: boolean
  stepLabel: string
}

export type WorkflowSectionStatusTone = "attention" | "busy" | "error" | "neutral" | "success"

export type WorkflowSectionStatus = {
  icon: LucideIcon
  label: string
  tone: WorkflowSectionStatusTone
}

export type WorkflowSectionStatusInput = {
  canUseProvider: boolean
  generatedAudioCount: number
  generatedAudioMutation: GeneratedAudioMutation | null
  generatedAudioStatus: AsyncStatus
  generatedAudioStorageError: string | null
  keySource: ProviderKeySource
  processingEnabledOperationCount: number
  processingOptionsError: string | null
  processingOptionsStatus: AsyncStatus
  processingStatus: SampleProcessingStatus
  providerError: string | null
  providerStatus: AsyncStatus
  selectedVoiceId: string
  speechError: string | null
  speechStatus: RequestStatus
  voiceError: string | null
  voiceStatus: AsyncStatus
}

export const DEFAULT_WORKFLOW_SECTION_ID: WorkflowSectionId = "voices"

export const WORKFLOW_SECTIONS: WorkflowSection[] = [
  {
    description: "Prepare or clean source audio before saving it as a voice.",
    hash: "#prepare",
    icon: Wand2,
    id: "prepare",
    label: "Prepare Samples",
    optional: true,
    stepLabel: "0",
  },
  {
    description: "Upload, record, select, and preview local voice samples.",
    hash: "#voices",
    icon: FileAudio,
    id: "voices",
    label: "Voices",
    optional: false,
    stepLabel: "1",
  },
  {
    description: "Enter text, tune the request, and generate speech.",
    hash: "#generate",
    icon: Sparkles,
    id: "generate",
    label: "Generate Speech",
    optional: false,
    stepLabel: "2",
  },
  {
    description: "Review browser-local generated speech history.",
    hash: "#archive",
    icon: Archive,
    id: "archive",
    label: "Generated Audio",
    optional: true,
    stepLabel: "Optional",
  },
  {
    description: "Manage provider keys, models, cost, and quota.",
    hash: "#provider",
    icon: KeyRound,
    id: "provider",
    label: "Provider & Usage",
    optional: false,
    stepLabel: "Config",
  },
]

export function workflowSectionIdFromHash(hash: string): WorkflowSectionId {
  const normalizedHash = hash.trim().toLowerCase()
  const section = WORKFLOW_SECTIONS.find((candidate) => candidate.hash === normalizedHash)
  return section?.id ?? DEFAULT_WORKFLOW_SECTION_ID
}

export function workflowSectionHash(sectionId: WorkflowSectionId) {
  return `#${sectionId}` as const
}

export function buildWorkflowSectionStatuses(input: WorkflowSectionStatusInput): Record<WorkflowSectionId, WorkflowSectionStatus> {
  return {
    archive: archiveStatus(input),
    generate: generateStatus(input),
    prepare: prepareStatus(input),
    provider: providerStatus(input),
    voices: voicesStatus(input),
  }
}

function prepareStatus(input: WorkflowSectionStatusInput): WorkflowSectionStatus {
  if (input.processingStatus === "starting" || input.processingStatus === "processing") {
    return busyStatus("Processing")
  }
  if (
    input.processingStatus === "error" ||
    input.processingOptionsStatus === "error" ||
    input.processingOptionsError !== null
  ) {
    return errorStatus("Error")
  }
  if (input.processingOptionsStatus === "idle" || input.processingOptionsStatus === "loading") {
    return busyStatus("Loading")
  }
  return neutralStatus("Optional")
}

function voicesStatus(input: WorkflowSectionStatusInput): WorkflowSectionStatus {
  if (input.voiceStatus === "idle" || input.voiceStatus === "loading") {
    return busyStatus("Loading")
  }
  if (input.voiceStatus === "error" || input.voiceError !== null) {
    return errorStatus("Error")
  }
  if (!input.selectedVoiceId) {
    return attentionStatus("Select Voice")
  }
  return successStatus("Ready")
}

function generateStatus(input: WorkflowSectionStatusInput): WorkflowSectionStatus {
  if (input.speechStatus === "generating") {
    return busyStatus("Generating")
  }
  if (input.speechStatus === "error") {
    return errorStatus("Error")
  }
  if (!input.canUseProvider) {
    return attentionStatus("Needs Key")
  }
  if (!input.selectedVoiceId) {
    return attentionStatus("Needs Voice")
  }
  return successStatus("Ready")
}

function archiveStatus(input: WorkflowSectionStatusInput): WorkflowSectionStatus {
  if (input.generatedAudioStatus === "error" || input.generatedAudioStorageError !== null) {
    return errorStatus("Error")
  }
  if (input.generatedAudioMutation) {
    return busyStatus("Updating")
  }
  if (input.generatedAudioStatus === "idle" || input.generatedAudioStatus === "loading") {
    return busyStatus("Loading")
  }
  if (input.generatedAudioCount > 0) {
    return successStatus(`${input.generatedAudioCount} Saved`)
  }
  return neutralStatus("Optional")
}

function providerStatus(input: WorkflowSectionStatusInput): WorkflowSectionStatus {
  if (input.providerStatus === "idle" || input.providerStatus === "loading") {
    return busyStatus("Loading")
  }
  if (input.keySource === "missing") {
    return attentionStatus("Needs Key")
  }
  if (input.providerStatus === "error" || input.providerError !== null) {
    return attentionStatus("Limited")
  }
  return successStatus("Ready")
}

function attentionStatus(label: string): WorkflowSectionStatus {
  return { icon: CircleAlert, label, tone: "attention" }
}

function busyStatus(label: string): WorkflowSectionStatus {
  return { icon: Loader2, label, tone: "busy" }
}

function errorStatus(label: string): WorkflowSectionStatus {
  return { icon: CircleAlert, label, tone: "error" }
}

function neutralStatus(label: string): WorkflowSectionStatus {
  return { icon: CircleDashed, label, tone: "neutral" }
}

function successStatus(label: string): WorkflowSectionStatus {
  return { icon: CircleCheck, label, tone: "success" }
}
