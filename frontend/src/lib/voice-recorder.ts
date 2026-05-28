export const MAX_VOICE_RECORDING_SECONDS = 90
export const MAX_RECORDED_VOICE_UPLOAD_BYTES = 10 * 1024 * 1024
export const RECORDED_VOICE_MIME_TYPE = "audio/wav"

const WAV_HEADER_BYTES = 44
const WAV_BYTES_PER_SAMPLE = 2

export type VoiceRecording = {
  durationSeconds: number
  file: File
}

export type VoiceRecorderSession = {
  discard: () => Promise<void>
  getElapsedSeconds: () => number
  maxDurationSeconds: number
  stop: () => Promise<VoiceRecording>
}

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

export async function startVoiceRecorder(): Promise<VoiceRecorderSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone recording is not supported in this browser. Use Sample File upload instead.")
  }

  const AudioContextConstructor = window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext
  if (!AudioContextConstructor) {
    throw new Error("Microphone recording is not supported in this browser. Use Sample File upload instead.")
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const audioContext = new AudioContextConstructor()
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  const startedAt = performance.now()
  const maxSampleCount = getMaxRecordedSampleCount()
  const maxDurationSeconds = Math.min(MAX_VOICE_RECORDING_SECONDS, maxSampleCount / audioContext.sampleRate)
  let sampleCount = 0
  let stopPromise: Promise<VoiceRecording> | null = null

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
    sampleCount += input.length
  }

  source.connect(processor)
  processor.connect(audioContext.destination)

  async function cleanup() {
    processor.onaudioprocess = null
    processor.disconnect()
    source.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    if (audioContext.state !== "closed") {
      await audioContext.close()
    }
  }

  return {
    async discard() {
      await cleanup()
    },
    getElapsedSeconds() {
      return Math.max(0, (performance.now() - startedAt) / 1000)
    },
    maxDurationSeconds,
    stop() {
      stopPromise ??= (async () => {
        const sampleRate = audioContext.sampleRate
        const samples = mergeAudioChunks(chunks, sampleCount)
        await cleanup()
        if (samples.length === 0) {
          throw new Error("Recording did not capture audio. Try again and let the recorder run for a moment.")
        }
        if (samples.length > maxSampleCount) {
          throw new Error("Recording is too large to save. Try a shorter take.")
        }
        const durationSeconds = sampleRate > 0 ? samples.length / sampleRate : 0
        const file = createWavFile(samples, sampleRate, `recorded-voice-${Date.now()}.wav`)
        return { durationSeconds, file }
      })()
      return stopPromise
    },
  }
}

export function createWavFile(samples: Float32Array, sampleRate: number, filename: string): File {
  return new File([encodeWav(samples, sampleRate)], filename, {
    lastModified: Date.now(),
    type: RECORDED_VOICE_MIME_TYPE,
  })
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const channelCount = 1
  const dataByteLength = samples.length * WAV_BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataByteLength)
  const view = new DataView(buffer)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataByteLength, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * WAV_BYTES_PER_SAMPLE, true)
  view.setUint16(32, channelCount * WAV_BYTES_PER_SAMPLE, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataByteLength, true)

  let offset = WAV_HEADER_BYTES
  for (const sample of samples) {
    const clampedSample = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7fff, true)
    offset += WAV_BYTES_PER_SAMPLE
  }

  return new Blob([view], { type: RECORDED_VOICE_MIME_TYPE })
}

function getMaxRecordedSampleCount() {
  return Math.floor((MAX_RECORDED_VOICE_UPLOAD_BYTES - WAV_HEADER_BYTES) / WAV_BYTES_PER_SAMPLE)
}

function mergeAudioChunks(chunks: Float32Array[], sampleCount: number) {
  const samples = new Float32Array(sampleCount)
  let offset = 0
  for (const chunk of chunks) {
    samples.set(chunk, offset)
    offset += chunk.length
  }
  return samples
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}
