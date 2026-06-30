import { BYTES_PER_MEBIBYTE } from "@/lib/generated-audio-storage"

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function formatBytes(value: number) {
  if (value < BYTES_PER_MEBIBYTE) {
    return `${formatNumber(value)} B`
  }
  const mebibytes = value / BYTES_PER_MEBIBYTE
  return `${Number.isInteger(mebibytes) ? formatNumber(mebibytes) : mebibytes.toFixed(1)} MB`
}

export function formatCompactBytes(value: number) {
  const normalizedBytes = normalizeByteCount(value)
  if (normalizedBytes < 1024) {
    return `${formatNumber(normalizedBytes)} B`
  }
  if (normalizedBytes < BYTES_PER_MEBIBYTE) {
    return `${formatNumber(Math.round(normalizedBytes / 1024))} KB`
  }
  const mebibytes = normalizedBytes / BYTES_PER_MEBIBYTE
  return `${Number.isInteger(mebibytes) ? formatNumber(mebibytes) : mebibytes.toFixed(1)} MB`
}

export function formatExactBytes(value: number) {
  const normalizedBytes = normalizeByteCount(value)
  return `${formatNumber(normalizedBytes)} ${normalizedBytes === 1 ? "byte" : "bytes"}`
}

export function formatRecordingDuration(durationSeconds: number) {
  const seconds = Math.max(0, Math.floor(durationSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

export function formatMediaDuration(durationSeconds: number) {
  const seconds = Number.isFinite(durationSeconds) ? Math.max(0, Math.floor(durationSeconds)) : 0
  if (seconds === 0) {
    return "0s"
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`)
  }
  if (remainingSeconds > 0) {
    parts.push(`${remainingSeconds}s`)
  }

  return parts.join(" ")
}

export function formatElapsedTime(elapsedMs: number) {
  if (!Number.isFinite(elapsedMs)) {
    return "unknown time"
  }
  const normalizedMs = Math.max(0, Math.round(elapsedMs))
  if (normalizedMs === 0) {
    return "0s"
  }
  if (normalizedMs < 100) {
    return "< 0.1s"
  }
  if (normalizedMs < 10_000) {
    const tenths = Math.round(normalizedMs / 100) / 10
    if (Number.isInteger(tenths) || tenths >= 10) {
      return `${Math.round(tenths)}s`
    }
    return `${tenths.toFixed(1)}s`
  }
  const roundedSeconds = Math.round(normalizedMs / 1000)
  if (roundedSeconds < 60) {
    return `${roundedSeconds}s`
  }
  const minutes = Math.floor(roundedSeconds / 60)
  const remainingSeconds = roundedSeconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

export function formatGenerationElapsedTime(elapsedMs: number) {
  return formatElapsedTime(elapsedMs)
}

export function formatGeneratedAudioTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "unknown time"
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function formatGeneratedAudioCountBadge(savedItemCount: number, temporaryItemCount: number) {
  const parts: string[] = []
  if (savedItemCount > 0) {
    parts.push(savedItemCount === 1 ? "1 saved" : `${savedItemCount} saved`)
  }
  if (temporaryItemCount > 0) {
    parts.push(temporaryItemCount === 1 ? "1 unsaved" : `${temporaryItemCount} unsaved`)
  }
  return parts.join(", ")
}

function normalizeByteCount(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.round(value))
}
