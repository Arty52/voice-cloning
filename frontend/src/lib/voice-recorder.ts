export const MAX_VOICE_RECORDING_SECONDS = 90
export const RECORDED_VOICE_MIME_TYPE = "audio/wav"

export type VoiceRecording = {
  durationSeconds: number
  file: File
}

export type VoiceRecorderSession = {
  discard: () => Promise<void>
  getElapsedSeconds: () => number
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
    stop() {
      stopPromise ??= (async () => {
        const sampleRate = audioContext.sampleRate
        const samples = mergeAudioChunks(chunks, sampleCount)
        await cleanup()
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
  const bytesPerSample = 2
  const channelCount = 1
  const dataByteLength = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataByteLength)
  const view = new DataView(buffer)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataByteLength, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true)
  view.setUint16(32, channelCount * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataByteLength, true)

  let offset = 44
  for (const sample of samples) {
    const clampedSample = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Blob([view], { type: RECORDED_VOICE_MIME_TYPE })
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
