import type { UserTuningPreset, VoicePresetId, VoiceTuningValues } from "@/types"

export type UserTuningPresetInput = {
  id?: string | null
  name: string
  providerId: string
  voicePresetId?: VoicePresetId | null
  settings: VoiceTuningValues
}

export type UserTuningPresetListResponse = {
  available: boolean
  presets: UserTuningPreset[]
}

export class UserTuningPresetsUnavailableError extends Error {
  constructor(message = "Voice tuning preset persistence is not configured.") {
    super(message)
    this.name = "UserTuningPresetsUnavailableError"
  }
}

export async function listUserTuningPresets(): Promise<UserTuningPresetListResponse> {
  const response = await fetch("/api/voice-tuning-presets")
  if (response.status === 503 || response.status === 404) {
    throw new UserTuningPresetsUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as unknown
  if (!isUserTuningPresetListPayload(payload)) {
    throw new UserTuningPresetsUnavailableError("Voice tuning presets response was incomplete.")
  }
  return {
    available: Boolean(payload.available),
    presets: payload.presets.filter(isUserTuningPresetPayload).map(normalizeUserTuningPreset),
  }
}

export async function createUserTuningPreset(input: UserTuningPresetInput): Promise<UserTuningPreset> {
  const response = await fetch("/api/voice-tuning-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return presetFromMutationResponse(response)
}

export async function updateUserTuningPreset(id: string, input: UserTuningPresetInput): Promise<UserTuningPreset> {
  const response = await fetch(`/api/voice-tuning-presets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return presetFromMutationResponse(response)
}

export async function deleteUserTuningPreset(id: string): Promise<boolean> {
  const response = await fetch(`/api/voice-tuning-presets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  if (response.status === 503 || response.status === 404) {
    throw new UserTuningPresetsUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as unknown
  return isRecord(payload) ? Boolean(payload.deleted) : false
}

export function isUserTuningPresetsUnavailableError(value: unknown) {
  return (
    value instanceof UserTuningPresetsUnavailableError ||
    (value instanceof Error && value.name === "UserTuningPresetsUnavailableError")
  )
}

async function presetFromMutationResponse(response: Response) {
  if (response.status === 503 || response.status === 404) {
    throw new UserTuningPresetsUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const payload = (await response.json()) as unknown
  if (!isRecord(payload) || !isUserTuningPresetPayload(payload.preset)) {
    throw new Error("Voice tuning preset response was incomplete.")
  }
  return normalizeUserTuningPreset(payload.preset)
}

function isUserTuningPresetListPayload(value: unknown): value is { available: unknown; presets: unknown[] } {
  return isRecord(value) && Array.isArray(value.presets)
}

function isUserTuningPresetPayload(value: unknown): value is UserTuningPreset {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
}

function normalizeUserTuningPreset(preset: UserTuningPreset): UserTuningPreset {
  return {
    id: String(preset.id),
    name: String(preset.name),
    providerId: String(preset.providerId || ""),
    settings: isRecord(preset.settings) ? { ...preset.settings } : {},
    createdAt: String(preset.createdAt || ""),
    updatedAt: String(preset.updatedAt || ""),
    voicePresetId:
      preset.voicePresetId === "standardNarration" || preset.voicePresetId === "animatedDialogue"
        ? preset.voicePresetId
        : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function readError(response: Response) {
  const fallback = `Request failed with status ${response.status}.`
  let body: string
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
      return typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail)
    }
  }
  return body || fallback
}
