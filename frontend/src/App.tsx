import { type FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import { AppHeader } from "@/components/app-header"
import { ConfirmationDialog } from "@/components/dialogs/confirmation-dialog"
import { RenameVoiceDialog } from "@/components/dialogs/rename-voice-dialog"
import { AddVoicePanel } from "@/components/panels/add-voice-panel"
import { CostQuotaPanel } from "@/components/panels/cost-quota-panel"
import { GeneratedAudioPanel } from "@/components/panels/generated-audio-panel"
import { ProviderKeysPanel } from "@/components/panels/provider-keys-panel"
import { SpeechInputPanel } from "@/components/panels/speech-input-panel"
import { VoiceLibraryPanel } from "@/components/panels/voice-library-panel"
import { VoiceTuningPanel } from "@/components/panels/voice-tuning-panel"
import { DEFAULT_TEXT, DEFAULT_TUNING } from "@/constants"
import { useConfirmation } from "@/hooks/use-confirmation"
import { useGeneratedAudioLibrary } from "@/hooks/use-generated-audio-library"
import { useProviderKeys } from "@/hooks/use-provider-keys"
import { useSpeechGeneration } from "@/hooks/use-speech-generation"
import { useVoiceLibrary } from "@/hooks/use-voice-library"
import { useVoiceMetadata } from "@/hooks/use-voice-metadata"
import { useVoiceSampleInput } from "@/hooks/use-voice-sample-input"
import { formatBytes } from "@/lib/formatters"
import type { SliderConfig, TuningPreset, TuningPresetId, VoiceAsset, VoiceTuning } from "@/types"

function App() {
  const [text, setText] = useState(DEFAULT_TEXT)
  const [tuning, setTuning] = useState<VoiceTuning>(DEFAULT_TUNING)
  const [selectedTuningPreset, setSelectedTuningPreset] = useState<TuningPresetId>("standard")
  const [isCostQuotaExpanded, setIsCostQuotaExpanded] = useState(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const confirmation = useConfirmation()
  const providerKeys = useProviderKeys()
  const voiceLibrary = useVoiceLibrary()
  const metadata = useVoiceMetadata({
    canUseProvider: providerKeys.canUseProvider,
    providerKey: providerKeys.activeProviderKey,
    providerStatus: providerKeys.providerStatus,
  })
  const generatedAudio = useGeneratedAudioLibrary()
  const speech = useSpeechGeneration({
    persistGeneratedAudio: generatedAudio.persistGeneratedAudio,
  })
  const voiceInput = useVoiceSampleInput({
    onVoiceSaved: voiceLibrary.addSavedVoice,
  })

  const selectedModel = metadata.models.find((model) => model.modelId === metadata.selectedModelId) ?? null
  const result = generatedAudio.generatedAudioItems[0] ?? null
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
    void speech.generateSpeech({
      backendDefaultModelId: metadata.backendDefaultModelId,
      canUseProvider: providerKeys.canUseProvider,
      models: metadata.models,
      providerKey: providerKeys.activeProviderKey,
      selectedModelId: metadata.selectedModelId,
      selectedVoice: voiceLibrary.selectedVoice,
      storageLimitBytes: generatedAudio.storageLimitBytes,
      text,
      tuning,
    })
  }

  function handleTuningValueChange(key: SliderConfig["id"], value: string) {
    setSelectedTuningPreset("custom")
    setTuning((current) => ({
      ...current,
      [key]: Number(value),
    }))
  }

  function handlePresetApply(preset: TuningPreset) {
    setSelectedTuningPreset(preset.id)
    setTuning((current) => ({
      ...current,
      ...preset.values,
    }))
  }

  function handleSpeakerBoostChange(checked: boolean) {
    setSelectedTuningPreset("custom")
    setTuning((current) => ({ ...current, useSpeakerBoost: checked }))
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

            <VoiceTuningPanel
              isGenerating={speech.isGenerating}
              onPresetApply={handlePresetApply}
              onSpeakerBoostChange={handleSpeakerBoostChange}
              onTuningValueChange={handleTuningValueChange}
              selectedTuningPreset={selectedTuningPreset}
              tuning={tuning}
            />

            <GeneratedAudioPanel
              error={speech.error}
              items={generatedAudio.generatedAudioItems}
              onClear={requestClearGeneratedAudio}
              onDelete={(id) => void generatedAudio.handleDeleteGeneratedAudio(id)}
              onStorageLimitChange={handleStorageLimitChange}
              status={speech.status}
              storageError={generatedAudio.generatedAudioStorageError}
              storageLimitBytes={generatedAudio.storageLimitBytes}
              usage={generatedAudio.generatedAudioUsage}
            />
          </section>

          <aside className="flex flex-col gap-4">
            <ProviderKeysPanel
              activeProvider={providerKeys.activeProvider}
              activeProviderKey={providerKeys.activeProviderKey}
              keySource={providerKeys.keySource}
              onClearProviderKey={providerKeys.clearProviderKey}
              onSaveProviderKey={providerKeys.saveProviderKey}
              providerError={providerKeys.providerError}
              providerStatus={providerKeys.providerStatus}
            />

            <VoiceLibraryPanel
              canSetDefault={voiceLibrary.canSetDefault}
              defaultVoiceId={voiceLibrary.defaultVoiceId}
              isGenerating={speech.isGenerating}
              isSettingDefault={voiceLibrary.isSettingDefault}
              isUpdatingVoice={voiceLibrary.isUpdatingVoice}
              onDeleteRequest={requestDeleteVoice}
              onPlayVoice={voiceLibrary.playVoice}
              onRenameRequest={voiceLibrary.requestRename}
              onSelectVoice={voiceLibrary.setSelectedVoiceId}
              onSetDefault={() => void voiceLibrary.setDefault()}
              selectedVoice={voiceLibrary.selectedVoice}
              selectedVoiceId={voiceLibrary.selectedVoiceId}
              voiceError={voiceLibrary.voiceError}
              voices={voiceLibrary.voices}
              voiceStatus={voiceLibrary.voiceStatus}
            />

            <AddVoicePanel
              canUpload={voiceInput.canUpload}
              handleDiscardRecording={() => void voiceInput.handleDiscardRecording()}
              handleStartRecording={() => void voiceInput.handleStartRecording()}
              handleStopRecording={() => void voiceInput.handleStopRecording()}
              handleUpload={voiceInput.handleUpload}
              handleUploadFileChange={voiceInput.handleUploadFileChange}
              handleVoiceSampleInputModeChange={voiceInput.handleVoiceSampleInputModeChange}
              isRecorderBusy={voiceInput.isRecorderBusy}
              isRecording={voiceInput.isRecording}
              isUploading={voiceInput.isUploading}
              recorderError={voiceInput.recorderError}
              recorderStatus={voiceInput.recorderStatus}
              recordingDurationSeconds={voiceInput.recordingDurationSeconds}
              setUploadName={voiceInput.setUploadName}
              uploadError={voiceInput.uploadError}
              uploadFile={voiceInput.uploadFile}
              uploadName={voiceInput.uploadName}
              uploadPreviewUrl={voiceInput.uploadPreviewUrl}
              voiceSampleInputMode={voiceInput.voiceSampleInputMode}
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
