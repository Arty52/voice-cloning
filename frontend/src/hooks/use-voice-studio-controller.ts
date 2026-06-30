import { type FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import { DEFAULT_TEXT, MAX_SPEECH_TEXT_LENGTH } from "@/constants"
import { useConfirmation } from "@/hooks/use-confirmation"
import { useDialogueScript } from "@/hooks/use-dialogue-script"
import { useGeneratedAudioLibrary } from "@/hooks/use-generated-audio-library"
import { useProviderKeys } from "@/hooks/use-provider-keys"
import { useSampleProcessing } from "@/hooks/use-sample-processing"
import {
  useMultiVoiceSpeechGeneration,
  type MultiVoiceGenerationStatus,
} from "@/hooks/use-multi-voice-speech-generation"
import { useSpeechGeneration } from "@/hooks/use-speech-generation"
import { useVoiceLibrary } from "@/hooks/use-voice-library"
import { useVoiceMetadata } from "@/hooks/use-voice-metadata"
import { useVoiceSampleInput } from "@/hooks/use-voice-sample-input"
import { useVoiceTuning } from "@/hooks/use-voice-tuning"
import { useWorkflowNavigation } from "@/hooks/use-workflow-navigation"
import { isTemporaryGeneratedAudioId } from "@/lib/generated-audio-view-model"
import { formatBytes, formatNumber } from "@/lib/formatters"
import type { VoiceUpdate } from "@/lib/api"
import {
  loadNaturalHandoffsPreference,
  saveNaturalHandoffsPreference,
} from "@/lib/natural-handoffs-preference"
import { readTextareaSelection } from "@/lib/text-selection"
import { resolveSavedVoiceTuning } from "@/lib/voice-tuning"
import {
  buildSpeechJobSegments,
  compareAssignments,
  createVoiceTextAssignment,
  reconcileVoiceAssignmentsForTextChange,
  type VoiceTextAssignment,
} from "@/lib/voice-assignments"
import {
  buildWorkflowSectionStatuses,
  WORKFLOW_SECTIONS,
  type WorkflowSectionId,
} from "@/lib/workflow-sections"
import type {
  GenerationPendingStatus,
  ProviderTuningMetadata,
  RequestStatus,
  SpeechJob,
  VoiceAsset,
  VoiceTuningSaveRequest,
  VoiceTuningValues,
} from "@/types"

type LatestGenerationMode = "assignments" | "dialogue" | "single"

const EMPTY_TUNING_METADATA: ProviderTuningMetadata = {
  controls: [],
  defaultValues: {},
  presets: [],
}

export function useVoiceStudioController() {
  const [text, setText] = useState(DEFAULT_TEXT)
  const [isCostQuotaExpanded, setIsCostQuotaExpanded] = useState(false)
  const [isSampleProcessingExpanded, setIsSampleProcessingExpanded] = useState(false)
  const [latestGeneratedAudioId, setLatestGeneratedAudioId] = useState<string | null>(null)
  const [latestGenerationMode, setLatestGenerationMode] = useState<LatestGenerationMode>("single")
  const [savedNaturalHandoffsEnabled, setSavedNaturalHandoffsEnabled] = useState(() =>
    loadNaturalHandoffsPreference()
  )
  const [naturalHandoffsEnabled, setNaturalHandoffsEnabled] = useState(() =>
    loadNaturalHandoffsPreference()
  )
  const [naturalHandoffsSaveError, setNaturalHandoffsSaveError] = useState<string | null>(null)
  const [textSelection, setTextSelection] = useState({ end: 0, start: 0, text: "" })
  const [voiceAssignments, setVoiceAssignments] = useState<VoiceTextAssignment[]>([])
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const confirmation = useConfirmation()
  const providerKeys = useProviderKeys()
  const voiceLibrary = useVoiceLibrary()
  const metadata = useVoiceMetadata({
    canUseProvider: providerKeys.canUseProvider,
    providerId: providerKeys.activeProviderId,
    providerKey: providerKeys.activeProviderKey,
    providerStatus: providerKeys.providerStatus,
  })
  const generatedAudio = useGeneratedAudioLibrary()
  const speech = useSpeechGeneration({
    persistGeneratedAudio: generatedAudio.persistGeneratedAudio,
  })
  const multiVoiceSpeech = useMultiVoiceSpeechGeneration({
    persistGeneratedAudio: generatedAudio.persistGeneratedAudio,
  })
  const voiceInput = useVoiceSampleInput({
    onVoiceSaved: (voice) => {
      voiceLibrary.addSavedVoice(voice)
    },
    providerSample: providerKeys.activeProvider?.sample,
  })
  const sampleProcessing = useSampleProcessing({
    onVoiceSaved: voiceLibrary.addSavedVoice,
    selectedVoice: voiceLibrary.selectedVoice,
    voices: voiceLibrary.voices,
  })
  const selectedModel = metadata.models.find((model) => model.modelId === metadata.selectedModelId) ?? null
  const providerTuning = providerKeys.activeProvider?.tuning ?? EMPTY_TUNING_METADATA
  const activeProviderId = providerKeys.activeProviderId || null
  const savedVoiceSettingsByVoiceId = useMemo(
    () => buildSavedVoiceSettingsByVoiceId(activeProviderId, voiceLibrary.voices),
    [activeProviderId, voiceLibrary.voices]
  )
  const dialogue = useDialogueScript({
    defaultVoice: voiceLibrary.selectedVoice,
    voiceSettingsByVoiceId: savedVoiceSettingsByVoiceId,
    voices: voiceLibrary.voices,
  })
  const workflowNavigation = useWorkflowNavigation()

  const voiceTuning = useVoiceTuning({
    activeProviderId,
    providerTuning,
    selectedVoice: voiceLibrary.selectedVoice,
  })
  const tuning = voiceTuning.tuning
  const selectedTuningPresetId = voiceTuning.selectedTuningPresetId
  const latestGeneratedAudioItem = useMemo(() => {
    if (!latestGeneratedAudioId) {
      return null
    }
    return generatedAudio.generatedAudioItems.find((item) => item.id === latestGeneratedAudioId) ?? null
  }, [generatedAudio.generatedAudioItems, latestGeneratedAudioId])
  const latestStorageError =
    latestGeneratedAudioItem && isTemporaryGeneratedAudioId(latestGeneratedAudioItem.id)
      ? generatedAudio.generatedAudioStorageError
      : null
  const archiveStorageError = latestStorageError ? null : generatedAudio.generatedAudioStorageError
  const result = latestGeneratedAudioItem ?? generatedAudio.generatedAudioItems[0] ?? null
  const isDialogueMode = dialogue.mode === "dialogue"
  const dialogueText = dialogue.segmentBuild.text
  const characterCount = useMemo(
    () => (isDialogueMode ? dialogueText.trim().length : text.trim().length),
    [dialogueText, isDialogueMode, text]
  )
  const assignmentSegments = useMemo(
    () =>
      voiceLibrary.selectedVoice
        ? buildSpeechJobSegments(text, voiceAssignments, voiceLibrary.selectedVoice, {
            voiceSettingsByVoiceId: savedVoiceSettingsByVoiceId,
          })
        : { error: null, segments: [], stale: voiceAssignments.length > 0 },
    [savedVoiceSettingsByVoiceId, text, voiceAssignments, voiceLibrary.selectedVoice]
  )
  const missingAssignedVoiceError = useMemo(() => {
    if (voiceAssignments.length === 0) {
      return null
    }
    const availableVoiceIds = new Set(voiceLibrary.voices.map((voice) => voice.id))
    return voiceAssignments.some((assignment) => !availableVoiceIds.has(assignment.voiceId))
      ? "Some assigned voices are no longer in the Voice Library. Remove or update those assignments before generating."
      : null
  }, [voiceAssignments, voiceLibrary.voices])
  const voiceAssignmentError = isDialogueMode ? dialogue.segmentBuild.error : assignmentSegments.error ?? missingAssignedVoiceError
  const hasVoiceAssignments = voiceAssignments.length > 0
  const voiceAssignmentSpeechSegmentCount =
    !isDialogueMode && hasVoiceAssignments && !assignmentSegments.stale && !voiceAssignmentError
      ? assignmentSegments.segments.length
      : null
  const dialogueSpeechSegmentCount =
    isDialogueMode && !dialogue.segmentBuild.error ? dialogue.segmentBuild.segments.length : null
  const isSpeechGenerating = speech.isGenerating || multiVoiceSpeech.isGenerating
  const isMultiVoiceGenerationMode = latestGenerationMode !== "single"
  const activeSpeechStatus = isMultiVoiceGenerationMode ? requestStatusFromMultiVoiceStatus(multiVoiceSpeech.status) : speech.status
  const activeSpeechError = isMultiVoiceGenerationMode ? multiVoiceSpeech.error : speech.error
  const generationPendingStatus = isSpeechGenerating
    ? buildGenerationPendingStatus({
        characterCount,
        job: multiVoiceSpeech.job,
        latestGenerationMode,
        multiVoiceElapsedMs: multiVoiceSpeech.generationElapsedMs,
        multiVoiceStatus: multiVoiceSpeech.status,
        selectedVoiceName: voiceLibrary.selectedVoice?.name ?? null,
        singleElapsedMs: speech.generationElapsedMs,
      })
    : null
  const modelMultiplier = selectedModel?.characterCostMultiplier ?? null
  const estimatedCredits = modelMultiplier === null ? characterCount : Math.ceil(characterCount * modelMultiplier)
  const hasModelRate = modelMultiplier !== null
  const isWithinSpeechTextLimit = characterCount <= MAX_SPEECH_TEXT_LENGTH
  const canGenerate =
    characterCount > 0 &&
    isWithinSpeechTextLimit &&
    voiceLibrary.selectedVoice !== null &&
    providerKeys.canUseProvider &&
    !isSpeechGenerating &&
    (isDialogueMode
      ? !voiceAssignmentError && dialogue.segmentBuild.segments.length > 0
      : !hasVoiceAssignments || (!assignmentSegments.stale && !voiceAssignmentError && assignmentSegments.segments.length > 0))
  const sectionStatuses = useMemo(
    () =>
      buildWorkflowSectionStatuses({
        canUseProvider: providerKeys.canUseProvider,
        generatedAudioCount: generatedAudio.generatedAudioItems.length,
        generatedAudioMutation: generatedAudio.generatedAudioMutation,
        generatedAudioStatus: generatedAudio.generatedAudioStatus,
        generatedAudioStorageError: generatedAudio.generatedAudioStorageError,
        keySource: providerKeys.keySource,
        processingEnabledOperationCount: sampleProcessing.enabledOperations.length,
        processingOptionsError: sampleProcessing.optionsError,
        processingOptionsStatus: sampleProcessing.optionsStatus,
        processingStatus: sampleProcessing.status,
        providerError: providerKeys.providerError,
        providerStatus: providerKeys.providerStatus,
        selectedVoiceId: voiceLibrary.selectedVoiceId,
        speechError: activeSpeechError,
        speechStatus: activeSpeechStatus,
        voiceError: voiceLibrary.voiceError,
        voiceStatus: voiceLibrary.voiceStatus,
      }),
    [
      generatedAudio.generatedAudioItems.length,
      generatedAudio.generatedAudioMutation,
      generatedAudio.generatedAudioStatus,
      generatedAudio.generatedAudioStorageError,
      providerKeys.canUseProvider,
      providerKeys.keySource,
      providerKeys.providerError,
      providerKeys.providerStatus,
      sampleProcessing.enabledOperations.length,
      sampleProcessing.optionsError,
      sampleProcessing.optionsStatus,
      sampleProcessing.status,
      activeSpeechError,
      activeSpeechStatus,
      voiceLibrary.selectedVoiceId,
      voiceLibrary.voiceError,
      voiceLibrary.voiceStatus,
    ]
  )

  useLayoutEffect(() => {
    const textarea = textRef.current
    if (!textarea) {
      return
    }
    textarea.style.height = "auto"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [text])

  function navigateToSection(sectionId: WorkflowSectionId) {
    workflowNavigation.navigateToSection(sectionId)
  }

  function handleGenerate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    void generateSpeech()
  }

  function handleTextSelectionChange() {
    const selection = readTextareaSelection(textRef.current)
    if (!selection) {
      return
    }
    setTextSelection(selection)
  }

  function handleTextChange(nextText: string) {
    setVoiceAssignments((current) => reconcileVoiceAssignmentsForTextChange(text, nextText, current))
    setText(nextText)
    setTextSelection({ end: 0, start: 0, text: "" })
  }

  function handleNaturalHandoffsEnabledChange(enabled: boolean) {
    setNaturalHandoffsEnabled(enabled)
    setNaturalHandoffsSaveError(null)
  }

  function saveNaturalHandoffsDefault() {
    try {
      const saved = saveNaturalHandoffsPreference(naturalHandoffsEnabled)
      setSavedNaturalHandoffsEnabled(saved)
      setNaturalHandoffsSaveError(null)
    } catch (caught) {
      setNaturalHandoffsSaveError(
        caught instanceof Error ? caught.message : "Unable to save natural handoffs preference."
      )
    }
  }

  async function generateSpeech() {
    if (isDialogueMode) {
      setLatestGenerationMode("dialogue")
      const generatedResult = await multiVoiceSpeech.generateSpeech({
        backendDefaultModelId: metadata.backendDefaultModelId,
        canUseProvider: providerKeys.canUseProvider,
        defaultVoice: voiceLibrary.selectedVoice,
        models: metadata.models,
        provider: providerKeys.activeProvider,
        providerId: providerKeys.activeProviderId,
        providerKey: providerKeys.activeProviderKey,
        segmentGapMs: naturalHandoffsEnabled ? undefined : 0,
        segments: dialogue.segmentBuild.segments,
        selectedModelId: metadata.selectedModelId,
        selectedTuningPresetId,
        storageLimitBytes: generatedAudio.storageLimitBytes,
        text: dialogue.segmentBuild.text,
        tuning,
      })
      if (generatedResult) {
        setLatestGeneratedAudioId(generatedResult.id)
      }
      return
    }

    if (hasVoiceAssignments) {
      setLatestGenerationMode("assignments")
      const generatedResult = await multiVoiceSpeech.generateSpeech({
        backendDefaultModelId: metadata.backendDefaultModelId,
        canUseProvider: providerKeys.canUseProvider,
        defaultVoice: voiceLibrary.selectedVoice,
        models: metadata.models,
        provider: providerKeys.activeProvider,
        providerId: providerKeys.activeProviderId,
        providerKey: providerKeys.activeProviderKey,
        segmentGapMs: naturalHandoffsEnabled ? undefined : 0,
        segments: assignmentSegments.segments,
        selectedModelId: metadata.selectedModelId,
        selectedTuningPresetId,
        storageLimitBytes: generatedAudio.storageLimitBytes,
        text,
        tuning,
      })
      if (generatedResult) {
        setLatestGeneratedAudioId(generatedResult.id)
      }
      return
    }

    setLatestGenerationMode("single")
    const generatedResult = await speech.generateSpeech({
      backendDefaultModelId: metadata.backendDefaultModelId,
      canUseProvider: providerKeys.canUseProvider,
      models: metadata.models,
      provider: providerKeys.activeProvider,
      providerId: providerKeys.activeProviderId,
      providerKey: providerKeys.activeProviderKey,
      selectedModelId: metadata.selectedModelId,
      selectedTuningPresetId,
      selectedVoice: voiceLibrary.selectedVoice,
      storageLimitBytes: generatedAudio.storageLimitBytes,
      text,
      tuning,
    })
    if (generatedResult) {
      setLatestGeneratedAudioId(generatedResult.id)
    }
  }

  async function regenerateMultiVoiceSegment(
    segmentId: string,
    voiceId?: string | null,
    voiceSettings?: VoiceTuningValues | null
  ) {
    setLatestGenerationMode("assignments")
    const generatedResult = await multiVoiceSpeech.regenerateSegment({
      providerKey: providerKeys.activeProviderKey,
      segmentId,
      storageLimitBytes: generatedAudio.storageLimitBytes,
      voiceId,
      voiceSettings,
    })
    if (generatedResult) {
      setLatestGeneratedAudioId(generatedResult.id)
    }
  }

  async function regenerateMultiVoiceSegmentsForVoice(voiceId: string, voiceSettings: VoiceTuningValues) {
    setLatestGenerationMode("assignments")
    const generatedResult = await multiVoiceSpeech.regenerateVoiceSegments({
      providerKey: providerKeys.activeProviderKey,
      storageLimitBytes: generatedAudio.storageLimitBytes,
      voiceId,
      voiceSettings,
    })
    if (generatedResult) {
      setLatestGeneratedAudioId(generatedResult.id)
    }
  }

  async function saveGeneratedSegmentTuningToVoice(voiceId: string, voiceSettings: VoiceTuningValues) {
    if (!activeProviderId) {
      voiceLibrary.setVoiceError("Select a provider before saving voice tuning.")
      return
    }
    const voice = voiceLibrary.voices.find((candidate) => candidate.id === voiceId)
    if (!voice) {
      voiceLibrary.setVoiceError("Voice is no longer in the Voice Library.")
      return
    }
    await voiceLibrary.updateVoiceSettings(voice, activeProviderId, voiceSettings)
  }

  async function saveVoiceTuningDraft(request: VoiceTuningSaveRequest) {
    const update: VoiceUpdate = {}
    if (request.shouldSaveVoicePreset) {
      update.voicePresetId = request.voicePresetId
    }
    if (request.shouldSaveVoiceSettings) {
      if (!request.providerId) {
        voiceLibrary.setVoiceError("Select a provider before saving voice tuning.")
        return
      }
      update.providerId = request.providerId
      update.voiceSettings = request.voiceSettings
    }
    if (request.shouldSaveVoicePreset || request.shouldSaveVoiceSettings) {
      await voiceLibrary.updateVoice(request.voice, update, "Unable to save voice tuning.")
    }
  }

  function requestSaveVoiceTuningDraft(request: VoiceTuningSaveRequest) {
    if (request.shouldSaveVoiceSettings && !request.providerId) {
      voiceLibrary.setVoiceError("Select a provider before saving voice tuning.")
      return
    }
    confirmation.requestConfirmation({
      body: "Saving changes updates this voice's default tuning for future generations. Existing generated audio will not be affected.",
      confirmLabel: "Save Voice Tuning",
      onConfirm: () => saveVoiceTuningDraft(request),
      title: "Save Voice Tuning?",
    })
  }

  function cancelGeneration() {
    if (multiVoiceSpeech.isGenerating) {
      void multiVoiceSpeech.cancelGeneration()
      return
    }
    speech.cancelGeneration()
  }

  function assignVoiceToSelection(voice: VoiceAsset) {
    const selection = readTextareaSelection(textRef.current) ?? textSelection
    const assignment = createVoiceTextAssignment({
      id: createVoiceAssignmentId(),
      selection,
      sourceText: text,
      voice,
    })
    if (!assignment) {
      return
    }
    setTextSelection(selection)
    setVoiceAssignments((current) =>
      [...current.filter((candidate) => candidate.end <= assignment.start || candidate.start >= assignment.end), assignment].sort(
        compareAssignments
      )
    )
  }

  function updateVoiceAssignment(assignmentId: string, voice: VoiceAsset) {
    setVoiceAssignments((current) =>
      current.map((assignment) =>
        assignment.id === assignmentId
          ? {
              ...assignment,
              voiceId: voice.id,
              voiceName: voice.name,
            }
          : assignment
      )
    )
  }

  function removeVoiceAssignment(assignmentId: string) {
    setVoiceAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId))
  }

  function clearVoiceAssignments() {
    setVoiceAssignments([])
  }

  function requestDeleteVoice(voice: VoiceAsset) {
    confirmation.requestConfirmation({
      body: `Delete "${voice.name}" from the local voice library? This removes the saved sample file and cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => voiceLibrary.deleteVoice(voice),
      title: "Delete Voice",
    })
  }

  function requestClearGeneratedAudio() {
    if (generatedAudio.generatedAudioItems.length === 0) {
      return
    }
    confirmation.requestConfirmation({
      body: "This removes every saved generated audio item from this browser.",
      confirmLabel: "Clear All",
      destructive: true,
      onConfirm: generatedAudio.clearAllGeneratedAudio,
      title: "Clear Generated Audio?",
    })
  }

  function handleStorageLimitChange(nextLimitBytes: number) {
    if (nextLimitBytes === generatedAudio.storageLimitBytes) {
      return
    }

    const usedBytes = generatedAudio.generatedAudioUsage?.usedBytes ?? 0
    if (nextLimitBytes < generatedAudio.storageLimitBytes && usedBytes > nextLimitBytes) {
      confirmation.requestConfirmation({
        body: `This will remove the oldest saved generated audio until usage fits under ${formatBytes(nextLimitBytes)}.`,
        confirmLabel: "Lower Cap",
        destructive: true,
        onConfirm: () => generatedAudio.applyGeneratedAudioStorageLimit(nextLimitBytes),
        title: "Lower Storage Cap?",
      })
      return
    }

    void generatedAudio.applyGeneratedAudioStorageLimit(nextLimitBytes)
  }

  return {
    activeSectionId: workflowNavigation.activeSectionId,
    archiveStorageError,
    canGenerate,
    cancelGeneration,
    characterCount,
    confirmation,
    dialogue,
    dialogueSpeechSegmentCount,
    estimatedCredits,
    generatedAudio,
    handleGenerate,
    handleStorageLimitChange,
    handleTextSelectionChange,
    hasModelRate,
    hasVoiceAssignments,
    generationPendingStatus,
    isCostQuotaExpanded,
    isSampleProcessingExpanded,
    latestGeneratedAudioItem,
    latestStorageError,
    metadata,
    navigateToSection,
    naturalHandoffsDefaultEnabled: savedNaturalHandoffsEnabled,
    naturalHandoffsEnabled,
    naturalHandoffsSaveError,
    naturalHandoffsUnsaved: naturalHandoffsEnabled !== savedNaturalHandoffsEnabled,
    providerKeys,
    providerTuning,
    requestClearGeneratedAudio,
    requestDeleteVoice,
    requestSaveVoiceTuningDraft,
    regenerateMultiVoiceSegment,
    regenerateMultiVoiceSegmentsForVoice,
    result,
    sampleProcessing,
    saveNaturalHandoffsDefault,
    saveGeneratedSegmentTuningToVoice,
    sectionStatuses,
    selectedModel,
    selectedTuningPresetId,
    setIsCostQuotaExpanded,
    setIsSampleProcessingExpanded,
    setNaturalHandoffsEnabled: handleNaturalHandoffsEnabledChange,
    setText: handleTextChange,
    speech,
    speechError: activeSpeechError,
    speechStatus: activeSpeechStatus,
    text,
    textRef,
    textSelection,
    tuning,
    voiceInput,
    voiceAssignmentError,
    voiceAssignments,
    voiceAssignmentsStale: assignmentSegments.stale,
    voiceAssignmentSpeechSegmentCount,
    voiceAssignmentSegments: assignmentSegments.segments,
    assignVoiceToSelection,
    clearVoiceAssignments,
    isSpeechGenerating,
    multiVoiceSpeech,
    multiVoiceSegmentResultUrls: multiVoiceSpeech.segmentResultUrls,
    removeVoiceAssignment,
    updateVoiceAssignment,
    voiceLibrary,
    workflowSections: WORKFLOW_SECTIONS,
  }
}

function buildSavedVoiceSettingsByVoiceId(activeProviderId: string | null, voices: VoiceAsset[]) {
  const entries: [string, VoiceTuningValues][] = []
  for (const voice of voices) {
    const settings = resolveSavedVoiceTuning(activeProviderId, voice)
    if (settings) {
      entries.push([voice.id, settings])
    }
  }
  return Object.fromEntries(entries)
}

function createVoiceAssignmentId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return `assignment-${window.crypto.randomUUID()}`
  }
  return `assignment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function buildGenerationPendingStatus({
  characterCount,
  job,
  latestGenerationMode,
  multiVoiceElapsedMs,
  multiVoiceStatus,
  selectedVoiceName,
  singleElapsedMs,
}: {
  characterCount: number
  job: SpeechJob | null
  latestGenerationMode: LatestGenerationMode
  multiVoiceElapsedMs: number | null
  multiVoiceStatus: MultiVoiceGenerationStatus
  selectedVoiceName: string | null
  singleElapsedMs: number | null
}): GenerationPendingStatus {
  if (latestGenerationMode === "single") {
    return {
      activeDetail: selectedVoiceName ? `Voice: ${selectedVoiceName}` : null,
      description: selectedVoiceName
        ? `Generating speech with ${selectedVoiceName}.`
        : "Generating speech with the selected voice.",
      elapsedMs: singleElapsedMs,
      meta: [selectedVoiceName ?? "Selected Voice", `${formatNumber(characterCount)} Characters`],
      segments: [],
      statusLabel: "Running",
      title: "Generating Speech",
    }
  }

  const segments = job?.segments ?? []
  const activeSegment =
    segments.find((segment) => segment.id === job?.activeSegmentId) ??
    segments.find((segment) => segment.status === "running") ??
    null
  const activeSegmentId = job?.activeSegmentId ?? activeSegment?.id ?? null
  const title = latestGenerationMode === "dialogue" ? "Generating Dialogue" : "Generating Assigned Speech"
  const description =
    latestGenerationMode === "dialogue"
      ? "Rendering dialogue rows into a combined audio result."
      : "Rendering assigned text ranges into a combined audio result."

  return {
    activeDetail: activeSegment ? `Segment ${activeSegment.index + 1}: ${activeSegment.voiceName}` : null,
    description,
    elapsedMs: multiVoiceElapsedMs,
    meta: segments.length > 0 ? [`${formatNumber(segments.length)} Segments`] : ["Preparing Job"],
    segments: segments.map((segment) => ({
      detail: segment.error || formatPendingSegmentText(segment.text),
      id: segment.id,
      index: segment.index,
      isActive: segment.id === activeSegmentId,
      label: `Segment ${segment.index + 1}`,
      status: segment.status,
      voiceName: segment.voiceName,
    })),
    statusLabel: multiVoiceStatus === "starting" ? "Starting" : "Running",
    title,
  }
}

function formatPendingSegmentText(text: string, maxLength = 72) {
  const normalized = text
    .replace(/\r?\n/g, " / ")
    .replace(/[ \t]+/g, " ")
    .trim()
  if (!normalized) {
    return null
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  if (maxLength <= 0) {
    return ""
  }

  const ellipsis = "..."
  if (maxLength <= ellipsis.length) {
    return ellipsis.slice(0, maxLength)
  }

  return `${normalized.slice(0, maxLength - ellipsis.length)}${ellipsis}`
}

function requestStatusFromMultiVoiceStatus(status: MultiVoiceGenerationStatus): RequestStatus {
  if (status === "starting" || status === "processing") {
    return "generating"
  }
  return status
}
