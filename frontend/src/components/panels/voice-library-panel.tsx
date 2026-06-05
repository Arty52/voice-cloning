import { Check, FileAudio, Pencil, Star, Trash2, Volume2 } from "lucide-react"

import { AudioPlayer } from "@/components/audio-player"
import { ActionMenu } from "@/components/ui/action-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loading } from "@/components/ui/loading"
import { Skeleton } from "@/components/ui/skeleton"
import { VoicePresetToggleGroup } from "@/components/voice-preset-toggle-group"
import { cn } from "@/lib/utils"
import { voicePresetLabel } from "@/lib/voice-presets"
import type { AsyncStatus, VoiceAsset, VoicePreset, VoicePresetId } from "@/types"

type VoiceLibraryPanelProps = {
  canSetDefault: boolean
  defaultVoiceId: string
  isGenerating: boolean
  isSettingDefault: boolean
  isUpdatingVoice: boolean
  onDeleteRequest: (voice: VoiceAsset) => void
  onPlayVoice: (voice: VoiceAsset) => void
  onPresetChange: (voice: VoiceAsset, voicePresetId: VoicePresetId) => void
  onRenameRequest: (voice: VoiceAsset) => void
  onSelectVoice: (voiceId: string) => void
  onSetDefault: () => void
  selectedVoice: VoiceAsset | null
  selectedVoiceId: string
  voiceError: string | null
  voicePresets: VoicePreset[]
  voices: VoiceAsset[]
  voiceStatus: AsyncStatus
}

export function VoiceLibraryPanel({
  canSetDefault,
  defaultVoiceId,
  isGenerating,
  isSettingDefault,
  isUpdatingVoice,
  onDeleteRequest,
  onPlayVoice,
  onPresetChange,
  onRenameRequest,
  onSelectVoice,
  onSetDefault,
  selectedVoice,
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
        <FileAudio aria-hidden="true" className="size-5 text-primary" />
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
          <div className="rounded-md border border-dashed border-border bg-background/50 p-4 text-sm text-muted-foreground">
            No voices saved yet. Add or record a voice to proceed.
          </div>
        ) : null}
        {voices.map((voice) => {
          const isSelected = voice.id === selectedVoiceId
          const isDefault = voice.id === defaultVoiceId
          return (
            <div
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-border bg-background/60 p-1 text-sm transition hover:bg-muted",
                isSelected && "border-primary bg-primary/10"
              )}
              key={voice.id}
            >
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
          )
        })}
      </div>

      <div className="mt-4 rounded-md border border-border bg-background/60 p-3">
        <div className="mb-2 text-sm font-medium">Selected Preview</div>
        {selectedVoice ? (
          <div className="flex flex-col gap-3">
            <AudioPlayer
              ariaLabel="Selected voice sample preview"
              key={selectedVoice.id}
              src={`/api/voices/${encodeURIComponent(selectedVoice.id)}/sample`}
            />
            <VoicePresetToggleGroup
              disabled={isGenerating || isUpdatingVoice}
              id="selected-voice-preset"
              label="Voice Preset"
              onChange={(voicePresetId) => onPresetChange(selectedVoice, voicePresetId)}
              value={selectedVoice.voicePresetId}
              voicePresets={voicePresets}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No voice selected.</p>
        )}
      </div>

      <Button className="mt-4 w-full" disabled={!canSetDefault} onClick={onSetDefault} variant="secondary">
        {isSettingDefault ? (
          <Loading aria-hidden="true" size="sm" />
        ) : (
          <Star aria-hidden="true" className="size-4" />
        )}
        {isSettingDefault ? "Setting Default Voice" : selectedVoice?.id === defaultVoiceId ? "Default Voice" : "Set as Default"}
      </Button>
    </section>
  )
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
