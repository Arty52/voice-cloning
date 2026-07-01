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
  return normalizeExportStatus((await response.json()) as GeneratedAudioServerExportStatus)
}

export async function exportGeneratedAudioToServer(audioId: string): Promise<GeneratedAudioServerExportResult> {
  const response = await fetch(`/api/generated-audio/${encodeURIComponent(audioId)}/export`, { method: "POST" })
  if (response.status === 503) {
    throw new GeneratedAudioServerExportUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return normalizeExportResult((await response.json()) as GeneratedAudioServerExportResult)
}

export async function exportAllGeneratedAudioToServer(): Promise<GeneratedAudioServerExportAllResult> {
  const response = await fetch("/api/generated-audio/export-all", { method: "POST" })
  if (response.status === 503) {
    throw new GeneratedAudioServerExportUnavailableError(await readError(response))
  }
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return normalizeExportAllResult((await response.json()) as GeneratedAudioServerExportAllResult)
}

function normalizeExportStatus(status: GeneratedAudioServerExportStatus): GeneratedAudioServerExportStatus {
  return {
    available: Boolean(status.available),
    targetId: typeof status.targetId === "string" ? status.targetId : null,
    items: Array.isArray(status.items) ? status.items.map(normalizeExportItem) : [],
  }
}

function normalizeExportResult(result: GeneratedAudioServerExportResult): GeneratedAudioServerExportResult {
  return {
    alreadyExported: Boolean(result.alreadyExported),
    item: normalizeExportItem(result.item),
  }
}

function normalizeExportAllResult(result: GeneratedAudioServerExportAllResult): GeneratedAudioServerExportAllResult {
  return {
    exportedCount: Math.max(0, Number.isFinite(result.exportedCount) ? Math.floor(result.exportedCount) : 0),
    failedCount: Math.max(0, Number.isFinite(result.failedCount) ? Math.floor(result.failedCount) : 0),
    items: Array.isArray(result.items) ? result.items.map(normalizeExportItem) : [],
  }
}

function normalizeExportItem(item: GeneratedAudioServerExportItem): GeneratedAudioServerExportItem {
  return {
    targetId: item.targetId || "local-filesystem",
    audioId: item.audioId,
    sha256: item.sha256,
    filename: item.filename || "",
    status: item.status === "exported" ? "exported" : "failed",
    exportedAt: item.exportedAt ?? null,
    lastError: item.lastError ?? null,
    updatedAt: item.updatedAt ?? null,
  }
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
