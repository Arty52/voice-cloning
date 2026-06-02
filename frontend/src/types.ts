import type { FormEvent } from "react"

export type RequestStatus = "idle" | "generating" | "success" | "error" | "canceled"
export type AsyncStatus = "idle" | "loading" | "success" | "error"
export type RecorderStatus = "idle" | "starting" | "recording" | "stopping" | "recorded" | "error"
export type VoiceSampleInputMode = "upload" | "record"
export type ProviderKeySource = "browser" | "server" | "missing"

export type VoiceProvider = {
  id: string
  label: string
  serverKeyConfigured: boolean
  manageKeyUrl: string
  docsUrl: string
  links: ProviderLink[]
  tuning: ProviderTuningMetadata
}

export type ProviderLink = {
  label: string
  href: string
}

export type ProviderTuningValue = string | number | boolean

export type ProviderTuningOption = {
  label: string
  value: ProviderTuningValue
}

export type ProviderTuningControl = {
  id: string
  label: string
  description: string
  type: "slider" | "toggle" | "select"
  defaultValue: ProviderTuningValue
  min?: number
  max?: number
  step?: number
  options?: ProviderTuningOption[]
  capability?: string
}

export type ProviderTuningPreset = {
  id: string
  label: string
  description: string
  values: VoiceTuningValues
}

export type ProviderTuningMetadata = {
  controls: ProviderTuningControl[]
  presets: ProviderTuningPreset[]
  defaultValues: VoiceTuningValues
}

export type ProvidersResponse = {
  defaultProviderId: string
  providers: VoiceProvider[]
}

export type VoiceAsset = {
  id: string
  name: string
  filePath: string
  contentType: string
  sha256: string
  source: "default" | "upload"
  createdAt: string
}

export type VoicesResponse = {
  defaultVoiceId: string
  voices: VoiceAsset[]
}

export type SubscriptionResponse = {
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

export type ModelOption = {
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

export type ModelsResponse = {
  available: boolean
  error: string | null
  defaultModelId: string
  models: ModelOption[]
}

export type GeneratedResult = {
  id: string
  url: string
  sizeBytes: number
  contentType: string
  cacheState: string
  voiceId: string
  appVoiceId: string
  voiceName: string
  modelId: string
  characterCount: number | null
  requestId: string | null
  createdAt: string
  generatedAt: string
}

export type ConfirmationState = {
  body: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
  title: string
}

export type VoiceTuningValues = Partial<Record<string, ProviderTuningValue>>

export type RenameSubmitHandler = (event: FormEvent<HTMLFormElement>) => void
