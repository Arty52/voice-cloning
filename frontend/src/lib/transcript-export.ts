import type { SpeakerSeparationResult, SpeakerTranscriptItem } from "@/types"

export type TranscriptExportFormat = "markdown" | "text"

export type TranscriptExportOptions = {
  format: TranscriptExportFormat
  includeStartTimes?: boolean
  result: SpeakerSeparationResult
  sourceName: string
  speakerNames?: Record<string, string>
}

export function formatTranscript({
  format,
  includeStartTimes = false,
  result,
  sourceName,
  speakerNames = {},
}: TranscriptExportOptions) {
  const title = `${transcriptSourceName(sourceName)} Transcript`
  const speakerNamesById = new Map(
    result.speakers.map((speaker, index) => [
      speaker.id,
      speakerNames[speaker.id]?.trim() ||
        speaker.assignedName?.trim() ||
        speaker.label.trim() ||
        `Speaker ${index + 1}`,
    ])
  )
  const dialogueLines = chronologicalTranscriptItems(result.transcript.items).map((item) => {
    const timestamp = includeStartTimes ? `[${formatTranscriptTimestamp(item.startSeconds)}] ` : ""
    const speakerName = speakerNamesById.get(item.speakerId) ?? "Speaker"
    if (format === "markdown") {
      return `${timestamp}**${escapeMarkdownStrong(speakerName)}:** ${item.text}`
    }
    return `${timestamp}${speakerName}: ${item.text}`
  })
  const heading = format === "markdown" ? `# ${title}` : title
  return `${[heading, "", ...dialogueLines].join("\n")}\n`
}

export function formatTranscriptTimestamp(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const remainingSeconds = wholeSeconds % 60
  return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":")
}

export function transcriptExportFilename(sourceName: string, format: TranscriptExportFormat) {
  const sanitizedSource = transcriptSourceName(sourceName)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "audio"
  return `${sanitizedSource}-transcript.${format === "markdown" ? "md" : "txt"}`
}

export function downloadTranscript(options: TranscriptExportOptions) {
  const content = formatTranscript(options)
  const filename = transcriptExportFilename(options.sourceName, options.format)
  const contentType = options.format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8"
  const url = URL.createObjectURL(new Blob([content], { type: contentType }))
  const anchor = document.createElement("a")
  anchor.download = filename
  anchor.href = url
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return filename
}

function chronologicalTranscriptItems(items: SpeakerTranscriptItem[]) {
  return items
    .map((item, index) => ({ index, item }))
    .sort(
      (left, right) =>
        left.item.startSeconds - right.item.startSeconds ||
        left.item.endSeconds - right.item.endSeconds ||
        left.index - right.index
    )
    .map(({ item }) => item)
}

function transcriptSourceName(sourceName: string) {
  const trimmed = sourceName.trim().replace(/\.[^/.]+$/, "").trim()
  return trimmed || "Audio"
}

function escapeMarkdownStrong(value: string) {
  return value.replace(/([\\*_])/g, "\\$1")
}
