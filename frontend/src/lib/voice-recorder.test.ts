import { afterEach, describe, expect, it, vi } from "vitest"

import { RECORDED_VOICE_MIME_TYPE, createWavFile, encodeWav, startVoiceRecorder } from "./voice-recorder"

describe("voice recorder", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("encodes mono PCM samples as a WAV blob", async () => {
    const blob = encodeWav(new Float32Array([-1, 0, 1]), 48000)
    const view = new DataView(await blob.arrayBuffer())

    expect(blob.type).toBe(RECORDED_VOICE_MIME_TYPE)
    expect(readAscii(view, 0, 4)).toBe("RIFF")
    expect(readAscii(view, 8, 4)).toBe("WAVE")
    expect(readAscii(view, 36, 4)).toBe("data")
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(46, true)).toBe(0)
    expect(view.getInt16(48, true)).toBe(32767)
  })

  it("creates a named wav file for upload", () => {
    const file = createWavFile(new Float32Array([0]), 44100, "recorded.wav")

    expect(file.name).toBe("recorded.wav")
    expect(file.type).toBe(RECORDED_VOICE_MIME_TYPE)
    expect(file.size).toBe(46)
  })

  it("caps session duration by sample rate and rejects empty captures", async () => {
    const stopTrack = vi.fn()
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }
    class FakeAudioContext {
      destination = {}
      sampleRate = 96000
      state = "running"

      close = vi.fn(async () => {
        this.state = "closed"
      })

      createMediaStreamSource = vi.fn(() => source)
      createScriptProcessor = vi.fn(() => processor)
    }
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } })
    vi.stubGlobal("AudioContext", FakeAudioContext)

    const session = await startVoiceRecorder()

    expect(session.maxDurationSeconds).toBeLessThan(90)
    await expect(session.stop()).rejects.toThrow(/did not capture audio/i)
    expect(stopTrack).toHaveBeenCalled()
  })
})

function readAscii(view: DataView, offset: number, length: number) {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)))
}
