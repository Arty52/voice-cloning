export type GeneratedAudioServerExportItemStatus = "exported" | "failed"

export type GeneratedAudioServerExportItem = {
  targetId: string
  audioId: string
  sha256: string
  filename: string
  status: GeneratedAudioServerExportItemStatus
  exportedAt: string | null
  lastError: string | null
  updatedAt: string | null
}

export type GeneratedAudioServerExportStatus = {
  available: boolean
  targetId: string | null
  items: GeneratedAudioServerExportItem[]
}

export type GeneratedAudioServerExportResult = {
  alreadyExported: boolean
  item: GeneratedAudioServerExportItem
}

export type GeneratedAudioServerExportAllResult = {
  exportedCount: number
  failedCount: number
  items: GeneratedAudioServerExportItem[]
}

export class GeneratedAudioServerExportUnavailableError extends Error {
  constructor(message = "Generated audio export directory is not configured.") {
    super(message)
    this.name = "GeneratedAudioServerExportUnavailableError"
  }
}

export async function loadGeneratedAudioServerExportStatus(): Promise<GeneratedAudioServerExportStatus> {
  const response = await fetch("/api/generated-audio/export-status")
  if (response.status === 503 || response.status === 404) {
    throw new GeneratedAudioServerExportUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return normalizeExportStatus(await readJsonObject(response, "Unexpected generated audio export status response."))
}

export async function exportGeneratedAudioToServer(audioId: string): Promise<GeneratedAudioServerExportResult> {
  const response = await fetch(`/api/generated-audio/${encodeURIComponent(audioId)}/export`, { method: "POST" })
  if (response.status === 503) {
    throw new GeneratedAudioServerExportUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return normalizeExportResult(await readJsonObject(response, "Unexpected generated audio export response."))
}

export async function exportAllGeneratedAudioToServer(): Promise<GeneratedAudioServerExportAllResult> {
  const response = await fetch("/api/generated-audio/export-all", { method: "POST" })
  if (response.status === 503) {
    throw new GeneratedAudioServerExportUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return normalizeExportAllResult(await readJsonObject(response, "Unexpected generated audio export-all response."))
}

function normalizeExportStatus(status: Record<string, unknown>): GeneratedAudioServerExportStatus {
  const items = Array.isArray(status.items) ? status.items.filter(isRecord).map(normalizeExportItem) : []
  return {
    available: Boolean(status.available),
    targetId: typeof status.targetId === "string" ? status.targetId : null,
    items,
  }
}

function normalizeExportResult(result: Record<string, unknown>): GeneratedAudioServerExportResult {
  if (!isRecord(result.item)) {
    throw new Error("Unexpected generated audio export response.")
  }
  return {
    alreadyExported: Boolean(result.alreadyExported),
    item: normalizeExportItem(result.item),
  }
}

function normalizeExportAllResult(result: Record<string, unknown>): GeneratedAudioServerExportAllResult {
  const items = Array.isArray(result.items) ? result.items.filter(isRecord).map(normalizeExportItem) : []
  return {
    exportedCount: Math.max(0, Number.isFinite(result.exportedCount) ? Math.floor(result.exportedCount) : 0),
    failedCount: Math.max(0, Number.isFinite(result.failedCount) ? Math.floor(result.failedCount) : 0),
    items,
  }
}

function normalizeExportItem(item: Record<string, unknown>): GeneratedAudioServerExportItem {
  return {
    targetId: optionalString(item.targetId) || "local-filesystem",
    audioId: optionalString(item.audioId) || "",
    sha256: optionalString(item.sha256) || "",
    filename: optionalString(item.filename) || "",
    status: item.status === "exported" ? "exported" : "failed",
    exportedAt: nullableString(item.exportedAt),
    lastError: nullableString(item.lastError),
    updatedAt: nullableString(item.updatedAt),
  }
}

async function readJsonObject(response: Response, errorMessage: string): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as unknown
  if (!isRecord(payload)) {
    throw new Error(errorMessage)
  }
  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : optionalString(value)
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
    try {
      const payload = JSON.parse(body) as { detail?: unknown }
      if (typeof payload.detail === "string") {
        return payload.detail
      }
      if (payload.detail !== undefined) {
        return JSON.stringify(payload.detail)
      }
    } catch {
      return body || fallback
    }
  }
  return body || fallback
}
