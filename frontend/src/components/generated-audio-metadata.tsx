import { MetadataBadgePopover } from "@/components/metadata-badge-popover"
import { Badge } from "@/components/ui/badge"
import { formatGenerationElapsedTime } from "@/lib/formatters"
import type {
  GeneratedAudioAdjustedSetting,
  GeneratedAudioMultiVoiceMetadata,
  GeneratedAudioTuningMetadata,
} from "@/types"

type GeneratedAudioMetadataProps = {
  customSettingsPopoverId?: string
  customSettingsPopoverOpen?: boolean
  generationElapsedMs: number | null
  multiVoiceMetadata?: GeneratedAudioMultiVoiceMetadata | null
  onCustomSettingsPopoverOpenChange?: (id: string, open: boolean) => void
  tuningMetadata: GeneratedAudioTuningMetadata | null
}

export function GeneratedAudioMetadata({
  customSettingsPopoverId,
  customSettingsPopoverOpen,
  generationElapsedMs,
  multiVoiceMetadata = null,
  onCustomSettingsPopoverOpenChange,
  tuningMetadata,
}: GeneratedAudioMetadataProps) {
  if (!tuningMetadata && generationElapsedMs === null) {
    return null
  }

  const multiVoiceTuningSummaries = multiVoiceMetadata?.tuningSummaries ?? []
  const showMultiVoiceCustomSettings = multiVoiceTuningSummaries.length > 0
  const handleCustomSettingsPopoverOpenChange =
    customSettingsPopoverId && onCustomSettingsPopoverOpenChange
      ? (open: boolean) => onCustomSettingsPopoverOpenChange(customSettingsPopoverId, open)
      : undefined
  const isCustomSettingsPopoverControlled =
    customSettingsPopoverOpen !== undefined && handleCustomSettingsPopoverOpenChange !== undefined

  return (
    <div aria-label="Generated Audio Metadata" className="mb-3 flex flex-wrap gap-2" role="group">
      {generationElapsedMs !== null ? <Badge>Generated In {formatGenerationElapsedTime(generationElapsedMs)}</Badge> : null}
      {tuningMetadata ? (
        <>
          <Badge>{tuningMetadata.providerLabel}</Badge>
          {tuningMetadata.mode === "userPreset" && tuningMetadata.userPreset ? (
            <Badge>User Preset: {tuningMetadata.userPreset.name}</Badge>
          ) : tuningMetadata.presetLabel ? (
            <Badge>Preset: {tuningMetadata.presetLabel}</Badge>
          ) : null}
          {showMultiVoiceCustomSettings ? (
            <MetadataBadgePopover
              ariaLabel="Show Multi-Voice Custom Settings"
              contentClassName="max-w-xl"
              label="Custom Settings"
              onOpenChange={handleCustomSettingsPopoverOpenChange}
              open={isCustomSettingsPopoverControlled ? customSettingsPopoverOpen : undefined}
              side="top"
              sideOffset={8}
            >
              <div className="flex min-w-64 flex-col gap-3">
                {multiVoiceTuningSummaries.map((summary) => (
                  <div className="flex flex-wrap items-center gap-2" key={summary.id}>
                    <span className="min-w-20 font-mono text-sm font-medium text-foreground">
                      {summary.voiceName}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {summary.adjustedSettings.map((setting) => (
                        <AdjustedSettingBadge key={setting.id} setting={setting} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </MetadataBadgePopover>
          ) : tuningMetadata.mode === "custom" ? (
            <Badge>Custom Settings</Badge>
          ) : null}
          {tuningMetadata.adjustedSettings.length === 0 && !showMultiVoiceCustomSettings ? (
            <Badge>Default Settings</Badge>
          ) : null}
          {showMultiVoiceCustomSettings
            ? null
            : tuningMetadata.adjustedSettings.map((setting) => (
                <AdjustedSettingBadge key={setting.id} setting={setting} />
              ))}
        </>
      ) : null}
    </div>
  )
}

function AdjustedSettingBadge({ setting }: { setting: GeneratedAudioAdjustedSetting }) {
  return (
    <Badge
      title={`${setting.label} default: ${setting.nominalValueLabel}`}
      variant="modified"
    >
      {setting.label} {setting.valueLabel}
    </Badge>
  )
}
