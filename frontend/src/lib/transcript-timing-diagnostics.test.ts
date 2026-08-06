import { beforeEach, describe, expect, it } from "vitest"

import {
  ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY,
  clearTranscriptTimingDiagnostics,
  readActiveTranscriptTimingDiagnostic,
  readTranscriptTimingDiagnostics,
  startTranscriptTimingDiagnostic,
  TRANSCRIPT_TIMING_DIAGNOSTIC_MAX_RECORDS,
  TRANSCRIPT_TIMING_DIAGNOSTIC_RETENTION_MS,
  TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY,
  updateActiveTranscriptTimingDiagnostic,
  updateTranscriptTimingDiagnostic,
} from "./transcript-timing-diagnostics"

const NOW = new Date("2026-08-06T12:00:00.000Z")

beforeEach(() => {
  localStorage.clear()
})

describe("transcript timing diagnostics", () => {
  it("stores only allowlisted local timing metadata", () => {
    const sourceFile = new File(["private audio bytes"], "Private Meeting Name.m4a", {
      type: "audio/mp4",
    })

    const record = startTranscriptTimingDiagnostic({
      createId: () => "timing-1",
      estimate: { minSeconds: 44, maxSeconds: 132 },
      now: NOW,
      sourceFile,
    })

    expect(record).toEqual({
      schemaVersion: 1,
      id: "timing-1",
      createdAt: NOW.toISOString(),
      completedAt: null,
      estimateMinSeconds: 44,
      estimateMaxSeconds: 132,
      actualElapsedMs: null,
      sourceSizeBytes: sourceFile.size,
      sourceMediaType: "audio/mp4",
      sourceExtension: "m4a",
      workflowStatus: "starting",
      estimateSettings: {
        cleanVoice: false,
        detectSpeakers: true,
        trimCandidates: false,
      },
    })
    const storedValue = localStorage.getItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY) ?? ""
    expect(storedValue).not.toContain(sourceFile.name)
    expect(storedValue).not.toContain("private audio bytes")
    expect(storedValue).not.toContain("filename")
    expect(storedValue).not.toContain("transcript")
    expect(localStorage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)).toBe("timing-1")
  })

  it("updates the active lifecycle and clears its pointer at a terminal status", () => {
    startTranscriptTimingDiagnostic({
      createId: () => "timing-1",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      now: NOW,
      sourceFile: new File(["audio"], "source.mp3", { type: "audio/mpeg" }),
    })

    expect(
      updateActiveTranscriptTimingDiagnostic(
        { workflowStatus: "processing" },
        localStorage,
        NOW.getTime() + 1_000
      )?.workflowStatus
    ).toBe("processing")
    const completed = updateActiveTranscriptTimingDiagnostic(
      { workflowStatus: "success", actualElapsedMs: 352_000 },
      localStorage,
      NOW.getTime() + 352_000
    )

    expect(completed).toMatchObject({
      completedAt: "2026-08-06T12:05:52.000Z",
      actualElapsedMs: 352_000,
      workflowStatus: "success",
    })
    expect(readActiveTranscriptTimingDiagnostic()).toBeNull()
    expect(localStorage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)).toBeNull()
  })

  it("persists explicitly supplied null terminal values instead of substituting defaults", () => {
    const started = startTranscriptTimingDiagnostic({
      createId: () => "timing-null-terminal-values",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      now: NOW,
      sourceFile: new File(["audio"], "source.mp3", { type: "audio/mpeg" }),
    })

    const completed = updateTranscriptTimingDiagnostic(
      started.id,
      { workflowStatus: "success", actualElapsedMs: null, completedAt: null },
      localStorage,
      NOW.getTime() + 1_000
    )

    expect(completed).toMatchObject({
      actualElapsedMs: null,
      completedAt: null,
      workflowStatus: "success",
    })
  })

  it("keeps concurrent lifecycle updates bound to the diagnostic that started them", () => {
    const first = startTranscriptTimingDiagnostic({
      createId: () => "timing-first",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      now: NOW,
      sourceFile: new File(["first"], "first.mp3", { type: "audio/mpeg" }),
    })
    const second = startTranscriptTimingDiagnostic({
      createId: () => "timing-second",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      now: new Date(NOW.getTime() + 1),
      sourceFile: new File(["second"], "second.mp3", { type: "audio/mpeg" }),
    })

    updateTranscriptTimingDiagnostic(
      first.id,
      { workflowStatus: "success", actualElapsedMs: 1_000 },
      localStorage,
      NOW.getTime() + 1_000
    )

    expect(readTranscriptTimingDiagnostics(localStorage, NOW.getTime() + 1_000)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          workflowStatus: "success",
          actualElapsedMs: 1_000,
        }),
        expect.objectContaining({
          id: second.id,
          workflowStatus: "starting",
          actualElapsedMs: null,
        }),
      ])
    )
    expect(localStorage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)).toBe(second.id)
  })

  it("does not throw when browser policy blocks the default localStorage lookup", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access denied", "SecurityError")
      },
    })

    try {
      expect(() =>
        startTranscriptTimingDiagnostic({
          createId: () => "timing-blocked-storage",
          estimate: { minSeconds: 40, maxSeconds: 115 },
          now: NOW,
          sourceFile: new File(["audio"], "source.mp3", { type: "audio/mpeg" }),
        })
      ).not.toThrow()
      expect(() => readTranscriptTimingDiagnostics()).not.toThrow()
      expect(() => readActiveTranscriptTimingDiagnostic()).not.toThrow()
      expect(() => updateActiveTranscriptTimingDiagnostic({ workflowStatus: "processing" })).not.toThrow()
      expect(() => clearTranscriptTimingDiagnostics()).not.toThrow()
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor)
      }
    }
  })

  it("rejects unversioned or unsafe records instead of exposing extra fields", () => {
    localStorage.setItem(
      TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify([
        { schemaVersion: 0, filename: "private.wav" },
        {
          schemaVersion: 1,
          id: "timing-unsafe",
          createdAt: NOW.toISOString(),
          completedAt: null,
          estimateMinSeconds: 40,
          estimateMaxSeconds: 115,
          actualElapsedMs: null,
          sourceSizeBytes: 1024,
          sourceMediaType: "text/plain",
          sourceExtension: "wav",
          workflowStatus: "processing",
          estimateSettings: { cleanVoice: false, detectSpeakers: true, trimCandidates: false },
          filename: "private.wav",
        },
      ])
    )

    expect(readTranscriptTimingDiagnostics()).toEqual([])
    expect(localStorage.getItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)).toBeNull()
  })

  it("keeps at most 50 recent records for 30 days", () => {
    for (let index = 0; index < TRANSCRIPT_TIMING_DIAGNOSTIC_MAX_RECORDS + 5; index += 1) {
      const createdAt = new Date(NOW.getTime() - index * 1_000)
      startTranscriptTimingDiagnostic({
        createId: () => `timing-${index}`,
        estimate: { minSeconds: 40, maxSeconds: 115 },
        now: createdAt,
        sourceFile: new File(["audio"], "source.wav", { type: "audio/wav" }),
      })
    }
    const expiredAt = new Date(NOW.getTime() - TRANSCRIPT_TIMING_DIAGNOSTIC_RETENTION_MS - 1)
    startTranscriptTimingDiagnostic({
      createId: () => "expired",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      now: expiredAt,
      sourceFile: new File(["audio"], "source.wav", { type: "audio/wav" }),
    })

    const records = readTranscriptTimingDiagnostics(localStorage, NOW.getTime())
    expect(records).toHaveLength(TRANSCRIPT_TIMING_DIAGNOSTIC_MAX_RECORDS)
    expect(records[0]?.id).toBe("timing-0")
    expect(records.some(({ id }) => id === "expired")).toBe(false)
    expect(JSON.parse(localStorage.getItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY) ?? "[]")).toHaveLength(
      TRANSCRIPT_TIMING_DIAGNOSTIC_MAX_RECORDS
    )
  })

  it("clears both diagnostic records and the active pointer", () => {
    startTranscriptTimingDiagnostic({
      createId: () => "timing-1",
      estimate: { minSeconds: 40, maxSeconds: 115 },
      now: NOW,
      sourceFile: new File(["audio"], "source.flac", { type: "audio/flac" }),
    })

    clearTranscriptTimingDiagnostics()

    expect(readTranscriptTimingDiagnostics()).toEqual([])
    expect(localStorage.getItem(TRANSCRIPT_TIMING_DIAGNOSTICS_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(ACTIVE_TRANSCRIPT_TIMING_DIAGNOSTIC_STORAGE_KEY)).toBeNull()
  })
})
