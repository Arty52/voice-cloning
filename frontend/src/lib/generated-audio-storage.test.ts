import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES,
  GENERATED_AUDIO_DB_NAME,
  GENERATED_AUDIO_STORAGE_LIMIT_KEY,
  GeneratedAudioStorageQuotaError,
  clearGeneratedAudio,
  deleteGeneratedAudio,
  getGeneratedAudioStorageLimitBytes,
  getGeneratedAudioUsage,
  listGeneratedAudio,
  pruneGeneratedAudioToLimit,
  saveGeneratedAudio,
  setGeneratedAudioStorageLimitBytes,
  updateGeneratedAudioStorageLimitBytes,
  type SaveGeneratedAudioInput,
} from "./generated-audio-storage"
import type { GeneratedAudioTuningMetadata } from "@/types"

const tuningMetadata: GeneratedAudioTuningMetadata = {
  adjustedSettings: [
    {
      id: "style",
      label: "Style",
      nominalValue: 0,
      nominalValueLabel: "0",
      value: 0.35,
      valueLabel: "0.35",
    },
  ],
  mode: "preset",
  presetId: "animated",
  presetLabel: "Animated Dialogue",
  providerId: "elevenlabs",
  providerLabel: "ElevenLabs",
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    request.onblocked = () => reject(new Error(`Unable to delete ${name}; database is blocked.`))
  })
}

function audioBlob(sizeBytes: number) {
  return new Blob([new Uint8Array(sizeBytes)], { type: "audio/mpeg" })
}

function audioInput(overrides: Partial<SaveGeneratedAudioInput> = {}): SaveGeneratedAudioInput {
  return {
    appVoiceId: "default",
    blob: audioBlob(4),
    cacheState: "miss",
    characterCount: 54,
    modelId: "eleven_multilingual_v2",
    requestId: "req_test_123",
    voiceId: "voice-123",
    voiceName: "Default voice",
    ...overrides,
  }
}

describe("generated audio storage", () => {
  beforeEach(async () => {
    await deleteDatabase(GENERATED_AUDIO_DB_NAME)
    localStorage.clear()
  })

  it("uses the default cap until a custom cap is stored", () => {
    expect(getGeneratedAudioStorageLimitBytes()).toBe(DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES)

    setGeneratedAudioStorageLimitBytes(12)

    expect(localStorage.getItem(GENERATED_AUDIO_STORAGE_LIMIT_KEY)).toBe("12")
    expect(getGeneratedAudioStorageLimitBytes()).toBe(12)
  })

  it("normalizes sub-byte caps back to the default cap", () => {
    setGeneratedAudioStorageLimitBytes(0.5)

    expect(localStorage.getItem(GENERATED_AUDIO_STORAGE_LIMIT_KEY)).toBe(String(DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES))
    expect(getGeneratedAudioStorageLimitBytes()).toBe(DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES)
  })

  it("saves generated audio and lists newest first", async () => {
    await saveGeneratedAudio(audioInput({ createdAt: "2026-05-28T10:00:00.000Z", id: "first" }), 20)
    await saveGeneratedAudio(
      audioInput({ createdAt: "2026-05-28T10:01:00.000Z", id: "second", tuningMetadata }),
      20
    )

    const records = await listGeneratedAudio()

    expect(records.map((record) => record.id)).toEqual(["second", "first"])
    expect(records[0]).toMatchObject({
      appVoiceId: "default",
      cacheState: "miss",
      characterCount: 54,
      contentType: "audio/mpeg",
      modelId: "eleven_multilingual_v2",
      requestId: "req_test_123",
      sizeBytes: 4,
      tuningMetadata,
      voiceId: "voice-123",
      voiceName: "Default voice",
    })
    expect(await getGeneratedAudioUsage(20)).toEqual({
      itemCount: 2,
      limitBytes: 20,
      remainingBytes: 12,
      usedBytes: 8,
    })
  })

  it("stores null tuning metadata when no metadata is supplied", async () => {
    await saveGeneratedAudio(audioInput({ id: "without-metadata" }), 20)

    expect((await listGeneratedAudio())[0].tuningMetadata).toBeNull()
  })

  it("deletes one record and clears all records", async () => {
    await saveGeneratedAudio(audioInput({ id: "first" }), 20)
    await saveGeneratedAudio(audioInput({ id: "second" }), 20)

    await deleteGeneratedAudio("first")

    expect((await listGeneratedAudio()).map((record) => record.id)).toEqual(["second"])

    await clearGeneratedAudio()

    expect(await listGeneratedAudio()).toEqual([])
  })

  it("rejects generated audio larger than the active cap", async () => {
    await expect(saveGeneratedAudio(audioInput({ blob: audioBlob(11), id: "too-large" }), 10)).rejects.toBeInstanceOf(
      GeneratedAudioStorageQuotaError
    )
    expect(await listGeneratedAudio()).toEqual([])
  })

  it("prunes oldest audio after saving when usage exceeds the cap", async () => {
    await saveGeneratedAudio(audioInput({ blob: audioBlob(6), createdAt: "2026-05-28T10:00:00.000Z", id: "oldest" }), 20)
    await saveGeneratedAudio(audioInput({ blob: audioBlob(4), createdAt: "2026-05-28T10:01:00.000Z", id: "middle" }), 20)

    const result = await saveGeneratedAudio(
      audioInput({ blob: audioBlob(5), createdAt: "2026-05-28T10:02:00.000Z", id: "newest" }),
      10
    )

    expect(result.prunedIds).toEqual(["oldest"])
    expect((await listGeneratedAudio()).map((record) => record.id)).toEqual(["newest", "middle"])
    expect(await getGeneratedAudioUsage(10)).toMatchObject({ itemCount: 2, usedBytes: 9 })
  })

  it("can prune oldest audio to an updated cap", async () => {
    await saveGeneratedAudio(audioInput({ blob: audioBlob(4), createdAt: "2026-05-28T10:00:00.000Z", id: "first" }), 20)
    await saveGeneratedAudio(audioInput({ blob: audioBlob(4), createdAt: "2026-05-28T10:01:00.000Z", id: "second" }), 20)
    await saveGeneratedAudio(audioInput({ blob: audioBlob(4), createdAt: "2026-05-28T10:02:00.000Z", id: "third" }), 20)

    const prunedIds = await pruneGeneratedAudioToLimit(8)

    expect(prunedIds).toEqual(["first"])
    expect((await listGeneratedAudio()).map((record) => record.id)).toEqual(["third", "second"])
  })

  it("updates the stored cap and optionally prunes", async () => {
    await saveGeneratedAudio(audioInput({ blob: audioBlob(6), createdAt: "2026-05-28T10:00:00.000Z", id: "first" }), 20)
    await saveGeneratedAudio(audioInput({ blob: audioBlob(6), createdAt: "2026-05-28T10:01:00.000Z", id: "second" }), 20)

    const unchanged = await updateGeneratedAudioStorageLimitBytes(10, { prune: false })

    expect(unchanged.prunedIds).toEqual([])
    expect(unchanged.usage).toMatchObject({ limitBytes: 10, usedBytes: 12 })

    const pruned = await updateGeneratedAudioStorageLimitBytes(10)

    expect(pruned.prunedIds).toEqual(["first"])
    expect(pruned.usage).toMatchObject({ itemCount: 1, limitBytes: 10, usedBytes: 6 })
    expect(getGeneratedAudioStorageLimitBytes()).toBe(10)
  })
})
