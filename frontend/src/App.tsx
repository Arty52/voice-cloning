import {
  BarChart3,
  ChevronDown,
  Check,
  Download,
  ExternalLink,
  FileAudio,
  Gauge,
  Info,
  LoaderCircle,
  RefreshCw,
  Save,
  Sparkles,
  Star,
  Upload,
  Volume2,
} from "lucide-react"
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type RequestStatus = "idle" | "generating" | "success" | "error"
type AsyncStatus = "idle" | "loading" | "success" | "error"

type VoiceAsset = {
  id: string
  name: string
  filePath: string
  contentType: string
  sha256: string
  source: "default" | "upload"
  createdAt: string
}

type VoicesResponse = {
  defaultVoiceId: string
  voices: VoiceAsset[]
}

type SubscriptionResponse = {
  available: boolean
  error: string | null
  tier: string
  status: string
  characterCount: number
  characterLimit: number
  remainingCharacters: number
  canExtendCharacterLimit: boolean
  maxCreditLimitExtension: number | string | null
  nextCharacterCountResetUnix: number | null
}

type ModelOption = {
  modelId: string
  name: string
  description: string
  canUseStyle: boolean
  canUseSpeakerBoost: boolean
  characterCostMultiplier: number | null
  maxCharactersRequestFreeUser: number | null
  maxCharactersRequestSubscribedUser: number | null
  maximumTextLengthPerRequest: number | null
}

type ModelsResponse = {
  available: boolean
  error: string | null
  defaultModelId: string
  models: ModelOption[]
}

type GeneratedResult = {
  url: string
  cacheState: string
  voiceId: string
  appVoiceId: string
  modelId: string
  characterCount: number | null
  requestId: string | null
  generatedAt: string
}

type VoiceTuning = {
  stability: number
  similarityBoost: number
  style: number
  speed: number
  useSpeakerBoost: boolean
}

type TuningPresetId = "standard" | "animated" | "custom"

type TuningPreset = {
  id: Exclude<TuningPresetId, "custom">
  label: string
  description: string
  values: Pick<VoiceTuning, "stability" | "similarityBoost" | "style" | "speed">
}

type SliderConfig = {
  id: keyof Pick<VoiceTuning, "stability" | "similarityBoost" | "style" | "speed">
  label: string
  help: string
  min: number
  max: number
  step: number
}

const DEFAULT_TEXT =
  "Welcome to the local voice clone lab. This sample is generated through ElevenLabs using the selected voice reference."

const DEFAULT_MODEL_ID = "eleven_multilingual_v2"
const BACKEND_DEFAULT_MODEL_LABEL = "Backend default model"

const DEFAULT_TUNING: VoiceTuning = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  useSpeakerBoost: true,
}

const TUNING_PRESETS: TuningPreset[] = [
  {
    id: "standard",
    label: "Standard narration",
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
    label: "Animated dialogue",
    description: "More expressive delivery for character reads.",
    values: {
      stability: 0.4,
      similarityBoost: 0.75,
      style: 0.35,
      speed: 1,
    },
  },
]

const SLIDERS: SliderConfig[] = [
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

const DOC_LINKS = [
  {
    label: "API requests",
    href: "https://elevenlabs.io/app/developers/analytics/api-requests",
  },
  {
    label: "Costs header",
    href: "https://elevenlabs.io/docs/api-reference/introduction",
  },
  {
    label: "Subscription",
    href: "https://elevenlabs.io/docs/api-reference/user/subscription/get",
  },
  {
    label: "Models",
    href: "https://elevenlabs.io/docs/api-reference/get-models",
  },
  {
    label: "Create speech",
    href: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
  },
]

function App() {
  const [text, setText] = useState(DEFAULT_TEXT)
  const [voices, setVoices] = useState<VoiceAsset[]>([])
  const [defaultVoiceId, setDefaultVoiceId] = useState<string>("")
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("")
  const [voiceStatus, setVoiceStatus] = useState<AsyncStatus>("idle")
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [uploadName, setUploadName] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<AsyncStatus>("idle")
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [defaultStatus, setDefaultStatus] = useState<AsyncStatus>("idle")
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] = useState<AsyncStatus>("idle")
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelStatus, setModelStatus] = useState<AsyncStatus>("idle")
  const [modelError, setModelError] = useState<string | null>(null)
  const [backendDefaultModelId, setBackendDefaultModelId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID)
  const [result, setResult] = useState<GeneratedResult | null>(null)
  const [status, setStatus] = useState<RequestStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [tuning, setTuning] = useState<VoiceTuning>(DEFAULT_TUNING)
  const [selectedTuningPreset, setSelectedTuningPreset] = useState<TuningPresetId>("standard")
  const [isCostQuotaExpanded, setIsCostQuotaExpanded] = useState(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) ?? null
  const selectedModel = models.find((model) => model.modelId === selectedModelId) ?? null
  const isGenerating = status === "generating"
  const isUploading = uploadStatus === "loading"
  const isSettingDefault = defaultStatus === "loading"
  const canGenerate = text.trim().length > 0 && selectedVoice !== null && !isGenerating
  const canUpload = uploadName.trim().length > 0 && uploadFile !== null && !isUploading
  const canSetDefault = selectedVoice !== null && selectedVoice.id !== defaultVoiceId && !isSettingDefault
  const characterCount = useMemo(() => text.trim().length, [text])
  const modelMultiplier = selectedModel?.characterCostMultiplier ?? null
  const estimatedCredits = modelMultiplier === null ? characterCount : Math.ceil(characterCount * modelMultiplier)
  const hasModelRate = modelMultiplier !== null

  useEffect(() => {
    async function loadVoices() {
      setVoiceStatus("loading")
      setVoiceError(null)
      try {
        const payload = await fetchJson<VoicesResponse>("/api/voices")
        setVoices(payload.voices)
        setDefaultVoiceId(payload.defaultVoiceId)
        setSelectedVoiceId((current) => current || payload.defaultVoiceId || payload.voices[0]?.id || "")
        setVoiceStatus("success")
      } catch (caught) {
        setVoiceStatus("error")
        setVoiceError(caught instanceof Error ? caught.message : "Unable to load voices.")
      }
    }

    void loadVoices()
  }, [])

  useEffect(() => {
    void loadSubscription()
    void loadModels()
  }, [])

  useLayoutEffect(() => {
    const textarea = textRef.current
    if (!textarea) {
      return
    }
    textarea.style.height = "auto"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [text])

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl)
      }
    }
  }, [uploadPreviewUrl])

  useEffect(() => {
    return () => {
      if (result) {
        URL.revokeObjectURL(result.url)
      }
    }
  }, [result])

  function handleUploadFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setUploadFile(nextFile)
    setUploadPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null)
    setUploadError(null)
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canUpload || !uploadFile) {
      setUploadStatus("error")
      setUploadError("Add a voice name and audio sample before saving.")
      return
    }

    setUploadStatus("loading")
    setUploadError(null)
    const formData = new FormData()
    formData.append("name", uploadName.trim())
    formData.append("sampleFile", uploadFile)

    try {
      const payload = await fetchJson<{ voice: VoiceAsset }>("/api/voices", {
        method: "POST",
        body: formData,
      })
      setVoices((current) => [...current, payload.voice])
      setSelectedVoiceId(payload.voice.id)
      setUploadName("")
      setUploadFile(null)
      setUploadPreviewUrl(null)
      setUploadStatus("success")
    } catch (caught) {
      setUploadStatus("error")
      setUploadError(caught instanceof Error ? caught.message : "Unable to save voice.")
    }
  }

  async function handleSetDefault() {
    if (!selectedVoice) {
      return
    }
    setDefaultStatus("loading")
    setVoiceError(null)
    try {
      const payload = await fetchJson<VoicesResponse>("/api/voices/default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: selectedVoice.id }),
      })
      setVoices(payload.voices)
      setDefaultVoiceId(payload.defaultVoiceId)
      setDefaultStatus("success")
    } catch (caught) {
      setDefaultStatus("error")
      setVoiceError(caught instanceof Error ? caught.message : "Unable to set default voice.")
    }
  }

  async function loadSubscription() {
    setSubscriptionStatus("loading")
    setSubscriptionError(null)
    try {
      const payload = await fetchJson<SubscriptionResponse>("/api/subscription")
      if (payload.available) {
        setSubscription(payload)
        setSubscriptionStatus("success")
      } else {
        setSubscription(null)
        setSubscriptionStatus("error")
        setSubscriptionError(payload.error || "Quota unavailable.")
      }
    } catch (caught) {
      setSubscription(null)
      setSubscriptionStatus("error")
      setSubscriptionError(caught instanceof Error ? caught.message : "Unable to load quota.")
    }
  }

  async function loadModels() {
    setModelStatus("loading")
    setModelError(null)
    try {
      const payload = await fetchJson<ModelsResponse>("/api/models")
      const loadedModels = Array.isArray(payload.models) ? payload.models : []
      setBackendDefaultModelId(payload.defaultModelId || null)
      setModels(payload.available ? loadedModels : [])
      setSelectedModelId((current) => {
        if (payload.available && loadedModels.some((model) => model.modelId === current)) {
          return current
        }
        return payload.defaultModelId || loadedModels[0]?.modelId || DEFAULT_MODEL_ID
      })
      if (payload.available) {
        setModelStatus("success")
      } else {
        setModelStatus("error")
        setModelError(payload.error || "Model metadata unavailable.")
      }
    } catch (caught) {
      setModels([])
      setBackendDefaultModelId(null)
      setSelectedModelId((current) => current || DEFAULT_MODEL_ID)
      setModelStatus("error")
      setModelError(caught instanceof Error ? caught.message : "Unable to load models.")
    }
  }

  async function handleGenerate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!canGenerate || !selectedVoice) {
      setStatus("error")
      setError(selectedVoice ? "Enter text first." : "Select a voice first.")
      return
    }

    setStatus("generating")
    setError(null)

    const formData = new FormData()
    const submittedModelId = models.some((model) => model.modelId === selectedModelId) ? selectedModelId : null
    formData.append("text", text.trim())
    formData.append("voiceId", selectedVoice.id)
    if (submittedModelId) {
      formData.append("modelId", submittedModelId)
    }
    formData.append("stability", String(tuning.stability))
    formData.append("similarityBoost", String(tuning.similarityBoost))
    formData.append("style", String(tuning.style))
    formData.append("speed", String(tuning.speed))
    formData.append("useSpeakerBoost", String(tuning.useSpeakerBoost))

    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        throw new Error(await readError(response))
      }

      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)
      const generatedAt = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      setResult((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous.url)
        }
        return {
          url: audioUrl,
          cacheState: response.headers.get("X-Voice-Cache") || "unknown",
          voiceId: response.headers.get("X-Voice-Id") || "unknown",
          appVoiceId: response.headers.get("X-App-Voice-Id") || selectedVoice.id,
          modelId: response.headers.get("X-Model-Id") || submittedModelId || backendDefaultModelId || BACKEND_DEFAULT_MODEL_LABEL,
          characterCount: parseNullableInt(response.headers.get("X-Character-Count")),
          requestId: response.headers.get("X-Request-Id"),
          generatedAt,
        }
      })
      setStatus("success")
    } catch (caught) {
      setStatus("error")
      setError(caught instanceof Error ? caught.message : "Unable to generate speech.")
    }
  }

  function updateTuningValue(key: SliderConfig["id"], value: string) {
    setSelectedTuningPreset("custom")
    setTuning((current) => ({
      ...current,
      [key]: Number(value),
    }))
  }

  function applyTuningPreset(preset: TuningPreset) {
    setSelectedTuningPreset(preset.id)
    setTuning((current) => ({
      ...current,
      ...preset.values,
    }))
  }

  return (
    <main className="min-h-svh px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Volume2 aria-hidden="true" className="size-4 text-primary" />
              Local ElevenLabs workspace
            </div>
            <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">Voice Clone Lab</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Generate speech from saved voice samples while keeping the ElevenLabs key on the local API.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Frontend 4340</Badge>
            <Badge>API 6420</Badge>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(23rem,0.85fr)]">
          <section className="flex flex-col gap-4">
            <form
              aria-busy={isGenerating}
              className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5"
              onSubmit={handleGenerate}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <label className="text-sm font-medium" htmlFor="speech-text">
                  Text to speak
                </label>
                <span className="font-mono text-xs text-muted-foreground">{characterCount}/5000</span>
              </div>
              <Textarea
                className="max-h-none overflow-hidden"
                disabled={isGenerating}
                id="speech-text"
                maxLength={5000}
                onChange={(event) => setText(event.target.value)}
                placeholder="Enter the text you want to synthesize."
                ref={textRef}
                rows={1}
                value={text}
              />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  Source: <span className="text-foreground">{selectedVoice?.name || "No voice selected"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!canGenerate} type="submit">
                    {isGenerating ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Sparkles aria-hidden="true" className="size-4" />
                    )}
                    {isGenerating ? "Generating..." : "Generate"}
                  </Button>
                  <Button disabled={!canGenerate} onClick={() => void handleGenerate()} variant="secondary">
                    <RefreshCw aria-hidden="true" className="size-4" />
                    Retry
                  </Button>
                </div>
              </div>
            </form>

            <section className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium">Voice tuning</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Adjust ElevenLabs voice settings before generating.</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {selectedTuningPreset === "custom" ? <Badge>Custom</Badge> : null}
                  <Badge>Per request</Badge>
                </div>
              </div>
              <div className="mb-4 space-y-2">
                <div className="text-sm font-medium">Preset</div>
                <div
                  aria-label="Voice tuning presets"
                  className="grid gap-1 rounded-md border border-border bg-background/60 p-1 sm:grid-cols-2"
                  role="group"
                >
                  {TUNING_PRESETS.map((preset) => {
                    const isSelected = selectedTuningPreset === preset.id
                    return (
                      <button
                        aria-pressed={isSelected}
                        className={cn(
                          "rounded px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isSelected
                            ? "bg-secondary text-secondary-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                        disabled={isGenerating}
                        key={preset.id}
                        onClick={() => applyTuningPreset(preset)}
                        type="button"
                      >
                        <span className="block font-medium">{preset.label}</span>
                        <span className="mt-1 block text-xs leading-5">{preset.description}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {SLIDERS.map((slider) => (
                  <div className="space-y-2" key={slider.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-1.5">
                        <label className="font-medium" htmlFor={slider.id}>
                          {slider.label}
                        </label>
                        <TuningInfo description={slider.help} id={slider.id} label={slider.label} />
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {tuning[slider.id].toFixed(2)}
                      </span>
                    </div>
                    <input
                      className="h-2 w-full accent-primary"
                      disabled={isGenerating}
                      id={slider.id}
                      max={slider.max}
                      min={slider.min}
                      onChange={(event) => updateTuningValue(slider.id, event.target.value)}
                      step={slider.step}
                      type="range"
                      value={tuning[slider.id]}
                    />
                  </div>
                ))}
              </div>
              <label className="mt-4 flex items-center justify-between gap-4 rounded-md border border-border bg-background/60 p-3 text-sm">
                <span className="font-medium">Speaker boost</span>
                <input
                  checked={tuning.useSpeakerBoost}
                  className="size-5 accent-primary"
                  disabled={isGenerating}
                  onChange={(event) => {
                    setSelectedTuningPreset("custom")
                    setTuning((current) => ({ ...current, useSpeakerBoost: event.target.checked }))
                  }}
                  type="checkbox"
                />
              </label>
            </section>

            <GeneratedAudio error={error} result={result} />
          </section>

          <aside className="flex flex-col gap-4">
            <section className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium">Voice library</h2>
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
                    No voices saved yet. Add a named voice sample to generate speech.
                  </div>
                ) : null}
                {voices.map((voice) => {
                  const isSelected = voice.id === selectedVoiceId
                  const isDefault = voice.id === defaultVoiceId
                  return (
                    <button
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-3 text-left text-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSelected && "border-primary bg-primary/10"
                      )}
                      disabled={isGenerating}
                      key={voice.id}
                      onClick={() => setSelectedVoiceId(voice.id)}
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
                  )
                })}
              </div>

              <div className="mt-4 rounded-md border border-border bg-background/60 p-3">
                <div className="mb-2 text-sm font-medium">Selected preview</div>
                {selectedVoice ? (
                  <audio
                    aria-label="Selected voice sample preview"
                    controls
                    key={selectedVoice.id}
                    src={`/api/voices/${selectedVoice.id}/sample`}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No voice selected.</p>
                )}
              </div>

              <Button className="mt-4 w-full" disabled={!canSetDefault} onClick={() => void handleSetDefault()} variant="secondary">
                {isSettingDefault ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Star aria-hidden="true" className="size-4" />
                )}
                {selectedVoice?.id === defaultVoiceId ? "Default voice" : "Set as default"}
              </Button>
            </section>

            <form className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5" onSubmit={handleUpload}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium">Add voice</h2>
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
                  <span>Voice name</span>
                  <Input
                    disabled={isUploading}
                    id="voice-name"
                    onChange={(event) => setUploadName(event.target.value)}
                    placeholder="Gray"
                    value={uploadName}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium" htmlFor="sample-upload">
                  <span>Sample file</span>
                  <Input
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                    disabled={isUploading}
                    id="sample-upload"
                    onChange={handleUploadFileChange}
                    type="file"
                  />
                </label>
                <div className="rounded-md border border-border bg-background/60 p-3">
                  <div className="mb-2 text-sm font-medium">Upload preview</div>
                  {uploadPreviewUrl ? (
                    <audio aria-label="Uploaded voice sample preview" controls src={uploadPreviewUrl} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No upload selected.</p>
                  )}
                </div>
                <Button className="w-full" disabled={!canUpload} type="submit">
                  {isUploading ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Save aria-hidden="true" className="size-4" />
                  )}
                  {isUploading ? "Saving..." : "Save voice"}
                </Button>
              </div>
            </form>

            <CostQuotaPanel
              characterCount={characterCount}
              estimatedCredits={estimatedCredits}
              hasModelRate={hasModelRate}
              isExpanded={isCostQuotaExpanded}
              isGenerating={isGenerating}
              modelError={modelError}
              modelStatus={modelStatus}
              models={models}
              onModelChange={setSelectedModelId}
              onRefresh={() => {
                void loadSubscription()
                void loadModels()
              }}
              onToggleExpanded={() => setIsCostQuotaExpanded((current) => !current)}
              result={result}
              selectedModel={selectedModel}
              selectedModelId={selectedModelId}
              subscription={subscription}
              subscriptionError={subscriptionError}
              subscriptionStatus={subscriptionStatus}
            />
          </aside>
        </div>
      </div>
    </main>
  )
}

function TuningInfo({ description, id, label }: { description: string; id: string; label: string }) {
  const tooltipId = `${id}-help`

  return (
    <span className="group relative inline-flex">
      <button
        aria-describedby={tooltipId}
        aria-label={`${label} help`}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </button>
      <span
        className="pointer-events-none absolute left-0 top-6 z-20 w-72 max-w-[min(18rem,calc(100vw-3rem))] rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        {description}
      </span>
    </span>
  )
}

function CostQuotaPanel({
  characterCount,
  estimatedCredits,
  hasModelRate,
  isExpanded,
  isGenerating,
  modelError,
  modelStatus,
  models,
  onModelChange,
  onRefresh,
  onToggleExpanded,
  result,
  selectedModel,
  selectedModelId,
  subscription,
  subscriptionError,
  subscriptionStatus,
}: {
  characterCount: number
  estimatedCredits: number
  hasModelRate: boolean
  isExpanded: boolean
  isGenerating: boolean
  modelError: string | null
  modelStatus: AsyncStatus
  models: ModelOption[]
  onModelChange: (modelId: string) => void
  onRefresh: () => void
  onToggleExpanded: () => void
  result: GeneratedResult | null
  selectedModel: ModelOption | null
  selectedModelId: string
  subscription: SubscriptionResponse | null
  subscriptionError: string | null
  subscriptionStatus: AsyncStatus
}) {
  const isLoading = subscriptionStatus === "loading" || modelStatus === "loading"
  const detailsId = "cost-quota-details"
  const quotaStatus =
    subscriptionStatus === "loading"
      ? "Loading quota..."
      : subscription
        ? `${formatNumber(subscription.remainingCharacters)} remaining`
        : "Quota unavailable"
  const usedPercent =
    subscription && subscription.characterLimit > 0
      ? Math.min(100, Math.round((subscription.characterCount / subscription.characterLimit) * 100))
      : null

  return (
    <section className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Cost & quota</h2>
          <p className="mt-1 text-sm text-muted-foreground">Estimate, quota, and last run usage.</p>
        </div>
        <Button
          aria-controls={detailsId}
          aria-expanded={isExpanded}
          onClick={onToggleExpanded}
          size="sm"
          type="button"
          variant="secondary"
        >
          {isExpanded ? "Collapse" : "Expand"}
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
        </Button>
      </div>

      <div className="grid gap-3 border-y border-border py-3 sm:grid-cols-3 sm:divide-x sm:divide-border">
        <MetricTile
          icon={<BarChart3 aria-hidden="true" className="size-4" />}
          label="Estimate"
          value={`~${formatNumber(estimatedCredits)}`}
        />
        <MetricTile icon={<Gauge aria-hidden="true" className="size-4" />} label="Quota" value={quotaStatus} />
        <MetricTile
          icon={<Check aria-hidden="true" className="size-4" />}
          label="Actual"
          value={
            result?.characterCount !== null && result?.characterCount !== undefined
              ? formatNumber(result.characterCount)
              : "No run"
          }
        />
      </div>

      <div aria-hidden={!isExpanded} className="mt-4 space-y-4" hidden={!isExpanded} id={detailsId}>
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="text-sm font-medium">Details</div>
          <Button
            aria-label="Refresh cost and quota"
            disabled={isLoading}
            onClick={onRefresh}
            size="icon"
            type="button"
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" className={cn("size-4", isLoading && "animate-spin")} />
          </Button>
        </div>

        <label className="block space-y-2 text-sm font-medium" htmlFor="model-select">
          <span>Model</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isGenerating || modelStatus === "loading" || models.length === 0}
            id="model-select"
            onChange={(event) => onModelChange(event.target.value)}
            value={selectedModelId}
          >
            {models.length > 0 ? (
              models.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.name}
                </option>
              ))
            ) : (
              <option value={selectedModelId}>Backend default model</option>
            )}
          </select>
        </label>

        <div className="grid gap-3 border-b border-border pb-3 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <div className="font-medium text-foreground">Estimate basis</div>
            <div className="mt-1 font-mono tabular-nums">
              {formatNumber(characterCount)} chars
              {hasModelRate ? ` x ${selectedModel?.characterCostMultiplier}` : " x character count"}
            </div>
            <div className="mt-1">{hasModelRate ? "Uses model rate metadata." : "Rate unavailable; using character count."}</div>
          </div>
          <div>
            <div className="font-medium text-foreground">Account period</div>
            <div className="mt-1 font-mono tabular-nums">
              {subscription ? `${formatNumber(subscription.characterCount)} / ${formatNumber(subscription.characterLimit)}` : "Unavailable"}
            </div>
            <div className="mt-1">
              {subscription
                ? `${subscription.tier} - ${subscription.status}${usedPercent === null ? "" : ` - ${usedPercent}% used`}`
                : subscriptionError || "No quota loaded."}
            </div>
          </div>
        </div>

        {modelError ? <div className="text-sm text-muted-foreground">Model metadata unavailable: {modelError}</div> : null}

        {result?.requestId ? <div className="font-mono text-xs text-muted-foreground">Request {result.requestId}</div> : null}

        <div className="flex flex-wrap gap-2">
          {DOC_LINKS.map((link) => (
            <a
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={link.href}
              key={link.href}
              rel="noreferrer"
              target="_blank"
            >
              {link.label}
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

function MetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 sm:px-3 first:sm:pl-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate font-mono text-sm tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function GeneratedAudio({ error, result }: { error: string | null; result: GeneratedResult | null }) {
  return (
    <section className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Generated audio</h2>
          <p className="mt-1 text-sm text-muted-foreground">Playback and download appear after a run.</p>
        </div>
        {result ? <Badge>{result.cacheState === "hit" ? "cache hit" : "cache miss"}</Badge> : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground" role="alert">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <audio aria-label="Generated voice playback" controls src={result.url} />
          <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono">Voice {result.voiceId}</span>
            <span className="font-mono">Model {result.modelId}</span>
            <span>
              {result.characterCount === null ? "Generated" : `${formatNumber(result.characterCount)} chars`}{" "}
              {result.generatedAt}
            </span>
          </div>
          <a
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-4 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            download={`voice-clone-${result.appVoiceId}.mp3`}
            href={result.url}
          >
            <Download aria-hidden="true" className="size-4" />
            Download
          </a>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-background/50 p-5 text-sm text-muted-foreground">
          No generated speech yet.
        </div>
      )}
    </section>
  )
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return (await response.json()) as T
}

async function readError(response: Response) {
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === "string") {
      return payload.detail
    }
  }
  const text = await response.text()
  return text || `Request failed with status ${response.status}.`
}

function parseNullableInt(value: string | null) {
  if (!value) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

export default App
