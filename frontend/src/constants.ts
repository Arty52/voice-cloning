import type { SliderConfig, TuningPreset, VoiceTuning } from "@/types"

export const DEFAULT_TEXT =
  "Welcome to the local voice clone lab. This sample is generated with the selected voice reference."

export const CANCEL_GENERATION_CONFIRMATION =
  "Cancel this generation? The provider may still process an in-flight text-to-speech request, so this may still consume credits."
export const CANCELED_GENERATION_MESSAGE =
  "Generation canceled in this browser. The provider may still charge for the request."
export const DEFAULT_MODEL_ID = "eleven_multilingual_v2"
export const BACKEND_DEFAULT_MODEL_LABEL = "Backend Default Model"

export const DEFAULT_TUNING: VoiceTuning = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  useSpeakerBoost: true,
}

export const TUNING_PRESETS: TuningPreset[] = [
  {
    id: "standard",
    label: "Standard Narration",
    description: "Balanced clone similarity for steady narration.",
    values: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speed: 1,
    },
  },
  {
    id: "animated",
    label: "Animated Dialogue",
    description: "More expressive delivery for character reads.",
    values: {
      stability: 0.4,
      similarityBoost: 0.75,
      style: 0.35,
      speed: 1,
    },
  },
]

export const SLIDERS: SliderConfig[] = [
  {
    id: "stability",
    label: "Stability",
    help: "Lower values allow more expressive, variable delivery. Higher values keep the voice consistent but can flatten emotion.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    id: "similarityBoost",
    label: "Similarity",
    help: "Higher values stay closer to the cloned voice. If the source has noise, clicks, or artifacts, very high similarity can preserve them.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    id: "style",
    label: "Style",
    help: "Zero is the most natural and consistent. Higher values exaggerate the speaker's style and may add latency or artifacts.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    id: "speed",
    label: "Speed",
    help: "One point zero is the baseline pace. Move toward 0.7 to slow down or 1.2 to speed up; extremes can reduce quality.",
    min: 0.7,
    max: 1.2,
    step: 0.01,
  },
]

export const DOC_LINKS = [
  {
    label: "API Requests",
    href: "https://elevenlabs.io/app/developers/analytics/api-requests",
  },
  {
    label: "Costs Header",
    href: "https://elevenlabs.io/docs/api-reference/introduction",
  },
  {
    label: "Subscription",
    href: "https://elevenlabs.io/docs/api-reference/user/subscription/get",
  },
  {
    label: "Models",
    href: "https://elevenlabs.io/docs/api-reference/models/list",
  },
  {
    label: "Create Speech",
    href: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
  },
]
