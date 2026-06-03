import { Badge } from "@/components/ui/badge"
import type { GeneratedAudioTuningMetadata } from "@/types"

type GeneratedAudioMetadataProps = {
  metadata: GeneratedAudioTuningMetadata | null
}

export function GeneratedAudioMetadata({ metadata }: GeneratedAudioMetadataProps) {
  if (!metadata) {
    return null
  }

  return (
    <div aria-label="Generated Audio Settings" className="mb-3 flex flex-wrap gap-2" role="group">
      <Badge>{metadata.providerLabel}</Badge>
      {metadata.presetLabel ? <Badge>Preset: {metadata.presetLabel}</Badge> : null}
      {metadata.mode === "custom" ? <Badge>Custom Settings</Badge> : null}
      {metadata.adjustedSettings.length === 0 ? <Badge>Default Settings</Badge> : null}
      {metadata.adjustedSettings.map((setting) => (
        <Badge
          key={setting.id}
          title={`${setting.label} default: ${setting.nominalValueLabel}`}
          variant="accent"
        >
          {setting.label} {setting.valueLabel}
        </Badge>
      ))}
    </div>
  )
}
