import { useMemo, useState } from "react"
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileAudio,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  Star,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react"

import { AudioPlayer } from "@/components/audio-player"
import { ActionMenu } from "@/components/ui/action-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Loading } from "@/components/ui/loading"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { VoicePresetToggleGroup } from "@/components/voice-preset-toggle-group"
import { VoiceTuningControls } from "@/components/voice-tuning-controls"
import {
  CUSTOM_TUNING_PRESET_ID,
  presetValues,
  resolvePresetVoiceTuningState,
  resolveSavedVoiceTuning,
  resolveVoiceTuningState,
  voiceTuningValuesEqual,
} from "@/lib/voice-tuning"
import { cn } from "@/lib/utils"
import { voicePresetLabel } from "@/lib/voice-presets"
import type {
  AsyncStatus,
  ProviderTuningControl,
  ProviderTuningMetadata,
  ProviderTuningPreset,
  ProviderTuningValue,
  VoiceAsset,
  VoicePreset,
  VoicePresetId,
  VoiceTuningSaveRequest,
  VoiceTuningValues,
} from "@/types"

type VoiceLibraryPanelProps = {
  activeProviderId: string | null
  defaultVoiceId: string
  isGenerating: boolean
  isActive: boolean
  isProviderTuningLoading: boolean
  isSettingDefault: boolean
  isUpdatingVoice: boolean
  onDeleteRequest: (voice: VoiceAsset) => void
  onPlayVoice: (voice: VoiceAsset) => void
  onRenameRequest: (voice: VoiceAsset) => void
  onSaveVoiceTuningRequest: (request: VoiceTuningSaveRequest) => void
  onSelectVoice: (voiceId: string) => void
  onSetDefault: (voice: VoiceAsset) => void
  providerTuning: ProviderTuningMetadata
  selectedVoiceId: string
  voiceError: string | null
  voicePresets: VoicePreset[]
  voices: VoiceAsset[]
  voiceStatus: AsyncStatus
}

export function VoiceLibraryPanel({
  activeProviderId,
  defaultVoiceId,
  isGenerating,
  isActive,
  isProviderTuningLoading,
  isSettingDefault,
  isUpdatingVoice,
  onDeleteRequest,
  onPlayVoice,
  onRenameRequest,
  onSaveVoiceTuningRequest,
  onSelectVoice,
  onSetDefault,
  providerTuning,
  selectedVoiceId,
  voiceError,
  voicePresets,
  voices,
  voiceStatus,
}: VoiceLibraryPanelProps) {
  return (
    <section aria-busy={voiceStatus === "loading"} className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Voice Library</h2>
          <p className="mt-1 text-sm text-muted-foreground">Select, preview, and set the local default voice.</p>
        </div>
        <Button asChild size="sm" variant="secondary">
          <a href="#prepare">
            <Upload aria-hidden="true" data-icon="inline-start" />
            Add Voice Sample
          </a>
        </Button>
      </div>

      {voiceError ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
          {voiceError}
        </div>
      ) : null}

      <div className="space-y-2">
        {voiceStatus === "loading" ? (
          <VoiceLibrarySkeletonRows />
        ) : null}
        {voiceStatus !== "loading" && voices.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border bg-background/50 p-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <FileAudio aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="flex min-w-0 flex-col gap-1">
                <div className="font-medium text-foreground">No Voices Saved Yet</div>
                <p>Prepare an audio sample before selecting a voice.</p>
              </div>
            </div>
            <Button asChild size="sm" variant="secondary">
              <a href="#prepare">
                Prepare Audio
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          </div>
        ) : null}
        {voices.map((voice) => {
          const isSelected = voice.id === selectedVoiceId
          const isDefault = voice.id === defaultVoiceId
          return (
            <div
              aria-label={`${voice.name} Voice`}
              className={cn(
                "w-full rounded-md border border-border bg-background/60 p-1 text-sm transition hover:bg-muted",
                isSelected && "border-primary bg-primary/10 hover:bg-primary/10"
              )}
              key={voice.id}
              role="group"
            >
              <div className="flex w-full items-center gap-2">
                <button
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded px-2 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={isGenerating || isUpdatingVoice}
                  onClick={() => onSelectVoice(voice.id)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{voice.name}</span>
                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                      <Badge className="shrink-0 px-1.5 py-0.5" variant="secondary">
                        {voicePresetLabel(voicePresets, voice.voicePresetId)}
                      </Badge>
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{voice.filePath}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {isDefault ? <Star aria-label="Default voice" className="size-4 text-primary" /> : null}
                    {isSelected ? <Check aria-label="Selected voice" className="size-4 text-primary" /> : null}
                  </span>
                </button>
                <ActionMenu
                  ariaLabel={`Open actions for ${voice.name}`}
                  disabled={isGenerating || isUpdatingVoice}
                  items={[
                    {
                      icon: <Volume2 aria-hidden="true" className="size-4" />,
                      label: "Play",
                      onSelect: () => onPlayVoice(voice),
                    },
                    {
                      disabled: isDefault || isSettingDefault,
                      icon: <Star aria-hidden="true" className="size-4" />,
                      label: "Set As Default",
                      onSelect: () => onSetDefault(voice),
                    },
                    {
                      icon: <Pencil aria-hidden="true" className="size-4" />,
                      label: "Rename",
                      onSelect: () => onRenameRequest(voice),
                    },
                    {
                      destructive: true,
                      icon: <Trash2 aria-hidden="true" className="size-4" />,
                      label: "Delete",
                      onSelect: () => onDeleteRequest(voice),
                    },
                  ]}
                />
              </div>

              {isSelected ? (
                <div className="flex flex-col gap-3 px-2 pb-2 pt-1">
                  <Separator className="bg-border/70" />
                  <AudioPlayer
                    ariaLabel={`Voice sample preview for ${voice.name}`}
                    src={`/api/voices/${encodeURIComponent(voice.id)}/sample`}
                  />
                  {isActive ? (
                    <SelectedVoiceTuning
                      activeProviderId={activeProviderId}
                      disabled={isGenerating || isUpdatingVoice}
                      isLoading={isProviderTuningLoading}
                      isSaving={isUpdatingVoice}
                      key={`${voice.id}:${activeProviderId ?? "none"}`}
                      onSaveVoiceTuningRequest={onSaveVoiceTuningRequest}
                      providerTuning={providerTuning}
                      voice={voice}
                      voicePresets={voicePresets}
                    />
                  ) : null}
                  <Button asChild className="w-full">
                    <a href="#generate">
                      Generate Speech
                      <ArrowRight aria-hidden="true" data-icon="inline-end" />
                    </a>
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

type TuningDraft = {
  providerSettingsTouched: boolean
  scopeKey: string
  selectedTuningPresetId: string
  values: VoiceTuningValues
  voicePresetId: VoicePresetId
}

type SelectedVoiceTuningProps = {
  activeProviderId: string | null
  disabled: boolean
  isLoading: boolean
  isSaving: boolean
  onSaveVoiceTuningRequest: (request: VoiceTuningSaveRequest) => void
  providerTuning: ProviderTuningMetadata
  voice: VoiceAsset
  voicePresets: VoicePreset[]
}

function SelectedVoiceTuning({
  activeProviderId,
  disabled,
  isLoading,
  isSaving,
  onSaveVoiceTuningRequest,
  providerTuning,
  voice,
  voicePresets,
}: SelectedVoiceTuningProps) {
  const [draft, setDraft] = useState<TuningDraft | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const savedProviderTuning = resolveSavedVoiceTuning(activeProviderId, voice)
  const resolvedTuning = useMemo(
    () =>
      resolveVoiceTuningState({
        activeProviderId,
        providerTuning,
        voice,
      }),
    [activeProviderId, providerTuning, voice]
  )
  const scopeKey = selectedVoiceTuningScopeKey(activeProviderId, providerTuning, voice)
  const activeDraft =
    draft?.scopeKey === scopeKey
      ? draft
      : {
          providerSettingsTouched: false,
          scopeKey,
          selectedTuningPresetId: resolvedTuning.selectedPresetId,
          values: resolvedTuning.values,
          voicePresetId: voice.voicePresetId,
        }
  const presetChanged = activeDraft.voicePresetId !== voice.voicePresetId
  const providerSettingsChanged = !voiceTuningValuesEqual(activeDraft.values, resolvedTuning.values)
  const shouldSaveVoiceSettings = activeDraft.providerSettingsTouched && providerSettingsChanged
  const hasChanges = presetChanged || providerSettingsChanged
  const saveDisabled = disabled || isLoading || !hasChanges || (shouldSaveVoiceSettings && !activeProviderId)

  function handleVoicePresetChange(voicePresetId: VoicePresetId) {
    setDraft((current) => {
      const currentDraft = current?.scopeKey === scopeKey ? current : activeDraft
      const presetTuning =
        currentDraft.providerSettingsTouched || savedProviderTuning
          ? {
              selectedPresetId: currentDraft.selectedTuningPresetId,
              values: currentDraft.values,
            }
          : resolvePresetVoiceTuningState({ providerTuning, voicePresetId })

      return {
        ...currentDraft,
        selectedTuningPresetId: presetTuning.selectedPresetId,
        values: presetTuning.values,
        voicePresetId,
      }
    })
  }

  function handleProviderPresetApply(preset: ProviderTuningPreset) {
    setDraft((current) => {
      const currentDraft = current?.scopeKey === scopeKey ? current : activeDraft
      return {
        ...currentDraft,
        providerSettingsTouched: true,
        selectedTuningPresetId: preset.id,
        values: presetValues(providerTuning, preset),
      }
    })
  }

  function handleTuningValueChange(control: ProviderTuningControl, value: ProviderTuningValue) {
    setDraft((current) => {
      const currentDraft = current?.scopeKey === scopeKey ? current : activeDraft
      return {
        ...currentDraft,
        providerSettingsTouched: true,
        selectedTuningPresetId: CUSTOM_TUNING_PRESET_ID,
        values: {
          ...currentDraft.values,
          [control.id]: value,
        },
      }
    })
  }

  function handleResetChanges() {
    setDraft(null)
  }

  function handleSave() {
    if (saveDisabled) {
      return
    }

    onSaveVoiceTuningRequest({
      providerId: activeProviderId,
      shouldSaveVoicePreset: presetChanged,
      shouldSaveVoiceSettings,
      voice,
      voicePresetId: activeDraft.voicePresetId,
      voiceSettings: activeDraft.values,
    })
  }

  return (
    <Collapsible onOpenChange={setIsOpen} open={isOpen}>
      <section aria-busy={isLoading || isSaving} className="rounded-md border border-border bg-card/70 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Voice Tuning</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Save default voice behavior for selection and future generations.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasChanges ? <Badge>Unsaved</Badge> : null}
            <CollapsibleTrigger asChild>
              <Button size="sm" type="button" variant="secondary">
                {isOpen ? "Hide Voice Tuning" : "Show Voice Tuning"}
                <ChevronDown
                  aria-hidden="true"
                  className={cn("size-4 transition-transform", isOpen && "rotate-180")}
                  data-icon="inline-end"
                />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        {isOpen ? (
          <CollapsibleContent>
            <div className="mt-3 flex flex-col gap-4">
              <VoicePresetToggleGroup
                disabled={disabled || isLoading}
                id={`selected-${voice.id}-voice-preset`}
                label="Voice Preset"
                onChange={handleVoicePresetChange}
                value={activeDraft.voicePresetId}
                voicePresets={voicePresets}
              />

              {isLoading ? (
                <div className="rounded-md border border-border bg-background/60 p-3">
                  <Loading text="Loading Voice Tuning" variant="secondary" />
                </div>
              ) : null}

              {!isLoading && providerTuning.controls.length > 0 ? (
                <>
                  {providerTuning.presets.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-medium">Provider Tuning Preset</div>
                      <ProviderTuningPresetButtons
                        disabled={disabled}
                        onPresetApply={handleProviderPresetApply}
                        presets={providerTuning.presets}
                        selectedTuningPresetId={activeDraft.selectedTuningPresetId}
                      />
                    </div>
                  ) : null}
                  <VoiceTuningControls
                    controls={providerTuning.controls}
                    disabled={disabled}
                    idPrefix={`selected-${voice.id}-voice-tuning`}
                    onTuningValueChange={handleTuningValueChange}
                    tuning={activeDraft.values}
                  />
                </>
              ) : null}

              {!isLoading && providerTuning.controls.length === 0 ? (
                <div className="rounded-md border border-border bg-background/60 p-3 text-sm text-muted-foreground">
                  The active provider does not expose saved tuning controls.
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                {hasChanges ? (
                  <Button
                    disabled={disabled || isLoading || isSaving}
                    onClick={handleResetChanges}
                    type="button"
                    variant="secondary"
                  >
                    <RotateCcw aria-hidden="true" data-icon="inline-start" />
                    Reset Changes
                  </Button>
                ) : null}
                <Button className={cn(!hasChanges && "sm:col-span-2")} disabled={saveDisabled} onClick={handleSave} type="button">
                  {isSaving ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Save aria-hidden="true" data-icon="inline-start" />
                  )}
                  Save Voice Tuning
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        ) : null}
      </section>
    </Collapsible>
  )
}

function ProviderTuningPresetButtons({
  disabled,
  onPresetApply,
  presets,
  selectedTuningPresetId,
}: {
  disabled: boolean
  onPresetApply: (preset: ProviderTuningPreset) => void
  presets: ProviderTuningPreset[]
  selectedTuningPresetId: string
}) {
  return (
    <div aria-label="Provider tuning presets" className="grid gap-1 rounded-md border border-border bg-background/60 p-1 sm:grid-cols-2" role="group">
      {presets.map((preset) => {
        const isSelected = selectedTuningPresetId === preset.id
        return (
          <button
            aria-pressed={isSelected}
            className={cn(
              "rounded px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "bg-secondary text-secondary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            disabled={disabled}
            key={preset.id}
            onClick={() => onPresetApply(preset)}
            type="button"
          >
            <span className="block font-medium">{preset.label}</span>
            <span className="mt-1 block text-xs leading-5">{preset.description}</span>
          </button>
        )
      })}
    </div>
  )
}

function selectedVoiceTuningScopeKey(
  activeProviderId: string | null,
  providerTuning: ProviderTuningMetadata,
  voice: VoiceAsset
) {
  return [
    activeProviderId ?? "none",
    voice.id,
    voice.voicePresetId,
    JSON.stringify(resolveSavedVoiceTuning(activeProviderId, voice)),
    JSON.stringify(providerTuning.defaultValues),
    providerTuning.controls.map((control) => control.id).join(","),
    providerTuning.presets.map((preset) => `${preset.id}:${preset.voicePresetId ?? ""}`).join(","),
  ].join(":")
}

function VoiceLibrarySkeletonRows() {
  return (
    <div aria-label="Loading Voices" className="flex flex-col gap-2" role="status">
      {[0, 1, 2].map((item) => (
        <div
          aria-hidden="true"
          className="flex w-full items-center gap-2 rounded-md border border-border bg-background/60 p-3"
          key={item}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-32 max-w-full" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
          <Skeleton className="size-8 shrink-0" />
        </div>
      ))}
    </div>
  )
}
