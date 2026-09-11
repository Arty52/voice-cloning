import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { DEFAULT_TEXT, MAX_SPEECH_TEXT_LENGTH } from "@/constants"
import { useConfirmation } from "@/hooks/use-confirmation"
import { useDialogueScript } from "@/hooks/use-dialogue-script"
import { useDialogueWorkspace } from "@/hooks/use-dialogue-workspace"
import type { DialogueDraft } from "@/lib/dialogue-draft"
import { useGeneratedAudioLibrary } from "@/hooks/use-generated-audio-library"
import { useProviderKeys } from "@/hooks/use-provider-keys"
import { useSampleProcessing } from "@/hooks/use-sample-processing"
import { useTranscriptWorkflow } from "@/hooks/use-transcript-workflow"
import { useUserTuningPresets } from "@/hooks/use-user-tuning-presets"
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
import { buildDialogueScriptSnapshot, buildRangeScriptSnapshot } from "@/lib/generated-audio-script-snapshot"
import { dialogueRowState } from "@/lib/dialogue-row-state"
import { dialogueRevisionState, revisionScriptSnapshot, type DialogueBaseline } from "@/lib/dialogue-revisions"
import { isTemporaryGeneratedAudioId } from "@/lib/generated-audio-view-model"
import { isAppSettingsUnavailableError, loadAppSettings, saveAppSettings } from "@/lib/app-settings-api"
import { formatBytes, formatNumber } from "@/lib/formatters"
import type { VoiceUpdate } from "@/lib/api"
import {
  loadNaturalHandoffsPreference,
  saveNaturalHandoffsPreference,
} from "@/lib/natural-handoffs-preference"
import { readTextareaSelection } from "@/lib/text-selection"
import { CUSTOM_TUNING_PRESET_ID, resolveEffectiveVoiceTuning, userPresetValues } from "@/lib/voice-tuning"
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
  GeneratedAudioScriptSnapshot,
  GeneratedAudioScriptSnapshotAssignment,
  GeneratedAudioScriptSnapshotDialogueBlock,
  GeneratedAudioScriptSnapshotSpeakerMapping,
  ProviderTuningMetadata,
  RequestStatus,
  SpeechJob,
  UserTuningPreset,
  VoiceAsset,
  VoiceTuningSaveRequest,
  VoiceTuningValues,
} from "@/types"

type LatestGenerationMode = "assignments" | "dialogue" | "single"

const SCRIPT_RESTORE_MISSING_VOICE_WARNING =
  "Some voices referenced by this script are no longer in the Voice Library. The script was restored, but missing voice assignments need to be updated before generating."

const EMPTY_TUNING_METADATA: ProviderTuningMetadata = {
  controls: [],
  defaultValues: {},
  presets: [],
}

export function useVoiceStudioController() {
  const [text, setText] = useState(DEFAULT_TEXT)
  const [sourceExpanded, setSourceExpanded] = useState(true)
  const [sourceError, setSourceError] = useState<string | null>(null)
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
  const [scriptRestoreWarning, setScriptRestoreWarning] = useState<string | null>(null)
  const [selectedUserTuningPresetId, setSelectedUserTuningPresetId] = useState<string | null>(null)
  const [textSelection, setTextSelection] = useState({ end: 0, start: 0, text: "" })
  const [voiceAssignments, setVoiceAssignments] = useState<VoiceTextAssignment[]>([])
  const naturalHandoffsTouchedRef = useRef(false)
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
  const generatedAudio = useGeneratedAudioLibrary(providerKeys.activeProvider)
  const userTuningPresets = useUserTuningPresets()
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
  const transcript = useTranscriptWorkflow({
    availabilityError: sampleProcessing.optionsError,
    availabilityStatus: sampleProcessing.optionsStatus,
    diarizationAvailable: sampleProcessing.canDetectSpeakers,
    onVoiceSaved: voiceLibrary.addSavedVoice,
  })
  const selectedModel = metadata.models.find((model) => model.modelId === metadata.selectedModelId) ?? null
  const providerTuning = providerKeys.activeProvider?.tuning ?? EMPTY_TUNING_METADATA
  const activeProviderId = providerKeys.activeProviderId || null
  const effectiveVoiceSettingsByVoiceId = useMemo(
    () => buildEffectiveVoiceSettingsByVoiceId(activeProviderId, providerTuning, voiceLibrary.voices),
    [activeProviderId, providerTuning, voiceLibrary.voices]
  )
  const dialogue = useDialogueScript({
    defaultVoice: voiceLibrary.selectedVoice,
    voiceSettingsByVoiceId: effectiveVoiceSettingsByVoiceId,
    voices: voiceLibrary.voices,
  })
  const workflowNavigation = useWorkflowNavigation()

  const voiceTuning = useVoiceTuning({
    activeProviderId,
    providerTuning,
    selectedVoice: voiceLibrary.selectedVoice,
  })
  const selectedUserTuningPreset = useMemo(
    () =>
      userTuningPresets.presets.find(
        (preset) => preset.id === selectedUserTuningPresetId && preset.providerId === activeProviderId
      ) ?? null,
    [activeProviderId, selectedUserTuningPresetId, userTuningPresets.presets]
  )
  const tuning = useMemo(
    () => (selectedUserTuningPreset ? userPresetValues(providerTuning, selectedUserTuningPreset) : voiceTuning.tuning),
    [providerTuning, selectedUserTuningPreset, voiceTuning.tuning]
  )
  const selectedTuningPresetId = selectedUserTuningPreset
    ? CUSTOM_TUNING_PRESET_ID
    : voiceTuning.selectedTuningPresetId
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
  const successfulRun = multiVoiceSpeech.successfulRun
  const dialogueBaseline: DialogueBaseline | null = successfulRun?.context.dialogueId && successfulRun.context.scriptSnapshot
    ? {
        dialogueId: successfulRun.context.dialogueId,
        job: successfulRun.job,
        providerId: successfulRun.context.provider?.id ?? successfulRun.context.providerId ?? null,
        modelId: successfulRun.context.modelId ?? successfulRun.context.backendDefaultModelId,
        tuning: successfulRun.context.tuning,
        scriptSnapshot: successfulRun.context.scriptSnapshot,
      }
    : null
  const dialogueRevision = dialogueRevisionState({
    dialogueId: dialogue.identity, baseline: dialogueBaseline, segments: dialogue.segmentBuild.segments,
    providerId: activeProviderId, modelId: selectedModel?.modelId ?? metadata.backendDefaultModelId,
    tuning, defaults: providerTuning.defaultValues, naturalHandoffs: naturalHandoffsEnabled,
  })
  const dialogueText = dialogue.segmentBuild.text
  const characterCount = useMemo(
    () => (isDialogueMode ? dialogueText.trim().length : text.trim().length),
    [dialogueText, isDialogueMode, text]
  )
  const assignmentSegments = useMemo(
    () =>
      voiceLibrary.selectedVoice
        ? buildSpeechJobSegments(text, voiceAssignments, voiceLibrary.selectedVoice, {
            voiceSettingsByVoiceId: effectiveVoiceSettingsByVoiceId,
          })
        : { error: null, segments: [], stale: voiceAssignments.length > 0 },
    [effectiveVoiceSettingsByVoiceId, text, voiceAssignments, voiceLibrary.selectedVoice]
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
  const dialogueWorkspace = useDialogueWorkspace({
    ready: !["idle", "loading"].includes(voiceLibrary.voiceStatus) &&
      !["idle", "loading"].includes(providerKeys.providerStatus) &&
      !["idle", "loading"].includes(metadata.modelStatus) &&
      !["idle", "loading"].includes(generatedAudio.generatedAudioStatus),
    draft: isDialogueMode ? {
      identity: dialogue.identity, sourceText: text, sourceExpanded, blocks: dialogue.blocks,
      speakerMappings: dialogue.speakerMappings, sourceVoiceId: voiceLibrary.selectedVoiceId || null,
      providerId: activeProviderId, modelId: metadata.selectedModelId,
      selectedUserTuningPresetId, naturalHandoffs: naturalHandoffsEnabled,
      speech: multiVoiceSpeech.recovery,
    } : null,
    applyDraft: applyWorkspaceDraft,
    speech: multiVoiceSpeech, providers: providerKeys.providers ?? [],
    archivedItems: generatedAudio.generatedAudioItems, onResult: setLatestGeneratedAudioId,
  })

  function applyWorkspaceDraft(draft: DialogueDraft | null) {
    setText(draft?.sourceText ?? DEFAULT_TEXT)
    setSourceExpanded(draft?.sourceExpanded ?? true)
    setSelectedUserTuningPresetId(draft?.selectedUserTuningPresetId ?? null)
    setVoiceAssignments([])
    dialogue.restoreState({
      blocks: draft?.blocks ?? [], speakerMappings: draft?.speakerMappings ?? [],
      identity: draft?.identity, mode: draft ? "dialogue" : "range",
    })
    if (draft) {
      voiceLibrary.setSelectedVoiceId(draft.sourceVoiceId ?? "")
      metadata.restoreSelectedModelId(draft.modelId)
      handleNaturalHandoffsEnabledChange(draft.naturalHandoffs)
      setLatestGenerationMode("dialogue")
    }
  }

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
        transcriptError: transcript.error,
        transcriptStatus: transcript.status,
        transcriptUnavailableReason: transcript.unavailableReason,
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
      transcript.error,
      transcript.status,
      transcript.unavailableReason,
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
  }, [text, sourceExpanded, dialogue.mode])

  useEffect(() => {
    let isMounted = true

    async function loadSavedAppSettings() {
      try {
        const response = await loadAppSettings()
        if (!isMounted) {
          return
        }
        const enabled = response.settings.naturalHandoffs.enabled
        setSavedNaturalHandoffsEnabled(enabled)
        if (!naturalHandoffsTouchedRef.current) {
          setNaturalHandoffsEnabled(enabled)
        }
      } catch (caught) {
        if (!isAppSettingsUnavailableError(caught) && isMounted) {
          setNaturalHandoffsSaveError(caught instanceof Error ? caught.message : "Unable to load app settings.")
        }
      }
    }

    void loadSavedAppSettings()
    return () => {
      isMounted = false
    }
  }, [])

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
    setScriptRestoreWarning(null)
    setVoiceAssignments((current) => reconcileVoiceAssignmentsForTextChange(text, nextText, current))
    setText(nextText)
    setTextSelection({ end: 0, start: 0, text: "" })
  }

  function handleNaturalHandoffsEnabledChange(enabled: boolean) {
    naturalHandoffsTouchedRef.current = true
    setNaturalHandoffsEnabled(enabled)
    setNaturalHandoffsSaveError(null)
  }

  async function saveNaturalHandoffsDefault() {
    try {
      try {
        await saveAppSettings({ naturalHandoffs: { enabled: naturalHandoffsEnabled } })
      } catch (caught) {
        if (!isAppSettingsUnavailableError(caught)) {
          throw caught
        }
      }
      const saved = saveNaturalHandoffsPreference(naturalHandoffsEnabled)
      setSavedNaturalHandoffsEnabled(saved)
      setNaturalHandoffsSaveError(null)
    } catch (caught) {
      setNaturalHandoffsSaveError(
        caught instanceof Error ? caught.message : "Unable to save natural handoffs preference."
      )
    }
  }

  function importDialogue() {
    if (isSpeechGenerating || dialogueWorkspace.isRestoring) return
    const importSource = () => {
      if (!dialogue.importFromText(text)) {
        setSourceError("Enter speakable dialogue before importing.")
        return
      }
      setSourceError(null)
      setSourceExpanded(false)
      window.requestAnimationFrame(() => document.getElementById("dialogue-source-toggle")?.focus({ preventScroll: true }))
    }
    if (dialogue.blocks.length > 0) {
      confirmation.requestConfirmation({
        title: "Reimport Dialogue?",
        body: "This replaces the current rows, row edits, and voice overrides with the source text. Matching speaker mappings are kept.",
        confirmLabel: "Reimport Dialogue",
        destructive: true,
        onConfirm: importSource,
      })
    } else importSource()
  }

  async function reviseDialogueRows(ids: string[], voiceSettings?: VoiceTuningValues) {
    if (!canGenerate || dialogueWorkspace.isRestoring || !dialogueRevision.canRevise || !dialogueBaseline) return
    if (ids.length === 0 && !dialogueRevision.spacingChanged) return
    const selected = new Set(ids)
    setLatestGenerationMode("dialogue")
    const draft = buildDialogueScriptSnapshot({
      dialogueBlocks: dialogue.blocks.map(block => voiceSettings && selected.has(block.id) ? { ...block, voiceSettings } : block), speakerMappings: dialogue.speakerMappings,
      sourceVoiceId: voiceLibrary.selectedVoice?.id, text: dialogue.segmentBuild.text,
      segmentGapMs: naturalHandoffsEnabled ? null : 0,
    })
    const generatedResult = await multiVoiceSpeech.reviseSpeech({
      providerKey: providerKeys.activeProviderKey,
      segments: dialogue.segmentBuild.segments.filter(s => selected.has(s.clientSegmentId!)).map(s => ({
        segmentId: s.clientSegmentId!, text: s.text, voiceId: s.voiceId, voiceSettings: voiceSettings ?? s.voiceSettings ?? tuning,
      })),
      segmentGapMs: dialogueRevision.spacingChanged ? (naturalHandoffsEnabled ? null : 0) : undefined,
      scriptSnapshot: revisionScriptSnapshot(dialogueBaseline.scriptSnapshot, draft, ids),
      storageLimitBytes: generatedAudio.storageLimitBytes,
    })
    if (generatedResult) setLatestGeneratedAudioId(generatedResult.id)
  }

  function regenerateDialogueVoiceRows(rowId: string, voiceSettings: VoiceTuningValues) {
    if (!canGenerate || dialogueWorkspace.isRestoring || !dialogueRevision.canRevise) return
    const voiceId = dialogue.segmentBuild.segments.find(segment => segment.clientSegmentId === rowId)?.voiceId
    if (!voiceId) return
    const ids = dialogue.segmentBuild.segments.filter(segment => segment.voiceId === voiceId).map(segment => segment.clientSegmentId!)
    dialogue.applyBlockVoiceSettingsToMatchingVoice(rowId, voiceSettings)
    void reviseDialogueRows(ids, voiceSettings)
  }

  async function generateSpeech(forceAll = false) {
    if (isSpeechGenerating || dialogueWorkspace.isRestoring) return
    if (isDialogueMode) {
      if (!forceAll && dialogueRevision.canRevise) {
        return reviseDialogueRows(dialogueRevision.changedIds)
      }
      setLatestGenerationMode("dialogue")
      const generatedResult = await multiVoiceSpeech.generateSpeech({
        dialogueId: dialogue.identity,
        backendDefaultModelId: metadata.backendDefaultModelId,
        canUseProvider: providerKeys.canUseProvider,
        defaultVoice: voiceLibrary.selectedVoice,
        models: metadata.models,
        provider: providerKeys.activeProvider,
        providerId: providerKeys.activeProviderId,
        providerKey: providerKeys.activeProviderKey,
        scriptSnapshot: buildDialogueScriptSnapshot({
          dialogueBlocks: dialogue.blocks,
          segmentGapMs: naturalHandoffsEnabled ? null : 0,
          sourceVoiceId: voiceLibrary.selectedVoice?.id ?? null,
          speakerMappings: dialogue.speakerMappings,
          text: dialogue.segmentBuild.text,
        }),
        segmentGapMs: naturalHandoffsEnabled ? undefined : 0,
        segments: dialogue.segmentBuild.segments,
        selectedModelId: metadata.selectedModelId,
        selectedTuningPresetId,
        selectedUserTuningPreset,
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
        scriptSnapshot: buildRangeScriptSnapshot({
          assignments: voiceAssignments,
          segmentGapMs: naturalHandoffsEnabled ? null : 0,
          sourceVoiceId: voiceLibrary.selectedVoice?.id ?? null,
          text,
        }),
        segmentGapMs: naturalHandoffsEnabled ? undefined : 0,
        segments: assignmentSegments.segments,
        selectedModelId: metadata.selectedModelId,
        selectedTuningPresetId,
        selectedUserTuningPreset,
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
      selectedUserTuningPreset,
      selectedVoice: voiceLibrary.selectedVoice,
      scriptSnapshot: buildRangeScriptSnapshot({
        assignments: [],
        segmentGapMs: null,
        sourceVoiceId: voiceLibrary.selectedVoice?.id ?? null,
        text,
      }),
      storageLimitBytes: generatedAudio.storageLimitBytes,
      text,
      tuning,
    })
    if (generatedResult) {
      setLatestGeneratedAudioId(generatedResult.id)
    }
  }

  function restoreScriptSnapshot(snapshot: GeneratedAudioScriptSnapshot | null) {
    if (!snapshot) {
      return
    }
    if (hasDraftScriptState()) {
      confirmation.requestConfirmation({
        body: "This replaces the current Generate script text, assignments, dialogue rows, speaker mappings, and Natural Handoffs setting.",
        confirmLabel: "Replace Script",
        destructive: true,
        onConfirm: () => applyScriptSnapshotRestore(snapshot),
        title: "Replace Draft Script?",
      })
      return
    }
    applyScriptSnapshotRestore(snapshot)
  }

  function hasDraftScriptState() {
    return (
      text !== DEFAULT_TEXT ||
      voiceAssignments.length > 0 ||
      dialogue.mode !== "range" ||
      dialogue.blocks.length > 0 ||
      dialogue.speakerMappings.length > 0
    )
  }

  function applyScriptSnapshotRestore(snapshot: GeneratedAudioScriptSnapshot) {
    const availableVoiceIds =
      voiceLibrary.voiceStatus === "success"
        ? new Set(voiceLibrary.voices.map((voice) => voice.id))
        : null

    if (snapshot.sourceVoiceId && availableVoiceIds?.has(snapshot.sourceVoiceId)) {
      voiceLibrary.setSelectedVoiceId(snapshot.sourceVoiceId)
    }

    const missingVoiceIds = availableVoiceIds
      ? findMissingScriptSnapshotVoiceIds(snapshot, availableVoiceIds)
      : []
    setScriptRestoreWarning(missingVoiceIds.length > 0 ? SCRIPT_RESTORE_MISSING_VOICE_WARNING : null)
    handleNaturalHandoffsEnabledChange(snapshot.segmentGapMs !== 0)
    setTextSelection({ end: 0, start: 0, text: "" })
    setText(snapshot.text)

    if (snapshot.mode === "dialogue") {
      setVoiceAssignments([])
      dialogue.restoreState({
        blocks: snapshot.dialogueBlocks.map(scriptSnapshotBlockToDialogueBlock),
        mode: "dialogue",
        speakerMappings: snapshot.speakerMappings.map(scriptSnapshotMappingToSpeakerMapping),
      })
    } else {
      setVoiceAssignments(snapshot.assignments.map(scriptSnapshotAssignmentToVoiceAssignment))
      dialogue.restoreState({
        blocks: [],
        mode: "range",
        speakerMappings: [],
      })
    }

    workflowNavigation.navigateToSection("generate")
    window.requestAnimationFrame(() => textRef.current?.focus())
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

  function applyUserTuningPreset(preset: UserTuningPreset) {
    setSelectedUserTuningPresetId(preset.id)
  }

  function clearUserTuningPresetSelection() {
    setSelectedUserTuningPresetId(null)
  }

  function cancelGeneration() {
    if (multiVoiceSpeech.isGenerating) {
      void multiVoiceSpeech.cancelGeneration()
      return
    }
    speech.cancelGeneration()
  }

  function assignVoiceToSelection(voice: VoiceAsset) {
    setScriptRestoreWarning(null)
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
    setScriptRestoreWarning(null)
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
    setScriptRestoreWarning(null)
    setVoiceAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId))
  }

  function clearVoiceAssignments() {
    setScriptRestoreWarning(null)
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
    dialogueRowStates: Object.fromEntries(dialogue.blocks.map(block => [block.id, dialogueRowState(
      block.id, dialogueBaseline, dialogueRevision,
      multiVoiceSpeech.recovery?.active?.context.dialogueId === dialogue.identity ? multiVoiceSpeech.job : null,
    )])),
    regenerateDialogueVoiceRows,
    importDialogue,
    sourceError,
    dialogueWorkspace,
    sourceExpanded,
    setSourceExpanded,
    dialogueRevision,
    dialogueBaseline,
    generateAllSpeech: () => { if (canGenerate) void generateSpeech(true) },
    regenerateDialogueRow: (rowId: string) => { void reviseDialogueRows([rowId]) },
    canGenerateDialogueChanges: canGenerate && (!dialogueRevision.canRevise || dialogueRevision.changedIds.length > 0 || dialogueRevision.spacingChanged),
    activeSectionId: workflowNavigation.activeSectionId,
    applyUserTuningPreset,
    archiveStorageError,
    canGenerate: canGenerate && !dialogueWorkspace.isRestoring,
    cancelGeneration,
    characterCount,
    confirmation,
    dialogue,
    dialogueSpeechSegmentCount,
    effectiveVoiceSettingsByVoiceId,
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
    restoreScriptSnapshot,
    result,
    sampleProcessing,
    saveNaturalHandoffsDefault,
    saveGeneratedSegmentTuningToVoice,
    sectionStatuses,
    selectedModel,
    selectedTuningPresetId,
    selectedUserTuningPreset,
    setIsCostQuotaExpanded,
    setIsSampleProcessingExpanded,
    setNaturalHandoffsEnabled: handleNaturalHandoffsEnabledChange,
    setText: handleTextChange,
    scriptRestoreWarning,
    speech,
    speechError: activeSpeechError,
    speechStatus: activeSpeechStatus,
    text,
    textRef,
    textSelection,
    tuning,
    transcript,
    userTuningPresets,
    voiceInput,
    voiceAssignmentError,
    voiceAssignments,
    voiceAssignmentsStale: assignmentSegments.stale,
    voiceAssignmentSpeechSegmentCount,
    voiceAssignmentSegments: assignmentSegments.segments,
    assignVoiceToSelection,
    clearVoiceAssignments,
    clearUserTuningPresetSelection,
    isSpeechGenerating: isSpeechGenerating || dialogueWorkspace.isRestoring,
    multiVoiceSpeech,
    multiVoiceSegmentResultUrls: multiVoiceSpeech.segmentResultUrls,
    removeVoiceAssignment,
    updateVoiceAssignment,
    voiceLibrary,
    workflowSections: WORKFLOW_SECTIONS,
  }
}

function buildEffectiveVoiceSettingsByVoiceId(
  activeProviderId: string | null,
  providerTuning: ProviderTuningMetadata,
  voices: VoiceAsset[]
) {
  const entries: [string, VoiceTuningValues][] = []
  for (const voice of voices) {
    entries.push([
      voice.id,
      resolveEffectiveVoiceTuning({
        activeProviderId,
        providerTuning,
        voice,
      }),
    ])
  }
  return Object.fromEntries(entries)
}

function createVoiceAssignmentId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return `assignment-${window.crypto.randomUUID()}`
  }
  return `assignment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function scriptSnapshotAssignmentToVoiceAssignment(
  assignment: GeneratedAudioScriptSnapshotAssignment
): VoiceTextAssignment {
  return {
    id: assignment.id,
    start: assignment.start,
    end: assignment.end,
    text: assignment.text,
    sourceText: assignment.sourceText,
    voiceId: assignment.voiceId,
    voiceName: assignment.voiceName,
  }
}

function scriptSnapshotBlockToDialogueBlock(block: GeneratedAudioScriptSnapshotDialogueBlock) {
  return {
    id: block.id,
    speakerLabel: block.speakerLabel,
    text: block.text,
    voiceId: block.voiceId,
    voiceName: block.voiceName ?? null,
    voiceSettings: block.voiceSettings ? { ...block.voiceSettings } : null,
  }
}

function scriptSnapshotMappingToSpeakerMapping(mapping: GeneratedAudioScriptSnapshotSpeakerMapping) {
  return {
    speakerLabel: mapping.speakerLabel,
    voiceId: mapping.voiceId,
  }
}

function findMissingScriptSnapshotVoiceIds(
  snapshot: GeneratedAudioScriptSnapshot,
  availableVoiceIds: Set<string>
) {
  const referencedVoiceIds = new Set<string>()
  if (snapshot.sourceVoiceId) {
    referencedVoiceIds.add(snapshot.sourceVoiceId)
  }
  for (const assignment of snapshot.assignments) {
    referencedVoiceIds.add(assignment.voiceId)
  }
  for (const block of snapshot.dialogueBlocks) {
    if (block.voiceId) {
      referencedVoiceIds.add(block.voiceId)
    }
  }
  for (const mapping of snapshot.speakerMappings) {
    if (mapping.voiceId) {
      referencedVoiceIds.add(mapping.voiceId)
    }
  }
  return [...referencedVoiceIds].filter((voiceId) => !availableVoiceIds.has(voiceId))
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
