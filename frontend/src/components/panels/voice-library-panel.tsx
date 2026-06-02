import { Check, FileAudio, LoaderCircle, Pencil, Star, Trash2, Volume2 } from "lucide-react"

import { ActionMenu } from "@/components/ui/action-menu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AsyncStatus, VoiceAsset } from "@/types"

type VoiceLibraryPanelProps = {
  canSetDefault: boolean
  defaultVoiceId: string
  isGenerating: boolean
  isSettingDefault: boolean
  isUpdatingVoice: boolean
  onDeleteRequest: (voice: VoiceAsset) => void
  onPlayVoice: (voice: VoiceAsset) => void
  onRenameRequest: (voice: VoiceAsset) => void
  onSelectVoice: (voiceId: string) => void
  onSetDefault: () => void
  selectedVoice: VoiceAsset | null
  selectedVoiceId: string
  voiceError: string | null
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
  onRenameRequest,
  onSelectVoice,
  onSetDefault,
  selectedVoice,
  selectedVoiceId,
  voiceError,
  voices,
  voiceStatus,
}: VoiceLibraryPanelProps) {
  return (
    <section className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
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
          <div className="rounded-md border border-border bg-background/50 p-4 text-sm text-muted-foreground">
            Loading voices...
          </div>
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
                  <span className="block truncate font-mono text-xs text-muted-foreground">{voice.filePath}</span>
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
          <audio
            aria-label="Selected voice sample preview"
            controls
            key={selectedVoice.id}
            src={`/api/voices/${encodeURIComponent(selectedVoice.id)}/sample`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No voice selected.</p>
        )}
      </div>

      <Button className="mt-4 w-full" disabled={!canSetDefault} onClick={onSetDefault} variant="secondary">
        {isSettingDefault ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Star aria-hidden="true" className="size-4" />
        )}
        {selectedVoice?.id === defaultVoiceId ? "Default Voice" : "Set as Default"}
      </Button>
    </section>
  )
}
