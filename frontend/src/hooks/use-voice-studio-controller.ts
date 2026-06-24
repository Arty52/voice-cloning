import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { DEFAULT_TEXT } from "@/constants"
import { useConfirmation } from "@/hooks/use-confirmation"
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
import { formatBytes } from "@/lib/formatters"
import {
  buildSpeechJobSegments,
  reconcileVoiceAssignmentsForTextChange,
  type VoiceTextAssignment,
} from "@/lib/voice-assignments"
import {
  buildWorkflowSectionStatuses,
  WORKFLOW_SECTIONS,
  workflowSectionIdFromHash,
  type WorkflowSectionId,
} from "@/lib/workflow-sections"
import type { ProviderTuningMetadata, RequestStatus, VoiceAsset } from "@/types"

const EMPTY_TUNING_METADATA: ProviderTuningMetadata = {
  controls: [],
  defaultValues: {},
  presets: [],
}

export function useVoiceStudioController() {
  const [text, setText] = useState(DEFAULT_TEXT)
  const [isCostQuotaExpanded, setIsCostQuotaExpanded] = useState(false)
  const [isSampleProcessingExpanded, setIsSampleProcessingExpanded] = useState(false)
  const [isVoiceTuningExpanded, setIsVoiceTuningExpanded] = useState(false)
  const [isAddVoiceRevealed, setIsAddVoiceRevealed] = useState(false)
  const [latestGeneratedAudioId, setLatestGeneratedAudioId] = useState<string | null>(null)
  const [latestGenerationMode, setLatestGenerationMode] = useState<"single" | "multi">("single")
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
      setIsAddVoiceRevealed(false)
    },
    providerSample: providerKeys.activeProvider?.sample,
  })
  const sampleProcessing = useSampleProcessing({
    onVoiceSaved: voiceLibrary.addSavedVoice,
    selectedVoice: voiceLibrary.selectedVoice,
    voices: voiceLibrary.voices,
  })
  const workflowNavigation = useWorkflowNavigation()

  const selectedModel = metadata.models.find((model) => model.modelId === metadata.selectedModelId) ?? null
  const providerTuning = providerKeys.activeProvider?.tuning ?? EMPTY_TUNING_METADATA
  const activeProviderId = providerKeys.activeProviderId || null
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
  const characterCount = useMemo(() => text.trim().length, [text])
  const assignmentSegments = useMemo(
    () =>
      voiceLibrary.selectedVoice
        ? buildSpeechJobSegments(text, voiceAssignments, voiceLibrary.selectedVoice)
        : { error: null, segments: [], stale: voiceAssignments.length > 0 },
    [text, voiceAssignments, voiceLibrary.selectedVoice]
  )
  const hasVoiceAssignments = voiceAssignments.length > 0
  const isSpeechGenerating = speech.isGenerating || multiVoiceSpeech.isGenerating
  const activeSpeechStatus =
    latestGenerationMode === "multi" ? requestStatusFromMultiVoiceStatus(multiVoiceSpeech.status) : speech.status
  const activeSpeechError = latestGenerationMode === "multi" ? multiVoiceSpeech.error : speech.error
  const modelMultiplier = selectedModel?.characterCostMultiplier ?? null
  const estimatedCredits = modelMultiplier === null ? characterCount : Math.ceil(characterCount * modelMultiplier)
  const hasModelRate = modelMultiplier !== null
  const canGenerate =
    text.trim().length > 0 &&
    voiceLibrary.selectedVoice !== null &&
    providerKeys.canUseProvider &&
    !isSpeechGenerating &&
    (!hasVoiceAssignments || (!assignmentSegments.stale && !assignmentSegments.error && assignmentSegments.segments.length > 0))
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

  useEffect(() => {
    function handleHashChange() {
      if (workflowSectionIdFromHash(window.location.hash) !== "voices") {
        setIsAddVoiceRevealed(false)
      }
    }

    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  function navigateToSection(sectionId: WorkflowSectionId) {
    if (sectionId !== "voices") {
      setIsAddVoiceRevealed(false)
    }
    workflowNavigation.navigateToSection(sectionId)
  }

  function handleGenerate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    void generateSpeech()
  }

  function handleTextSelectionChange() {
    const textarea = textRef.current
    if (!textarea) {
      return
    }
    const start = Math.min(textarea.selectionStart, textarea.selectionEnd)
    const end = Math.max(textarea.selectionStart, textarea.selectionEnd)
    setTextSelection({
      end,
      start,
      text: textarea.value.slice(start, end),
    })
  }

  function handleTextChange(nextText: string) {
    setVoiceAssignments((current) => reconcileVoiceAssignmentsForTextChange(text, nextText, current))
    setText(nextText)
    setTextSelection({ end: 0, start: 0, text: "" })
  }

  function revealAddVoice() {
    setIsAddVoiceRevealed(true)
  }

  async function generateSpeech() {
    if (hasVoiceAssignments) {
      setLatestGenerationMode("multi")
      const generatedResult = await multiVoiceSpeech.generateSpeech({
        backendDefaultModelId: metadata.backendDefaultModelId,
        canUseProvider: providerKeys.canUseProvider,
        defaultVoice: voiceLibrary.selectedVoice,
        models: metadata.models,
        provider: providerKeys.activeProvider,
        providerId: providerKeys.activeProviderId,
        providerKey: providerKeys.activeProviderKey,
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

  function cancelGeneration() {
    if (multiVoiceSpeech.isGenerating) {
      void multiVoiceSpeech.cancelGeneration()
      return
    }
    speech.cancelGeneration()
  }

  function assignVoiceToSelection(voice: VoiceAsset) {
    if (textSelection.start === textSelection.end || !textSelection.text.trim()) {
      return
    }
    const assignment: VoiceTextAssignment = {
      end: textSelection.end,
      id: createVoiceAssignmentId(),
      sourceText: text,
      start: textSelection.start,
      text: text.slice(textSelection.start, textSelection.end),
      voiceId: voice.id,
      voiceName: voice.name,
    }
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
    estimatedCredits,
    generatedAudio,
    handleGenerate,
    handleStorageLimitChange,
    handleTextSelectionChange,
    hasModelRate,
    hasVoiceAssignments,
    isAddVoiceRevealed,
    isCostQuotaExpanded,
    isSampleProcessingExpanded,
    isVoiceTuningExpanded,
    latestGeneratedAudioItem,
    latestStorageError,
    metadata,
    navigateToSection,
    providerKeys,
    providerTuning,
    requestClearGeneratedAudio,
    requestDeleteVoice,
    result,
    revealAddVoice,
    sampleProcessing,
    sectionStatuses,
    selectedModel,
    selectedTuningPresetId,
    setIsCostQuotaExpanded,
    setIsSampleProcessingExpanded,
    setIsVoiceTuningExpanded,
    setText: handleTextChange,
    speech,
    speechError: activeSpeechError,
    speechStatus: activeSpeechStatus,
    text,
    textRef,
    textSelection,
    tuning,
    voiceInput,
    voiceAssignmentError: assignmentSegments.error,
    voiceAssignments,
    voiceAssignmentsStale: assignmentSegments.stale,
    voiceAssignmentSegments: assignmentSegments.segments,
    assignVoiceToSelection,
    clearVoiceAssignments,
    isSpeechGenerating,
    multiVoiceSpeech,
    removeVoiceAssignment,
    updateVoiceAssignment,
    voiceLibrary,
    voiceTuning,
    workflowSections: WORKFLOW_SECTIONS,
  }
}

function compareAssignments(first: VoiceTextAssignment, second: VoiceTextAssignment) {
  return first.start - second.start || first.end - second.end || first.id.localeCompare(second.id)
}

function createVoiceAssignmentId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return `assignment-${window.crypto.randomUUID()}`
  }
  return `assignment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function requestStatusFromMultiVoiceStatus(status: MultiVoiceGenerationStatus): RequestStatus {
  if (status === "starting" || status === "processing") {
    return "generating"
  }
  return status
}
