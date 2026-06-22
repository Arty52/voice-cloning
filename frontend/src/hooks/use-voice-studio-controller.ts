import { type FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import { DEFAULT_TEXT } from "@/constants"
import { useConfirmation } from "@/hooks/use-confirmation"
import { useGeneratedAudioLibrary } from "@/hooks/use-generated-audio-library"
import { useProviderKeys } from "@/hooks/use-provider-keys"
import { useSampleProcessing } from "@/hooks/use-sample-processing"
import { useSpeechGeneration } from "@/hooks/use-speech-generation"
import { useVoiceLibrary } from "@/hooks/use-voice-library"
import { useVoiceMetadata } from "@/hooks/use-voice-metadata"
import { useVoiceSampleInput } from "@/hooks/use-voice-sample-input"
import { useVoiceTuning } from "@/hooks/use-voice-tuning"
import { useWorkflowNavigation } from "@/hooks/use-workflow-navigation"
import { isTemporaryGeneratedAudioId } from "@/lib/generated-audio-view-model"
import { formatBytes } from "@/lib/formatters"
import { buildWorkflowSectionStatuses, WORKFLOW_SECTIONS } from "@/lib/workflow-sections"
import type { ProviderTuningMetadata, VoiceAsset } from "@/types"

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
  const voiceInput = useVoiceSampleInput({
    onVoiceSaved: voiceLibrary.addSavedVoice,
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
  const archivedGeneratedAudioItems = useMemo(() => {
    if (!latestGeneratedAudioId) {
      return generatedAudio.generatedAudioItems
    }
    return generatedAudio.generatedAudioItems.filter((item) => item.id !== latestGeneratedAudioId)
  }, [generatedAudio.generatedAudioItems, latestGeneratedAudioId])
  const latestStorageError =
    latestGeneratedAudioItem && isTemporaryGeneratedAudioId(latestGeneratedAudioItem.id)
      ? generatedAudio.generatedAudioStorageError
      : null
  const archiveStorageError = latestStorageError ? null : generatedAudio.generatedAudioStorageError
  const result = latestGeneratedAudioItem ?? generatedAudio.generatedAudioItems[0] ?? null
  const characterCount = useMemo(() => text.trim().length, [text])
  const modelMultiplier = selectedModel?.characterCostMultiplier ?? null
  const estimatedCredits = modelMultiplier === null ? characterCount : Math.ceil(characterCount * modelMultiplier)
  const hasModelRate = modelMultiplier !== null
  const canGenerate =
    text.trim().length > 0 && voiceLibrary.selectedVoice !== null && providerKeys.canUseProvider && !speech.isGenerating
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
        speechError: speech.error,
        speechStatus: speech.status,
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
      speech.error,
      speech.status,
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

  function handleGenerate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    void generateSpeech()
  }

  async function generateSpeech() {
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
    archivedGeneratedAudioItems,
    canGenerate,
    characterCount,
    confirmation,
    estimatedCredits,
    generatedAudio,
    handleGenerate,
    handleStorageLimitChange,
    hasModelRate,
    isCostQuotaExpanded,
    isSampleProcessingExpanded,
    latestGeneratedAudioItem,
    latestStorageError,
    metadata,
    navigateToSection: workflowNavigation.navigateToSection,
    providerKeys,
    providerTuning,
    requestClearGeneratedAudio,
    requestDeleteVoice,
    result,
    sampleProcessing,
    sectionStatuses,
    selectedModel,
    selectedTuningPresetId,
    setIsCostQuotaExpanded,
    setIsSampleProcessingExpanded,
    setText,
    speech,
    text,
    textRef,
    tuning,
    voiceInput,
    voiceLibrary,
    voiceTuning,
    workflowSections: WORKFLOW_SECTIONS,
  }
}
