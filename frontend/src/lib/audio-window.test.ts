import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_VOICE_SAMPLE_RATE,
  clampAudioWindow,
  createWindowedAudioFile,
  extractMonoWindow,
  normalizeAudioWindowRange,
} from "./audio-window"

describe("audio window utilities", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("clamps long audio to the provider maximum window", () => {
    expect(clampAudioWindow(180, 120)).toEqual({ startSeconds: 0, durationSeconds: 120 })
    expect(clampAudioWindow(180, 120, 100, 120)).toEqual({ startSeconds: 60, durationSeconds: 120 })
    expect(normalizeAudioWindowRange([20, 170], 180, 120)).toEqual({ startSeconds: 20, durationSeconds: 120 })
  })

  it("keeps short audio at full duration", () => {
    expect(clampAudioWindow(45, 120)).toEqual({ startSeconds: 0, durationSeconds: 45 })
  })

  it("extracts a mono resampled window", () => {
    const left = new Float32Array([0, 0.5, 1, 0.5])
    const right = new Float32Array([1, 0.5, 0, 0.5])
    const audioBuffer = {
      getChannelData: (channel: number) => (channel === 0 ? left : right),
      numberOfChannels: 2,
      sampleRate: 4,
    } as AudioBuffer

    const samples = extractMonoWindow(audioBuffer, { startSeconds: 0, durationSeconds: 1 }, 4)

    expect(Array.from(samples)).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it("creates a 16 kHz wav excerpt from a decoded source file", async () => {
    const channelData = new Float32Array([0, 0.25, 0.5, 0.75])
    class FakeAudioContext {
      state = "running"

      close = vi.fn(async () => {
        this.state = "closed"
      })

      decodeAudioData = vi.fn(async () => ({
        duration: 1,
        getChannelData: () => channelData,
        numberOfChannels: 1,
        sampleRate: 4,
      }))
    }
    vi.stubGlobal("AudioContext", FakeAudioContext)

    const file = await createWindowedAudioFile({
      file: new File(["source"], "source.mp3", { type: "audio/mpeg" }),
      window: { startSeconds: 0, durationSeconds: 1 },
    })

    expect(file.name).toBe("source-window.wav")
    expect(file.type).toBe("audio/wav")
    expect(file.size).toBe(44 + DEFAULT_VOICE_SAMPLE_RATE * 2)
  })
})
