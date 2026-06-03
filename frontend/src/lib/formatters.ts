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

export function formatRecordingDuration(durationSeconds: number) {
  const seconds = Math.max(0, Math.floor(durationSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

export function formatGenerationElapsedTime(elapsedMs: number) {
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
