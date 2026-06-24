import { afterEach, describe, expect, it, vi } from "vitest"

import {
  addVoice,
  cancelSampleProcessingJob,
  cancelSpeechJob,
  createSampleProcessingJob,
  createSpeechJob,
  providerHeaders,
  fetchSpeechJob,
  regenerateSpeechJobSegment,
  saveProcessedVoice,
  saveSpeakerVoices,
  sampleProcessingSourceUrl,
  sampleProcessingSpeakerResultUrl,
  speechJobResultUrl,
  speechJobSegmentResultUrl,
  updateSampleProcessingSpeakerAssignments,
  updateVoice,
  VOICE_PROVIDER_KEY_HEADER,
} from "./api"

function okJson(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  )
}

describe("provider request headers", () => {
  it("adds the provider key header when a browser key is available", () => {
    expect(providerHeaders({ providerKey: " browser-key " })).toEqual({
      [VOICE_PROVIDER_KEY_HEADER]: "browser-key",
    })
  })

  it("omits provider headers when no browser key is available", () => {
    expect(providerHeaders({ providerKey: null })).toBeUndefined()
    expect(providerHeaders({ providerKey: "   " })).toBeUndefined()
  })
})

describe("voice API helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("sends voice preset id when adding a voice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        okJson({
          voice: {
            id: "voice-clone-01",
            name: "Voice_Clone_01",
            voicePresetId: "animatedDialogue",
          },
        })
      )
    )
    const sample = new File(["sample"], "voice.mp3", { type: "audio/mpeg" })

    await addVoice("Voice_Clone_01", sample, { voicePresetId: "animatedDialogue" })

    expect(fetch).toHaveBeenCalledWith("/api/voices", expect.objectContaining({ method: "POST" }))
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData
    expect(body.get("name")).toBe("Voice_Clone_01")
    expect(body.get("sampleFile")).toBe(sample)
    expect(body.get("voicePresetId")).toBe("animatedDialogue")
  })

  it("updates a voice with partial fields", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ defaultVoiceId: "default", voices: [] })))

    await updateVoice("default", { voicePresetId: "standardNarration" })

    expect(fetch).toHaveBeenCalledWith(
      "/api/voices/default",
      expect.objectContaining({
        body: JSON.stringify({ voicePresetId: "standardNarration" }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    )
  })

  it("creates a sample processing job from a saved voice", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job-1", status: "running" } })))

    await createSampleProcessingJob({
      operationId: "isolateVoice",
      processingPresetId: "clean",
      sourcePreference: "original",
      sourceVoiceId: "voice-clone-01",
    })

    expect(fetch).toHaveBeenCalledWith("/api/sample-processing/jobs", expect.objectContaining({ method: "POST" }))
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData
    expect(body.get("operationId")).toBe("isolateVoice")
    expect(body.get("processingPresetId")).toBe("clean")
    expect(body.get("sourceVoiceId")).toBe("voice-clone-01")
    expect(body.get("sourcePreference")).toBe("original")
    expect(body.get("sourceFile")).toBeNull()
  })

  it("creates a sample processing job from an uploaded file", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job-1", status: "running" } })))
    const source = new File(["source"], "source.wav", { type: "audio/wav" })

    await createSampleProcessingJob({ operationId: "isolateVoice", sourceFile: source })

    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData
    expect(body.get("operationId")).toBe("isolateVoice")
    expect(body.get("sourceFile")).toBe(source)
    expect(body.get("sourceVoiceId")).toBeNull()
  })

  it("creates a stacked sample processing job", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job-1", status: "running" } })))

    await createSampleProcessingJob({
      sourceVoiceId: "voice-clone-01",
      workflowSteps: [
        { operationId: "isolateVoice", processingPresetId: "balanced" },
        { operationId: "separateSpeakers" },
        { operationId: "trimSilence", processingPresetId: "trimBalanced" },
      ],
    })

    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData
    expect(body.get("operationId")).toBeNull()
    expect(body.get("workflowSteps")).toBe(
      JSON.stringify([
        { operationId: "isolateVoice", processingPresetId: "balanced" },
        { operationId: "separateSpeakers" },
        { operationId: "trimSilence", processingPresetId: "trimBalanced" },
      ])
    )
    expect(body.get("sourceVoiceId")).toBe("voice-clone-01")
  })

  it("rejects sample processing jobs without an operation or workflow stack", async () => {
    vi.stubGlobal("fetch", vi.fn())

    await expect(createSampleProcessingJob({ sourceVoiceId: "voice-clone-01" })).rejects.toThrow(
      "Sample processing requires operationId or workflowSteps."
    )

    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects sample processing jobs with both operation and workflow stack inputs", async () => {
    vi.stubGlobal("fetch", vi.fn())

    await expect(
      createSampleProcessingJob({
        operationId: "isolateVoice",
        sourceVoiceId: "voice-clone-01",
        workflowSteps: [{ operationId: "trimSilence", processingPresetId: "trimBalanced" }],
      })
    ).rejects.toThrow("Provide either operationId or workflowSteps, not both.")

    expect(fetch).not.toHaveBeenCalled()
  })

  it("cancels a sample processing job", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job-1", status: "canceled" } })))

    await cancelSampleProcessingJob("job-1")

    expect(fetch).toHaveBeenCalledWith(
      "/api/sample-processing/jobs/job-1/cancel",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("saves a processed result as a voice", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ voice: { id: "vegeta-isolated", name: "Vegeta Isolated" } })))

    await saveProcessedVoice("job-1", { name: "Vegeta Isolated", voicePresetId: "animatedDialogue" })

    expect(fetch).toHaveBeenCalledWith(
      "/api/sample-processing/jobs/job-1/voice",
      expect.objectContaining({
        body: JSON.stringify({ name: "Vegeta Isolated", voicePresetId: "animatedDialogue" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    )
  })

  it("builds speaker separation playback URLs", () => {
    expect(sampleProcessingSourceUrl("job 1")).toBe("/api/sample-processing/jobs/job%201/source")
    expect(sampleProcessingSpeakerResultUrl("job 1", "speaker/1")).toBe(
      "/api/sample-processing/jobs/job%201/speakers/speaker%2F1/result"
    )
  })

  it("patches speaker assignments", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job-1", status: "success" } })))

    await updateSampleProcessingSpeakerAssignments("job-1", {
      speakerNames: [{ speakerId: "speaker-1", name: "Morgan" }],
      transcriptAssignments: [{ itemId: "item-2", speakerId: "speaker-1" }],
    })

    expect(fetch).toHaveBeenCalledWith(
      "/api/sample-processing/jobs/job-1/speaker-assignments",
      expect.objectContaining({
        body: JSON.stringify({
          speakerNames: [{ speakerId: "speaker-1", name: "Morgan" }],
          transcriptAssignments: [{ itemId: "item-2", speakerId: "speaker-1" }],
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    )
  })

  it("saves selected speaker voices", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ voices: [{ id: "morgan", name: "Morgan" }] })))

    await saveSpeakerVoices("job-1", {
      voices: [
        { speakerId: "speaker-1", name: "Morgan", voicePresetId: "standardNarration" },
        { speakerId: "speaker-2", name: "Riley", voicePresetId: "animatedDialogue" },
      ],
    })

    expect(fetch).toHaveBeenCalledWith(
      "/api/sample-processing/jobs/job-1/speaker-voices",
      expect.objectContaining({
        body: JSON.stringify({
          voices: [
            { speakerId: "speaker-1", name: "Morgan", voicePresetId: "standardNarration" },
            { speakerId: "speaker-2", name: "Riley", voicePresetId: "animatedDialogue" },
          ],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    )
  })

  it("creates a speech job with JSON segments and provider key header", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job-1", status: "pending" } }, 202)))

    await createSpeechJob({
      defaultVoiceId: "narrator",
      modelId: "eleven_flash_v2_5",
      providerId: "elevenlabs",
      providerKey: " browser-secret ",
      segments: [
        {
          assignmentKind: "assigned",
          clientSegmentId: "segment-one",
          text: "Hello ",
          voiceId: "narrator",
        },
        {
          assignmentKind: "default",
          clientSegmentId: "segment-two",
          text: "there.",
          voiceId: "default",
        },
      ],
      text: "Hello there.",
      tuning: { stability: 0.42 },
    })

    expect(fetch).toHaveBeenCalledWith(
      "/api/speech/jobs",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          [VOICE_PROVIDER_KEY_HEADER]: "browser-secret",
        },
        method: "POST",
      })
    )
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      defaultVoiceId: "narrator",
      modelId: "eleven_flash_v2_5",
      providerId: "elevenlabs",
      segments: [
        {
          assignmentKind: "assigned",
          clientSegmentId: "segment-one",
          text: "Hello ",
          voiceId: "narrator",
        },
        {
          assignmentKind: "default",
          clientSegmentId: "segment-two",
          text: "there.",
          voiceId: "default",
        },
      ],
      text: "Hello there.",
      voiceSettings: { stability: 0.42 },
    })
  })

  it("serializes an explicit speech job segment gap", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job-1", status: "pending" } }, 202)))

    await createSpeechJob({
      defaultVoiceId: "narrator",
      modelId: null,
      providerId: "elevenlabs",
      providerKey: null,
      segmentGapMs: 0,
      segments: [
        {
          assignmentKind: "assigned",
          clientSegmentId: "segment-one",
          text: "Hello.",
          voiceId: "narrator",
        },
      ],
      text: "Hello.",
      tuning: {},
    })

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      segmentGapMs: 0,
    })
  })

  it("polls and cancels speech jobs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job 1", status: "canceled" } })))

    await fetchSpeechJob("job 1")
    await cancelSpeechJob("job 1")

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/speech/jobs/job%201", undefined)
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/speech/jobs/job%201/cancel",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("builds speech job result URLs", () => {
    expect(speechJobResultUrl("job 1")).toBe("/api/speech/jobs/job%201/result")
    expect(speechJobSegmentResultUrl("job 1", "segment/1")).toBe(
      "/api/speech/jobs/job%201/segments/segment%2F1/result"
    )
  })

  it("regenerates speech job segments with an optional voice override", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ job: { id: "job-1", status: "running" } }, 202)))

    await regenerateSpeechJobSegment("job-1", "segment-one", {
      providerKey: "browser-secret",
      voiceId: "villain",
    })

    expect(fetch).toHaveBeenCalledWith(
      "/api/speech/jobs/job-1/segments/segment-one/regenerate",
      expect.objectContaining({
        body: JSON.stringify({ voiceId: "villain" }),
        headers: {
          "Content-Type": "application/json",
          [VOICE_PROVIDER_KEY_HEADER]: "browser-secret",
        },
        method: "POST",
      })
    )
  })
})
