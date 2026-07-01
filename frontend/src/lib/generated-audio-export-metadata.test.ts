import { describe, expect, it } from "vitest"

import {
  buildGeneratedAudioExportFilename,
  buildGeneratedAudioExportFilenameCandidates,
  buildGeneratedAudioExportRelativePath,
  buildGeneratedAudioExportSidecar,
} from "./generated-audio-export-metadata"

const item = {
  appVoiceId: "default",
  cacheState: "miss",
  characterCount: 12,
  contentType: "audio/mpeg",
  createdAt: "2026-07-01T11:45:22-07:00",
  generationElapsedMs: 1234,
  id: "../audio id",
  modelId: "Eleven Multilingual v2",
  multiVoiceMetadata: null,
  providerId: "elevenlabs",
  requestId: "req_123",
  sha256: "abcdef123456",
  sizeBytes: 123,
  tuningMetadata: null,
  voiceId: "provider-voice",
  voiceName: "../Default Voice!",
}

describe("generated audio export metadata", () => {
  it("builds path-safe deterministic export filenames", () => {
    expect(buildGeneratedAudioExportFilename(item)).toBe(
      "20260701T184522Z--default-voice--eleven-multilingual-v2--abcdef12.mp3"
    )
    expect(buildGeneratedAudioExportRelativePath(item)).toBe(
      "generated-audio/2026/07/20260701T184522Z--default-voice--eleven-multilingual-v2--abcdef12.mp3"
    )
    expect(buildGeneratedAudioExportFilenameCandidates(item).slice(0, 3)).toEqual([
      "20260701T184522Z--default-voice--eleven-multilingual-v2--abcdef12.mp3",
      "20260701T184522Z--default-voice--eleven-multilingual-v2--abcdef12--audio-id.mp3",
      "20260701T184522Z--default-voice--eleven-multilingual-v2--abcdef12--audio-id-2.mp3",
    ])
  })

  it("uses a path-safe id fallback when legacy records do not have sha256", () => {
    expect(buildGeneratedAudioExportFilename({ ...item, id: "../legacy/audio id", sha256: null })).toBe(
      "20260701T184522Z--default-voice--eleven-multilingual-v2--legacy-a.mp3"
    )
  })

  it("builds sidecar metadata without filesystem paths", () => {
    const sidecar = buildGeneratedAudioExportSidecar(item, "audio.mp3", "2026-07-01T18:45:23.000Z")

    expect(sidecar).toMatchObject({
      schemaVersion: 1,
      id: "../audio id",
      filename: "audio.mp3",
      sha256: "abcdef123456",
      providerId: "elevenlabs",
      modelId: "Eleven Multilingual v2",
    })
    expect(sidecar).not.toHaveProperty("filePath")
  })
})
