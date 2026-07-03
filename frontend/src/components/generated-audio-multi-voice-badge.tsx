import { MetadataBadgePopover } from "@/components/metadata-badge-popover"
import { Badge } from "@/components/ui/badge"
import type { GeneratedAudioMultiVoiceMetadata } from "@/types"

type GeneratedAudioMultiVoiceBadgeProps = {
  metadata: GeneratedAudioMultiVoiceMetadata
}

export function GeneratedAudioMultiVoiceBadge({ metadata }: GeneratedAudioMultiVoiceBadgeProps) {
  return (
    <MetadataBadgePopover
      ariaLabel="Show Multi-Voice Generation Details"
      label="Multi-Voice"
      variant="accent"
    >
      <div className="flex flex-wrap gap-2">
        <Badge>{metadata.segmentCount} Segments</Badge>
        {metadata.voices.map((voice) => (
          <Badge key={voice.voiceId} variant="secondary">
            {voice.voiceName} x{voice.segmentCount}
          </Badge>
        ))}
      </div>
    </MetadataBadgePopover>
  )
}
