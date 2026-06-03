import { createWavFile } from "@/lib/voice-recorder"

export const DEFAULT_VOICE_SAMPLE_RATE = 32000

export type AudioWindow = {
  durationSeconds: number
  startSeconds: number
}

type WindowedAudioFileOptions = {
  file: File
  sampleRate?: number
  window: AudioWindow
}

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

export function clampAudioWindow(
  durationSeconds: number,
  maxWindowSeconds: number,
  startSeconds = 0,
  requestedDurationSeconds = maxWindowSeconds
): AudioWindow {
  const resolvedDuration = Math.max(0, durationSeconds)
  if (resolvedDuration === 0) {
    return { startSeconds: 0, durationSeconds: 0 }
  }

  const resolvedMaxWindow = Math.max(0, maxWindowSeconds)
  const maxDuration = resolvedMaxWindow > 0 ? Math.min(resolvedDuration, resolvedMaxWindow) : resolvedDuration
  const requestedDuration = Math.max(0, Math.min(requestedDurationSeconds, maxDuration))
  const windowDuration = requestedDuration > 0 ? requestedDuration : maxDuration
  const maxStart = Math.max(0, resolvedDuration - windowDuration)
  const windowStart = Math.min(Math.max(startSeconds, 0), maxStart)

  return {
    durationSeconds: windowDuration,
    startSeconds: windowStart,
  }
}

export function audioWindowEndSeconds(window: AudioWindow) {
  return window.startSeconds + window.durationSeconds
}

export function normalizeAudioWindowRange(
  range: number[],
  durationSeconds: number,
  maxWindowSeconds: number
): AudioWindow {
  const start = Math.min(range[0] ?? 0, range[1] ?? 0)
  const end = Math.max(range[0] ?? 0, range[1] ?? 0)
  return clampAudioWindow(durationSeconds, maxWindowSeconds, start, end - start)
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const AudioContextConstructor = window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext
  if (!AudioContextConstructor) {
    throw new Error("Audio decoding is not supported in this browser.")
  }

  const audioContext = new AudioContextConstructor()
  try {
    return await audioContext.decodeAudioData(await file.arrayBuffer())
  } catch (caught) {
    throw new Error("Unable to decode this audio file. Try a browser-supported audio file.", { cause: caught })
  } finally {
    if (audioContext.state !== "closed") {
      await audioContext.close()
    }
  }
}

export async function createWindowedAudioFile({
  file,
  sampleRate = DEFAULT_VOICE_SAMPLE_RATE,
  window,
}: WindowedAudioFileOptions): Promise<File> {
  const audioBuffer = await decodeAudioFile(file)
  const samples = extractMonoWindow(audioBuffer, window, sampleRate)
  if (samples.length === 0) {
    throw new Error("Select a longer audio window before saving this voice.")
  }
  return createWavFile(samples, sampleRate, windowedAudioFilename(file.name))
}

export function extractMonoWindow(audioBuffer: AudioBuffer, window: AudioWindow, sampleRate = DEFAULT_VOICE_SAMPLE_RATE) {
  const sourceSampleRate = audioBuffer.sampleRate
  const sourceChannelCount = audioBuffer.numberOfChannels
  const startFrame = Math.floor(window.startSeconds * sourceSampleRate)
  const sourceFrameCount = Math.max(0, Math.floor(window.durationSeconds * sourceSampleRate))
  const targetSampleCount = Math.max(0, Math.floor((sourceFrameCount / sourceSampleRate) * sampleRate))
  const samples = new Float32Array(targetSampleCount)

  if (sourceChannelCount === 0 || sourceSampleRate <= 0 || sampleRate <= 0) {
    return samples
  }

  const channels = Array.from({ length: sourceChannelCount }, (_, index) => audioBuffer.getChannelData(index))
  const sourceToTargetRatio = sourceSampleRate / sampleRate
  for (let targetIndex = 0; targetIndex < targetSampleCount; targetIndex += 1) {
    const sourcePosition = startFrame + targetIndex * sourceToTargetRatio
    const sourceIndex = Math.floor(sourcePosition)
    const sourceOffset = sourcePosition - sourceIndex
    let mixedSample = 0
    for (const channel of channels) {
      const current = channel[sourceIndex] ?? 0
      const next = channel[Math.min(sourceIndex + 1, channel.length - 1)] ?? current
      mixedSample += current + (next - current) * sourceOffset
    }
    samples[targetIndex] = mixedSample / sourceChannelCount
  }

  return samples
}

function windowedAudioFilename(filename: string) {
  const stem = filename.replace(/\.[^.]*$/, "").trim() || "voice-sample"
  return `${stem}-window.wav`
}
