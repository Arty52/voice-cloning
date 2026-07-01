import { type FormEvent, useRef, useState } from "react"

import { AppHeader } from "@/components/app-header"
import { ConfirmationDialog } from "@/components/dialogs/confirmation-dialog"
import { VoiceStudioShell, WorkflowSectionPanel } from "@/components/layout/voice-studio-shell"
import { RenameVoiceDialog } from "@/components/dialogs/rename-voice-dialog"
import { AddVoicePanel } from "@/components/panels/add-voice-panel"
import { CostQuotaPanel } from "@/components/panels/cost-quota-panel"
import { GeneratedAudioPanel } from "@/components/panels/generated-audio-panel"
import { LatestGeneratedAudioPanel } from "@/components/panels/latest-generated-audio-panel"
import { ProviderKeysPanel } from "@/components/panels/provider-keys-panel"
import {
  PrepareAudioChoicePanel,
  type PrepareAudioWorkflow,
} from "@/components/panels/prepare-audio-choice-panel"
import { SampleProcessingPanel } from "@/components/panels/sample-processing-panel"
import { SpeechInputPanel } from "@/components/panels/speech-input-panel"
import { StudioOverviewPanel } from "@/components/panels/studio-overview-panel"
import { VoiceLibraryPanel } from "@/components/panels/voice-library-panel"
import { useScrollIntoViewOnSignal } from "@/hooks/use-scroll-into-view-on-signal"
import { useVoiceStudioController } from "@/hooks/use-voice-studio-controller"

function App() {
  const [prepareAudioWorkflow, setPrepareAudioWorkflow] = useState<PrepareAudioWorkflow | null>(null)
  const [generatedAudioAttentionSignal, setGeneratedAudioAttentionSignal] = useState(0)
  const [sampleProcessingAttentionSignal, setSampleProcessingAttentionSignal] = useState(0)
  const hasEnteredProcessAudioWorkflowRef = useRef(false)
  const {
    activeSectionId,
    applyUserTuningPreset,
    archiveStorageError,
    assignVoiceToSelection,
    canGenerate,
    cancelGeneration,
    characterCount,
    clearUserTuningPresetSelection,
    clearVoiceAssignments,
    confirmation,
    dialogue,
    dialogueSpeechSegmentCount,
    estimatedCredits,
    generatedAudio,
    generationPendingStatus,
    handleGenerate,
    handleStorageLimitChange,
    handleTextSelectionChange,
    hasModelRate,
    isSpeechGenerating,
    latestGeneratedAudioItem,
    latestStorageError,
    metadata,
    naturalHandoffsEnabled,
    naturalHandoffsSaveError,
    naturalHandoffsUnsaved,
    multiVoiceSegmentResultUrls,
    navigateToSection,
    providerKeys,
    providerTuning,
    requestClearGeneratedAudio,
    requestDeleteVoice,
    requestSaveVoiceTuningDraft,
    regenerateMultiVoiceSegment,
    regenerateMultiVoiceSegmentsForVoice,
    result,
    removeVoiceAssignment,
    sampleProcessing,
    saveNaturalHandoffsDefault,
    saveGeneratedSegmentTuningToVoice,
    sectionStatuses,
    selectedModel,
    selectedUserTuningPreset,
    setNaturalHandoffsEnabled,
    setText,
    speech,
    speechError,
    speechStatus,
    text,
    textRef,
    textSelection,
    tuning,
    userTuningPresets,
    voiceInput,
    voiceAssignmentError,
    voiceAssignments,
    voiceAssignmentSpeechSegmentCount,
    voiceAssignmentsStale,
    updateVoiceAssignment,
    voiceLibrary,
    workflowSections,
  } = useVoiceStudioController()
  const isPrepareWorkflowSwitchDisabled =
    voiceInput.isUploading || voiceInput.isPreparingSample || voiceInput.isRecorderBusy || sampleProcessing.isProcessing
  const visiblePrepareAudioWorkflow = prepareAudioWorkflow ?? (sampleProcessing.job ? "processAudio" : null)
  const generatedAudioAttentionRef = useScrollIntoViewOnSignal<HTMLElement>(generatedAudioAttentionSignal)
  const sampleProcessingAttentionRef = useScrollIntoViewOnSignal<HTMLDivElement>(sampleProcessingAttentionSignal)

  function handlePrepareAudioWorkflowSelect(workflow: PrepareAudioWorkflow) {
    if (isPrepareWorkflowSwitchDisabled) {
      return
    }
    setPrepareAudioWorkflow(workflow)
    if (workflow === "processAudio" && !hasEnteredProcessAudioWorkflowRef.current) {
      hasEnteredProcessAudioWorkflowRef.current = true
      if (!sampleProcessing.job) {
        sampleProcessing.handleSourceModeChange("upload")
      }
    }
  }

  function handleGenerateWithAttention(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!canGenerate) {
      return
    }
    setGeneratedAudioAttentionSignal((currentSignal) => currentSignal + 1)
    handleGenerate()
  }

  function requestSampleProcessingAttention() {
    setSampleProcessingAttentionSignal((currentSignal) => currentSignal + 1)
  }

  return (
    <>
      <VoiceStudioShell
        activeSectionId={activeSectionId}
        header={<AppHeader />}
        onSectionChange={navigateToSection}
        sectionStatuses={sectionStatuses}
        sections={workflowSections}
      >
        <WorkflowSectionPanel activeSectionId={activeSectionId} id="overview">
          <StudioOverviewPanel sections={workflowSections} />
        </WorkflowSectionPanel>

        <WorkflowSectionPanel activeSectionId={activeSectionId} id="prepare">
          <PrepareAudioChoicePanel
            disabled={isPrepareWorkflowSwitchDisabled}
            onSelect={handlePrepareAudioWorkflowSelect}
            selectedWorkflow={visiblePrepareAudioWorkflow}
          />

          {visiblePrepareAudioWorkflow === "addVoice" ? (
            <AddVoicePanel
              canUpload={voiceInput.canUpload}
              handleDiscardRecording={() => void voiceInput.handleDiscardRecording()}
              handleStartRecording={() => void voiceInput.handleStartRecording()}
              handleStopRecording={() => void voiceInput.handleStopRecording()}
              handleSampleModeChange={voiceInput.handleSampleModeChange}
              handleSampleWindowChange={voiceInput.handleSampleWindowChange}
              handleUpload={voiceInput.handleUpload}
              handleUploadFileSelect={voiceInput.handleUploadFileSelect}
              isRecorderBusy={voiceInput.isRecorderBusy}
              isRecording={voiceInput.isRecording}
              isPreparingSample={voiceInput.isPreparingSample}
              isUploading={voiceInput.isUploading}
              recorderError={voiceInput.recorderError}
              recorderStatus={voiceInput.recorderStatus}
              recordingDurationSeconds={voiceInput.recordingDurationSeconds}
              sampleLimits={voiceInput.sampleLimits}
              sampleMode={voiceInput.sampleMode}
              setUploadName={voiceInput.setUploadName}
              setUploadVoicePresetId={voiceInput.setUploadVoicePresetId}
              uploadDurationSeconds={voiceInput.uploadDurationSeconds}
              uploadError={voiceInput.uploadError}
              uploadFile={voiceInput.uploadFile}
              uploadName={voiceInput.uploadName}
              uploadPreviewUrl={voiceInput.uploadPreviewUrl}
              uploadVoicePresetId={voiceInput.uploadVoicePresetId}
              uploadWindow={voiceInput.uploadWindow}
              voicePresets={providerKeys.voicePresets}
              voiceSampleInputMode={voiceInput.voiceSampleInputMode}
            />
          ) : null}

          {visiblePrepareAudioWorkflow === "processAudio" ? (
            <SampleProcessingPanel
              attentionRef={sampleProcessingAttentionRef}
              isCollapsible={false}
              isExpanded
              onAttentionRequest={requestSampleProcessingAttention}
              onToggleExpanded={() => undefined}
              processing={sampleProcessing}
              voicePresets={providerKeys.voicePresets}
            />
          ) : null}
        </WorkflowSectionPanel>

        <WorkflowSectionPanel activeSectionId={activeSectionId} id="voices">
          <VoiceLibraryPanel
            activeProviderId={providerKeys.activeProviderId || null}
            defaultVoiceId={voiceLibrary.defaultVoiceId}
            isGenerating={speech.isGenerating}
            isProviderTuningLoading={providerKeys.providerStatus === "idle" || providerKeys.providerStatus === "loading"}
            isSettingDefault={voiceLibrary.isSettingDefault}
            isUpdatingVoice={voiceLibrary.isUpdatingVoice}
            onDeleteRequest={requestDeleteVoice}
            onPlayVoice={voiceLibrary.playVoice}
            onRenameRequest={voiceLibrary.requestRename}
            onSaveVoiceTuningRequest={requestSaveVoiceTuningDraft}
            onSelectVoice={voiceLibrary.setSelectedVoiceId}
            onSetDefault={(voice) => void voiceLibrary.setDefault(voice.id)}
            onUserTuningPresetApply={applyUserTuningPreset}
            onUserTuningPresetClear={clearUserTuningPresetSelection}
            providerTuning={providerTuning}
            selectedVoiceId={voiceLibrary.selectedVoiceId}
            selectedUserTuningPreset={selectedUserTuningPreset}
            userTuningPresets={userTuningPresets}
            voiceError={voiceLibrary.voiceError}
            voicePresets={providerKeys.voicePresets}
            voices={voiceLibrary.voices}
            voiceStatus={voiceLibrary.voiceStatus}
          />
        </WorkflowSectionPanel>

        <WorkflowSectionPanel activeSectionId={activeSectionId} id="generate">
          <SpeechInputPanel
            activeProviderId={providerKeys.activeProviderId}
            assignmentError={voiceAssignmentError}
            assignmentSpeechSegmentCount={voiceAssignmentSpeechSegmentCount}
            assignments={voiceAssignments}
            assignmentsStale={voiceAssignmentsStale}
            canGenerate={canGenerate}
            characterCount={characterCount}
            dialogue={dialogue}
            dialogueSpeechSegmentCount={dialogueSpeechSegmentCount}
            isGenerating={isSpeechGenerating}
            onAssignVoice={assignVoiceToSelection}
            onCancelGeneration={cancelGeneration}
            onClearAssignments={clearVoiceAssignments}
            onEditAssignmentVoice={updateVoiceAssignment}
            onGenerate={handleGenerateWithAttention}
            onNaturalHandoffsEnabledChange={setNaturalHandoffsEnabled}
            onSaveNaturalHandoffsDefault={saveNaturalHandoffsDefault}
            onRemoveAssignment={removeVoiceAssignment}
            onTextChange={setText}
            onTextSelectionChange={handleTextSelectionChange}
            providerTuningControls={providerTuning.controls}
            selectedVoice={voiceLibrary.selectedVoice}
            selectedText={textSelection.text}
            naturalHandoffsEnabled={naturalHandoffsEnabled}
            naturalHandoffsSaveError={naturalHandoffsSaveError}
            naturalHandoffsUnsaved={naturalHandoffsUnsaved}
            text={text}
            textRef={textRef}
            tuning={tuning}
            voices={voiceLibrary.voices}
          />

          <LatestGeneratedAudioPanel
            activeProviderId={providerKeys.activeProviderId}
            attentionRef={generatedAudioAttentionRef}
            error={speechError}
            generationPendingStatus={generationPendingStatus}
            isDeleteDisabled={generatedAudio.generatedAudioMutation === "delete"}
            isSavingVoiceTuning={voiceLibrary.isUpdatingVoice}
            item={latestGeneratedAudioItem}
            onDelete={(id) => void generatedAudio.handleDeleteGeneratedAudio(id)}
            onRegenerateSegment={(segmentId, voiceId, voiceSettings) =>
              void regenerateMultiVoiceSegment(segmentId, voiceId, voiceSettings)
            }
            onRegenerateVoiceSegments={(voiceId, voiceSettings) =>
              void regenerateMultiVoiceSegmentsForVoice(voiceId, voiceSettings)
            }
            onSaveVoiceTuning={(voiceId, voiceSettings) =>
              void saveGeneratedSegmentTuningToVoice(voiceId, voiceSettings)
            }
            providerTuningControls={providerTuning.controls}
            segmentResultUrls={multiVoiceSegmentResultUrls}
            status={speechStatus}
            storageError={latestStorageError}
            tuning={tuning}
            voices={voiceLibrary.voices}
          />
        </WorkflowSectionPanel>

        <WorkflowSectionPanel activeSectionId={activeSectionId} id="archive">
          <GeneratedAudioPanel
            allItems={generatedAudio.generatedAudioItems}
            items={generatedAudio.generatedAudioItems}
            libraryStatus={generatedAudio.generatedAudioStatus}
            mutationStatus={generatedAudio.generatedAudioMutation}
            onClear={requestClearGeneratedAudio}
            onDelete={(id) => void generatedAudio.handleDeleteGeneratedAudio(id)}
            onStorageLimitChange={handleStorageLimitChange}
            storageError={archiveStorageError}
            storageLimitBytes={generatedAudio.storageLimitBytes}
            usage={generatedAudio.generatedAudioUsage}
          />
        </WorkflowSectionPanel>

        <WorkflowSectionPanel activeSectionId={activeSectionId} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" id="provider">
          <ProviderKeysPanel
            activeProvider={providerKeys.activeProvider}
            activeProviderKey={providerKeys.activeProviderKey}
            keySource={providerKeys.keySource}
            onClearProviderKey={providerKeys.clearProviderKey}
            onSaveProviderKey={providerKeys.saveProviderKey}
            providerError={providerKeys.providerError}
            providerStatus={providerKeys.providerStatus}
          />

          <CostQuotaPanel
            characterCount={characterCount}
            estimatedCredits={estimatedCredits}
            hasModelRate={hasModelRate}
            isCollapsible={false}
            isExpanded
            isGenerating={isSpeechGenerating}
            modelError={metadata.modelError}
            modelStatus={metadata.modelStatus}
            models={metadata.models}
            onModelChange={metadata.setSelectedModelId}
            onRefresh={() => {
              void metadata.loadSubscription()
              void metadata.loadModels()
            }}
            onToggleExpanded={() => undefined}
            providerLinks={providerKeys.activeProvider?.links ?? []}
            result={result}
            selectedModel={selectedModel}
            selectedModelId={metadata.selectedModelId}
            subscription={metadata.subscription}
            subscriptionError={metadata.subscriptionError}
            subscriptionStatus={metadata.subscriptionStatus}
          />
        </WorkflowSectionPanel>
      </VoiceStudioShell>
      <RenameVoiceDialog
        error={voiceLibrary.renameError}
        isSaving={voiceLibrary.isUpdatingVoice}
        name={voiceLibrary.renameName}
        onCancel={voiceLibrary.cancelRename}
        onNameChange={voiceLibrary.setRenameName}
        onSubmit={voiceLibrary.submitRename}
        voice={voiceLibrary.renameVoice}
      />
      <ConfirmationDialog confirmation={confirmation.confirmation} onCancel={confirmation.clearConfirmation} />
    </>
  )
}

export default App
