import { normalizeGeneratedAudioStorageLimitBytes } from "@/lib/generated-audio-storage"

export type AppSettings = {
  generatedAudioStorageLimit?: {
    limitBytes: number
  }
  naturalHandoffs: {
    enabled: boolean
  }
  selectedModelByProvider: Record<string, string>
}

export type AppSettingsResponse = {
  available: boolean
  settings: AppSettings
}

export type AppSettingsUpdate = Partial<{
  generatedAudioStorageLimit: {
    limitBytes: number
  }
  naturalHandoffs: {
    enabled: boolean
  }
  selectedModelByProvider: Record<string, string>
}>

export class AppSettingsUnavailableError extends Error {
  constructor(message = "App settings persistence is not configured.") {
    super(message)
    this.name = "AppSettingsUnavailableError"
  }
}

export async function loadAppSettings(): Promise<AppSettingsResponse> {
  const response = await fetch("/api/settings")
  if (response.status === 503 || response.status === 404) {
    throw new AppSettingsUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as unknown
  if (!isSettingsResponsePayload(payload)) {
    throw new AppSettingsUnavailableError("App settings response was incomplete.")
  }
  return {
    available: Boolean(payload.available),
    settings: normalizeAppSettings(payload.settings),
  }
}

export async function saveAppSettings(settings: AppSettingsUpdate): Promise<AppSettingsResponse> {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  })
  if (response.status === 503 || response.status === 404) {
    throw new AppSettingsUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as unknown
  if (!isSettingsResponsePayload(payload)) {
    throw new AppSettingsUnavailableError("App settings response was incomplete.")
  }
  return {
    available: Boolean(payload.available),
    settings: normalizeAppSettings(payload.settings),
  }
}

export function isAppSettingsUnavailableError(value: unknown) {
  return value instanceof AppSettingsUnavailableError || (value instanceof Error && value.name === "AppSettingsUnavailableError")
}

function normalizeAppSettings(settings: unknown): AppSettings {
  const record = isRecord(settings) ? settings : {}
  return {
    generatedAudioStorageLimit: normalizeGeneratedAudioStorageLimit(record.generatedAudioStorageLimit),
    naturalHandoffs: normalizeNaturalHandoffs(record.naturalHandoffs),
    selectedModelByProvider: normalizeSelectedModelByProvider(record.selectedModelByProvider),
  }
}

function normalizeGeneratedAudioStorageLimit(value: unknown) {
  if (!isRecord(value)) {
    return undefined
  }
  return {
    limitBytes: normalizeGeneratedAudioStorageLimitBytes(Number(value.limitBytes)),
  }
}

function normalizeNaturalHandoffs(value: unknown) {
  if (!isRecord(value) || typeof value.enabled !== "boolean") {
    return { enabled: true }
  }
  return { enabled: value.enabled }
}

function normalizeSelectedModelByProvider(value: unknown) {
  if (!isRecord(value)) {
    return {}
  }
  const selectedModelByProvider: Record<string, string> = {}
  for (const [providerId, modelId] of Object.entries(value)) {
    if (providerId && typeof modelId === "string" && modelId.trim()) {
      selectedModelByProvider[providerId] = modelId.trim()
    }
  }
  return selectedModelByProvider
}

function isSettingsResponsePayload(value: unknown): value is { available: unknown; settings: unknown } {
  return isRecord(value) && isRecord(value.settings)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function readError(response: Response) {
  const fallback = `Request failed with status ${response.status}.`
  let body = ""
  try {
    body = await response.text()
  } catch {
    return fallback
  }
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json") && body) {
    let payload: unknown
    try {
      payload = JSON.parse(body) as unknown
    } catch {
      return body || fallback
    }
    if (isRecord(payload) && payload.detail !== undefined) {
      if (typeof payload.detail === "string") {
        return payload.detail
      }
      return JSON.stringify(payload.detail)
    }
  }
  return body || fallback
}
