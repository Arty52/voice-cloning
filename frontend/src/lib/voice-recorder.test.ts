import { describe, expect, it } from "vitest"

import { RECORDED_VOICE_MIME_TYPE, createWavFile, encodeWav } from "./voice-recorder"

describe("voice recorder", () => {
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
})

function readAscii(view: DataView, offset: number, length: number) {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)))
}
