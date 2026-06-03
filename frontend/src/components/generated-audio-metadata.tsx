import { Badge } from "@/components/ui/badge"
import { formatGenerationElapsedTime } from "@/lib/formatters"
import type { GeneratedAudioTuningMetadata } from "@/types"

type GeneratedAudioMetadataProps = {
  generationElapsedMs: number | null
  tuningMetadata: GeneratedAudioTuningMetadata | null
}

export function GeneratedAudioMetadata({ generationElapsedMs, tuningMetadata }: GeneratedAudioMetadataProps) {
  if (!tuningMetadata && generationElapsedMs === null) {
    return null
  }

  return (
    <div aria-label="Generated Audio Metadata" className="mb-3 flex flex-wrap gap-2" role="group">
      {generationElapsedMs !== null ? <Badge>Generated In {formatGenerationElapsedTime(generationElapsedMs)}</Badge> : null}
      {tuningMetadata ? (
        <>
          <Badge>{tuningMetadata.providerLabel}</Badge>
          {tuningMetadata.presetLabel ? <Badge>Preset: {tuningMetadata.presetLabel}</Badge> : null}
          {tuningMetadata.mode === "custom" ? <Badge>Custom Settings</Badge> : null}
          {tuningMetadata.adjustedSettings.length === 0 ? <Badge>Default Settings</Badge> : null}
          {tuningMetadata.adjustedSettings.map((setting) => (
            <Badge
              key={setting.id}
              title={`${setting.label} default: ${setting.nominalValueLabel}`}
              variant="accent"
            >
              {setting.label} {setting.valueLabel}
            </Badge>
          ))}
        </>
      ) : null}
    </div>
  )
}
