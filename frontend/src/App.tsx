import { type FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import { AppHeader } from "@/components/app-header"
import { ConfirmationDialog } from "@/components/dialogs/confirmation-dialog"
import { RenameVoiceDialog } from "@/components/dialogs/rename-voice-dialog"
import { AddVoicePanel } from "@/components/panels/add-voice-panel"
import { CostQuotaPanel } from "@/components/panels/cost-quota-panel"
import { GeneratedAudioPanel } from "@/components/panels/generated-audio-panel"
import { LatestGeneratedAudioPanel } from "@/components/panels/latest-generated-audio-panel"
import { ProviderKeysPanel } from "@/components/panels/provider-keys-panel"
import { SampleProcessingPanel } from "@/components/panels/sample-processing-panel"
import { SpeechInputPanel } from "@/components/panels/speech-input-panel"
import { VoiceLibraryPanel } from "@/components/panels/voice-library-panel"
import { VoiceTuningPanel } from "@/components/panels/voice-tuning-panel"
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
import { isTemporaryGeneratedAudioId } from "@/lib/generated-audio-view-model"
import { formatBytes } from "@/lib/formatters"
import type { ProviderTuningMetadata, VoiceAsset } from "@/types"

const EMPTY_TUNING_METADATA: ProviderTuningMetadata = {
  controls: [],
  presets: [],
  defaultValues: {},
}

function App() {
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
      providerKey: providerKeys.activeProviderKey,
      providerId: providerKeys.activeProviderId,
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

  return (
    <main className="min-h-svh px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <AppHeader />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(23rem,0.85fr)]">
          <section className="flex flex-col gap-4">
            <SpeechInputPanel
              canGenerate={canGenerate}
              characterCount={characterCount}
              isGenerating={speech.isGenerating}
              onCancelGeneration={speech.cancelGeneration}
              onGenerate={handleGenerate}
              onTextChange={setText}
              selectedVoice={voiceLibrary.selectedVoice}
              text={text}
              textRef={textRef}
            />

            <LatestGeneratedAudioPanel
              error={speech.error}
              isDeleteDisabled={generatedAudio.generatedAudioMutation === "delete"}
              item={latestGeneratedAudioItem}
              onDelete={(id) => void generatedAudio.handleDeleteGeneratedAudio(id)}
              status={speech.status}
              storageError={latestStorageError}
            />

            <VoiceTuningPanel
              controls={providerTuning.controls}
              isGenerating={speech.isGenerating}
              isLoading={providerKeys.providerStatus === "idle" || providerKeys.providerStatus === "loading"}
              onPresetApply={voiceTuning.handlePresetApply}
              onTuningValueChange={voiceTuning.handleTuningValueChange}
              presets={providerTuning.presets}
              selectedTuningPresetId={selectedTuningPresetId}
              tuning={tuning}
            />

            <GeneratedAudioPanel
              allItems={generatedAudio.generatedAudioItems}
              items={archivedGeneratedAudioItems}
              libraryStatus={generatedAudio.generatedAudioStatus}
              mutationStatus={generatedAudio.generatedAudioMutation}
              onClear={requestClearGeneratedAudio}
              onDelete={(id) => void generatedAudio.handleDeleteGeneratedAudio(id)}
              onStorageLimitChange={handleStorageLimitChange}
              storageError={archiveStorageError}
              storageLimitBytes={generatedAudio.storageLimitBytes}
              usage={generatedAudio.generatedAudioUsage}
            />
          </section>

          <aside className="flex flex-col gap-4">
            <VoiceLibraryPanel
              canSetDefault={voiceLibrary.canSetDefault}
              defaultVoiceId={voiceLibrary.defaultVoiceId}
              isGenerating={speech.isGenerating}
              isSettingDefault={voiceLibrary.isSettingDefault}
              isUpdatingVoice={voiceLibrary.isUpdatingVoice}
              onDeleteRequest={requestDeleteVoice}
              onPlayVoice={voiceLibrary.playVoice}
              onPresetChange={(voice, voicePresetId) => void voiceLibrary.updateVoicePreset(voice, voicePresetId)}
              onRenameRequest={voiceLibrary.requestRename}
              onSelectVoice={voiceLibrary.setSelectedVoiceId}
              onSetDefault={() => void voiceLibrary.setDefault()}
              selectedVoice={voiceLibrary.selectedVoice}
              selectedVoiceId={voiceLibrary.selectedVoiceId}
              voiceError={voiceLibrary.voiceError}
              voicePresets={providerKeys.voicePresets}
              voices={voiceLibrary.voices}
              voiceStatus={voiceLibrary.voiceStatus}
            />

            <SampleProcessingPanel
              isExpanded={isSampleProcessingExpanded}
              onToggleExpanded={() => setIsSampleProcessingExpanded((current) => !current)}
              processing={sampleProcessing}
              voicePresets={providerKeys.voicePresets}
            />

            <AddVoicePanel
              canUpload={voiceInput.canUpload}
              handleDiscardRecording={() => void voiceInput.handleDiscardRecording()}
              handleStartRecording={() => void voiceInput.handleStartRecording()}
              handleStopRecording={() => void voiceInput.handleStopRecording()}
              handleSampleModeChange={voiceInput.handleSampleModeChange}
              handleSampleWindowChange={voiceInput.handleSampleWindowChange}
              handleUpload={voiceInput.handleUpload}
              handleUploadFileChange={voiceInput.handleUploadFileChange}
              handleVoiceSampleInputModeChange={voiceInput.handleVoiceSampleInputModeChange}
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
              isExpanded={isCostQuotaExpanded}
              isGenerating={speech.isGenerating}
              modelError={metadata.modelError}
              modelStatus={metadata.modelStatus}
              models={metadata.models}
              onModelChange={metadata.setSelectedModelId}
              onRefresh={() => {
                void metadata.loadSubscription()
                void metadata.loadModels()
              }}
              onToggleExpanded={() => setIsCostQuotaExpanded((current) => !current)}
              providerLinks={providerKeys.activeProvider?.links ?? []}
              result={result}
              selectedModel={selectedModel}
              selectedModelId={metadata.selectedModelId}
              subscription={metadata.subscription}
              subscriptionError={metadata.subscriptionError}
              subscriptionStatus={metadata.subscriptionStatus}
            />
          </aside>
        </div>
      </div>
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
    </main>
  )
}

export default App
