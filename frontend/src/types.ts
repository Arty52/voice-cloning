import type { FormEvent } from "react"

export type RequestStatus = "idle" | "generating" | "success" | "error" | "canceled"
export type AsyncStatus = "idle" | "loading" | "success" | "error"
export type RecorderStatus = "idle" | "starting" | "recording" | "stopping" | "recorded" | "error"
export type VoiceSampleInputMode = "upload" | "record"
export type VoiceSampleMode = "excerpt" | "sourceWindow"
export type VoicePresetId = "standardNarration" | "animatedDialogue"
export type ProviderKeySource = "browser" | "server" | "missing"
export type SampleProcessingOperationId = "prepareVoice" | "isolateVoice" | "trimSilence" | "separateSpeakers"
export type SampleProcessingPresetId =
  | "fast"
  | "balanced"
  | "clean"
  | "maxIsolation"
  | "trimLight"
  | "trimBalanced"
  | "trimAggressive"
export type SampleProcessingSourcePreference = "original" | "active"
export type SampleProcessingJobStatus = "pending" | "running" | "success" | "error" | "canceled"
export type SampleProcessingStepStatus = "pending" | "running" | "success" | "error" | "canceled"
export type SampleProcessingWorkflowMode = "single" | "stack"
export type SpeechJobStatus = "pending" | "running" | "success" | "error" | "canceled"
export type SpeechSegmentStatus = "pending" | "running" | "success" | "error" | "canceled"
export type SpeechSegmentAssignmentKind = "assigned" | "default"

export type VoiceProvider = {
  id: string
  label: string
  serverKeyConfigured: boolean
  manageKeyUrl: string
  docsUrl: string
  links: ProviderLink[]
  sample: ProviderSampleMetadata
  tuning: ProviderTuningMetadata
}

export type ProviderLink = {
  label: string
  href: string
}

export type ProviderTuningValue = string | number | boolean

export type ProviderSampleMetadata = {
  maxSelectedSourceAudioBytes: number
  maxWindowSeconds: number
  maxSourceUploadBytes: number
  maxUploadBytes: number
  recommendedMinSeconds: number
  recommendedMaxSeconds: number
  targetSampleRateHz: number
}

export type ProviderTuningOption = {
  label: string
  value: ProviderTuningValue
}

export type ProviderTuningControl = {
  id: string
  label: string
  description: string
  type: "slider" | "toggle" | "select"
  defaultValue: ProviderTuningValue
  min?: number
  max?: number
  step?: number
  options?: ProviderTuningOption[]
  capability?: string
}

export type ProviderTuningPreset = {
  id: string
  label: string
  description: string
  voicePresetId?: VoicePresetId
  values: VoiceTuningValues
}

export type ProviderTuningMetadata = {
  controls: ProviderTuningControl[]
  presets: ProviderTuningPreset[]
  defaultValues: VoiceTuningValues
}

export type ProvidersResponse = {
  defaultProviderId: string
  providers: VoiceProvider[]
  voicePresets: VoicePreset[]
}

export type VoicePreset = {
  id: VoicePresetId
  label: string
  description: string
}

export type VoiceAsset = {
  id: string
  name: string
  filePath: string
  contentType: string
  sha256: string
  source: "default" | "upload"
  createdAt: string
  sampleMode: VoiceSampleMode
  windowStartSeconds: number | null
  windowDurationSeconds: number | null
  sourceFilePath: string | null
  sourceContentType: string | null
  sourceSha256: string | null
  voicePresetId: VoicePresetId
  voiceSettingsByProvider: Record<string, VoiceTuningValues>
  processingSteps: VoiceProcessingStep[]
}

export type VoicesResponse = {
  defaultVoiceId: string
  voices: VoiceAsset[]
}

export type VoiceProcessingStep = {
  id: string
  label: string
  operationId: SampleProcessingOperationId
  createdAt: string
  sourceSha256: string
  resultSha256: string
  engine: string | null
  processingPresetId?: SampleProcessingPresetId
  processingPresetLabel?: string | null
  speakerId?: string
  speakerLabel?: string | null
}

export type SampleProcessingOperation = {
  id: SampleProcessingOperationId
  label: string
  description: string
  enabled: boolean
  processingPresets: SampleProcessingPreset[]
  defaultProcessingPresetId: SampleProcessingPresetId | null
}

export type SampleProcessingPreset = {
  id: SampleProcessingPresetId
  label: string
  description: string
}

export type SampleProcessingOptionsResponse = {
  engine: string | null
  operations: SampleProcessingOperation[]
  recommendedWorkflowOrder: SampleProcessingOperationId[]
}

export type SampleProcessingMediaSourceChapter = {
  id: string
  title: string
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

export type SampleProcessingMediaKind = "audio" | "video"

export type SampleProcessingMediaSourceAudioStream = {
  index: number
  codecName: string | null
  sampleRateHz: number | null
  channels: number | null
  channelLayout: string | null
  language: string | null
  title: string | null
}

export type SampleProcessingMediaSource = {
  id: string
  filename: string
  contentType: string
  mediaKind: SampleProcessingMediaKind
  sizeBytes: number
  sha256: string
  durationSeconds: number | null
  sampleRateHz: number | null
  audioStreams: SampleProcessingMediaSourceAudioStream[]
  selectedAudioStream: SampleProcessingMediaSourceAudioStream | null
  selectedAudioStreamIndex: number | null
  chapters: SampleProcessingMediaSourceChapter[]
  warnings: string[]
}

export type SampleProcessingMediaSourceResponse = {
  source: SampleProcessingMediaSource
}

export type SampleProcessingAudioResult = {
  path?: string
  filename: string
  contentType: string
  sha256: string
}

export type SpeakerTranscriptItem = {
  id: string
  text: string
  startSeconds: number
  endSeconds: number
  speakerId: string
}

export type SpeakerSeparationSpeaker = {
  id: string
  label: string
  assignedName: string | null
  transcriptItemIds: string[]
  result: SampleProcessingAudioResult | null
}

export type SpeakerSeparationTranscript = {
  items: SpeakerTranscriptItem[]
}

export type SpeakerSeparationResult = {
  kind: "speakerSeparation"
  speakers: SpeakerSeparationSpeaker[]
  transcript: SpeakerSeparationTranscript
}

export type PreparedSampleCandidate = {
  candidateId: string
  rank: number
  score: number
  speakerId: string
  speakerLabel: string
  sourceWindow: {
    startSeconds: number
    endSeconds: number
    durationSeconds: number
  }
  durationSeconds: number
  sampleRateHz: number
  contentType: string
  sha256: string
  warnings: string[]
  result: SampleProcessingAudioResult
}

export type PreparedSamplesResult = {
  kind: "preparedSamples"
  warnings: string[]
  candidates: PreparedSampleCandidate[]
}

export type SampleProcessingResult = SampleProcessingAudioResult | SpeakerSeparationResult | PreparedSamplesResult

export type SampleProcessingJobStep = {
  id: string
  operationId: SampleProcessingOperationId
  operationLabel: string
  status: SampleProcessingStepStatus
  engine: string | null
  processingPresetId: SampleProcessingPresetId | null
  processingPresetLabel: string | null
  startedAt: string | null
  completedAt: string | null
  error: string | null
  sourceSha256: string | null
  resultSha256: string | null
}

export type SampleProcessingDurationRange = {
  minSeconds: number
  maxSeconds: number
}

export type SampleProcessingSourceRange = {
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  label: string | null
}

export type SampleProcessingSourceSelection = {
  sourceMediaId: string
  ranges: SampleProcessingSourceRange[]
}

export type SampleProcessingProgressPhase = {
  id: string
  label: string
  status: SampleProcessingStepStatus
  startedAt: string | null
  completedAt: string | null
  error: string | null
  detail: string | null
}

export type SampleProcessingJob = {
  id: string
  operationId: SampleProcessingOperationId
  operationLabel: string
  status: SampleProcessingJobStatus
  processingPresetId: SampleProcessingPresetId | null
  processingPresetLabel: string | null
  sourceName: string
  sourceFilename?: string | null
  sourceContentType?: string | null
  sourceSha256: string
  sourceSizeBytes?: number | null
  sourcePreference: SampleProcessingSourcePreference
  engine: string | null
  workflowMode: SampleProcessingWorkflowMode
  steps: SampleProcessingJobStep[]
  activeStepId: string | null
  estimatedDurationRangeSeconds?: SampleProcessingDurationRange | null
  progressPhases?: SampleProcessingProgressPhase[]
  activeProgressPhaseId?: string | null
  sourceSelection?: SampleProcessingSourceSelection | null
  createdAt: string
  updatedAt: string
  error: string | null
  result: SampleProcessingResult | null
}

export type SampleProcessingJobResponse = {
  job: SampleProcessingJob
}

export type SpeechJobSegment = {
  id: string
  index: number
  text: string
  voiceId: string
  voiceName: string
  assignmentKind: SpeechSegmentAssignmentKind
  voiceSettings?: VoiceTuningValues | null
  status: SpeechSegmentStatus
  generationCount: number
  characterCount: number | null
  requestId: string | null
  cacheState: string | null
  resultSha256: string | null
  error: string | null
}

export type SpeechJob = {
  id: string
  status: SpeechJobStatus
  text: string
  defaultVoiceId: string
  segmentGapMs: number
  segments: SpeechJobSegment[]
  activeSegmentId: string | null
  resultSha256: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type SpeechJobResponse = {
  job: SpeechJob
}

export type GenerationPendingSegmentStatus = "pending" | "running" | "success" | "error" | "canceled"

export type GenerationPendingSegment = {
  detail: string | null
  id: string
  index: number
  isActive: boolean
  label: string
  status: GenerationPendingSegmentStatus
  voiceName: string
}

export type GenerationPendingStatus = {
  activeDetail: string | null
  description: string
  elapsedMs: number | null
  meta: string[]
  segments: GenerationPendingSegment[]
  statusLabel: string
  title: string
}

export type SubscriptionResponse = {
  available: boolean
  error: string | null
  tier: string
  status: string
  characterCount: number
  characterLimit: number
  remainingCharacters: number
  canExtendCharacterLimit: boolean
  maxCreditLimitExtension: number | string | null
  nextCharacterCountResetUnix: number | null
}

export type ModelOption = {
  modelId: string
  name: string
  description: string
  canUseStyle: boolean
  canUseSpeakerBoost: boolean
  characterCostMultiplier: number | null
  maxCharactersRequestFreeUser: number | null
  maxCharactersRequestSubscribedUser: number | null
  maximumTextLengthPerRequest: number | null
}

export type ModelsResponse = {
  available: boolean
  error: string | null
  defaultModelId: string
  models: ModelOption[]
}

export type GeneratedResult = {
  id: string
  url: string
  sizeBytes: number
  contentType: string
  cacheState: string
  voiceId: string
  appVoiceId: string
  voiceName: string
  modelId: string
  characterCount: number | null
  requestId: string | null
  createdAt: string
  generatedAt: string
  generationElapsedMs: number | null
  multiVoiceMetadata: GeneratedAudioMultiVoiceMetadata | null
  tuningMetadata: GeneratedAudioTuningMetadata | null
}

export type GeneratedAudioTuningMode = "custom" | "default" | "preset"

export type GeneratedAudioAdjustedSetting = {
  id: string
  label: string
  nominalValue: ProviderTuningValue
  nominalValueLabel: string
  value: ProviderTuningValue
  valueLabel: string
}

export type GeneratedAudioTuningMetadata = {
  adjustedSettings: GeneratedAudioAdjustedSetting[]
  mode: GeneratedAudioTuningMode
  presetId: string | null
  presetLabel: string | null
  providerId: string
  providerLabel: string
}

export type GeneratedAudioMultiVoiceSegmentMetadata = {
  id: string
  index: number
  text: string
  voiceId: string
  voiceName: string
  assignmentKind: SpeechSegmentAssignmentKind
  voiceSettings?: VoiceTuningValues | null
  generationCount: number
  characterCount: number | null
  resultSha256: string | null
}

export type GeneratedAudioMultiVoiceVoiceMetadata = {
  voiceId: string
  voiceName: string
  segmentCount: number
}

export type GeneratedAudioMultiVoiceMetadata = {
  jobId: string
  resultSha256: string | null
  segmentCount: number
  segments: GeneratedAudioMultiVoiceSegmentMetadata[]
  voices: GeneratedAudioMultiVoiceVoiceMetadata[]
}

export type ConfirmationState = {
  body: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
  title: string
}

export type VoiceTuningValues = Partial<Record<string, ProviderTuningValue>>

export type VoiceTuningSaveRequest = {
  providerId: string | null
  shouldSaveVoicePreset: boolean
  shouldSaveVoiceSettings: boolean
  voice: VoiceAsset
  voicePresetId: VoicePresetId
  voiceSettings: VoiceTuningValues
}

export type RenameSubmitHandler = (event: FormEvent<HTMLFormElement>) => void
