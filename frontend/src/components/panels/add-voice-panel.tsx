import { Mic, RotateCcw, Save, Square, Upload } from "lucide-react"
import type { FormEvent } from "react"

import { AudioFileDropZone } from "@/components/audio-file-drop-zone"
import { AudioWindowCropper } from "@/components/audio-window-cropper"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/loading"
import { VoicePresetToggleGroup } from "@/components/voice-preset-toggle-group"
import type { AudioWindow } from "@/lib/audio-window"
import { formatRecordingDuration } from "@/lib/formatters"
import type {
  ProviderSampleMetadata,
  RecorderStatus,
  VoicePreset,
  VoicePresetId,
  VoiceSampleInputMode,
  VoiceSampleMode,
} from "@/types"

type AddVoicePanelProps = {
  canUpload: boolean
  handleDiscardRecording: () => void
  handleSampleModeChange: (mode: VoiceSampleMode) => void
  handleSampleWindowChange: (window: AudioWindow) => void
  handleStartRecording: () => void
  handleStopRecording: () => void
  handleUpload: (event: FormEvent<HTMLFormElement>) => void
  handleUploadFileSelect: (file: File | null) => void
  isRecorderBusy: boolean
  isRecording: boolean
  isPreparingSample: boolean
  isUploading: boolean
  recorderError: string | null
  recorderStatus: RecorderStatus
  recordingDurationSeconds: number
  sampleLimits: ProviderSampleMetadata
  sampleMode: VoiceSampleMode
  setUploadVoicePresetId: (voicePresetId: VoicePresetId) => void
  setUploadName: (name: string) => void
  uploadDurationSeconds: number | null
  uploadError: string | null
  uploadFile: File | null
  uploadName: string
  uploadPreviewUrl: string | null
  uploadVoicePresetId: VoicePresetId
  uploadWindow: AudioWindow | null
  voicePresets: VoicePreset[]
  voiceSampleInputMode: VoiceSampleInputMode
}

export function AddVoicePanel({
  canUpload,
  handleDiscardRecording,
  handleSampleModeChange,
  handleSampleWindowChange,
  handleStartRecording,
  handleStopRecording,
  handleUpload,
  handleUploadFileSelect,
  isRecorderBusy,
  isRecording,
  isPreparingSample,
  isUploading,
  recorderError,
  recorderStatus,
  recordingDurationSeconds,
  sampleLimits,
  sampleMode,
  setUploadVoicePresetId,
  setUploadName,
  uploadDurationSeconds,
  uploadError,
  uploadFile,
  uploadName,
  uploadPreviewUrl,
  uploadVoicePresetId,
  uploadWindow,
  voicePresets,
  voiceSampleInputMode,
}: AddVoicePanelProps) {
  const recorderLoadingLabel =
    recorderStatus === "starting" ? "Starting Recorder" : recorderStatus === "stopping" ? "Finalizing Recording" : null
  const recorderPanelVisible = voiceSampleInputMode === "record" || recorderError !== null
  const recordButtonLabel =
    recorderStatus === "starting"
      ? "Starting Recorder"
      : recorderStatus === "recording"
        ? "Recording"
        : recorderStatus === "stopping"
          ? "Finalizing"
          : recorderStatus === "recorded"
            ? "Record Again"
            : "Record"

  return (
    <form className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5" onSubmit={handleUpload}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Add Voice</h2>
          <p className="mt-1 text-sm text-muted-foreground">Save a named sample into the project voice assets.</p>
        </div>
        <Upload aria-hidden="true" className="size-5 text-primary" />
      </div>

      {uploadError ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
          {uploadError}
        </div>
      ) : null}

      <div className="space-y-3">
        <label className="block space-y-2 text-sm font-medium" htmlFor="voice-name">
          <span>Voice Name</span>
          <Input
            aria-describedby="voice-name-help"
            disabled={isUploading}
            id="voice-name"
            onChange={(event) => setUploadName(event.target.value)}
            placeholder="Voice_Clone_01"
            required
            value={uploadName}
          />
          <span className="block text-xs font-normal text-muted-foreground" id="voice-name-help">
            Enter a voice name to enable Save Voice.
          </span>
        </label>
        <VoicePresetToggleGroup
          disabled={isUploading}
          id="add-voice-preset"
          label="Voice Preset"
          onChange={setUploadVoicePresetId}
          value={uploadVoicePresetId}
          voicePresets={voicePresets}
        />

        <div className="flex flex-col gap-3">
          <AudioFileDropZone
            disabled={isUploading || isPreparingSample || isRecorderBusy}
            id="sample-upload"
            label="Sample File"
            onFileSelect={handleUploadFileSelect}
            selectedFileName={uploadFile?.name ?? null}
          >
            <Button disabled={isUploading || isRecorderBusy} onClick={handleStartRecording} size="sm" type="button" variant="secondary">
              <Mic aria-hidden="true" data-icon="inline-start" />
              {recordButtonLabel}
            </Button>
          </AudioFileDropZone>
          {isPreparingSample ? (
            <div className="rounded-md border border-border bg-background/60 p-3">
              <Loading text="Preparing Sample" variant="secondary" />
            </div>
          ) : null}
          {recorderPanelVisible ? (
            <div className="rounded-md border border-border bg-background/60 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Recorder</div>
                <div className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatRecordingDuration(recordingDurationSeconds)}
                </div>
              </div>
              {recorderError ? (
                <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
                  {recorderError}
                </div>
              ) : null}
              {recorderLoadingLabel ? (
                <div className="mb-3 rounded-md border border-border bg-background/60 p-3">
                  <Loading text={recorderLoadingLabel} variant="secondary" />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button disabled={!isRecording} onClick={handleStopRecording} size="sm" type="button" variant="secondary">
                  <Square aria-hidden="true" data-icon="inline-start" />
                  Stop
                </Button>
                <Button
                  disabled={isUploading || isRecorderBusy || (recorderStatus === "idle" && !uploadFile)}
                  onClick={handleDiscardRecording}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <RotateCcw aria-hidden="true" data-icon="inline-start" />
                  Discard
                </Button>
              </div>
            </div>
          ) : null}
          {voiceSampleInputMode === "upload" && uploadPreviewUrl && uploadWindow && uploadDurationSeconds !== null ? (
            <AudioWindowCropper
              disabled={isUploading}
              durationSeconds={uploadDurationSeconds}
              maxWindowSeconds={sampleLimits.maxWindowSeconds}
              onSampleModeChange={handleSampleModeChange}
              onWindowChange={handleSampleWindowChange}
              recommendedMaxSeconds={sampleLimits.recommendedMaxSeconds}
              recommendedMinSeconds={sampleLimits.recommendedMinSeconds}
              sampleMode={sampleMode}
              sourceUrl={uploadPreviewUrl}
              window={uploadWindow}
            />
          ) : null}
        </div>
        <div className="rounded-md border border-border bg-background/60 p-3">
          <div className="mb-2 text-sm font-medium">
            {voiceSampleInputMode === "record" ? "Recording Preview" : "Upload Preview"}
          </div>
          {uploadPreviewUrl ? (
            <audio
              aria-label={voiceSampleInputMode === "record" ? "Recorded voice sample preview" : "Uploaded voice sample preview"}
              controls
              src={uploadPreviewUrl}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {voiceSampleInputMode === "record" ? "No recording captured." : "No upload selected."}
            </p>
          )}
        </div>
        <Button className="w-full" disabled={!canUpload} type="submit">
          {isUploading || isPreparingSample ? (
            <Loading aria-hidden="true" size="sm" />
          ) : (
            <Save aria-hidden="true" data-icon="inline-start" />
          )}
          {isUploading ? "Saving Voice" : isPreparingSample ? "Preparing Sample" : "Save Voice"}
        </Button>
      </div>
    </form>
  )
}
