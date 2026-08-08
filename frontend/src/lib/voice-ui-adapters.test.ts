import { describe, expect, it } from "vitest"

import {
  speakerSeparationToTranscriptDocument,
  transcriptSourceToPlaybackSource,
  voiceAssetToPickerOption,
  voiceAssetToPreviewSource,
} from "@/lib/voice-ui-adapters"
import { validateTranscriptDocument } from "@/lib/voice-ui-contracts"
import type { SpeakerSeparationResult, VoiceAsset } from "@/types"

const voiceFixture: VoiceAsset = {
  contentType: "audio/mpeg",
  createdAt: "2026-08-06T00:00:00Z",
  filePath: "storage/voices/provider-hidden.mp3",
  id: "voice-local-1",
  name: "Morgan",
  processingSteps: [],
  sampleMode: "excerpt",
  sha256: "voice-hash",
  source: "upload",
  sourceContentType: null,
  sourceFilePath: null,
  sourceSha256: null,
  voicePresetId: "standardNarration",
  voiceSettingsByProvider: { elevenlabs: { stability: 0.5 } },
  windowDurationSeconds: null,
  windowStartSeconds: null,
}

const speakerSeparationFixture: SpeakerSeparationResult = {
  kind: "speakerSeparation",
  speakers: [
    { assignedName: "Morgan", id: "speaker-local-1", label: "Speaker 1", result: null, transcriptItemIds: ["turn-2"] },
    { assignedName: null, id: "speaker-local-2", label: "Speaker 2", result: null, transcriptItemIds: ["turn-1"] },
  ],
  transcript: {
    items: [
      { endSeconds: 5, id: "turn-2", speakerId: "speaker-local-1", startSeconds: 3, text: "Second turn." },
      { endSeconds: 2, id: "turn-1", speakerId: "speaker-local-2", startSeconds: 0, text: "First turn." },
    ],
  },
}

describe("voice UI adapters", () => {
  it("normalizes a current voice response without leaking provider settings or storage fields", () => {
    const option = voiceAssetToPickerOption(voiceFixture, { previewUrl: "/api/voices/voice-local-1/sample" })

    expect(option).toEqual({
      description: "Voice Sample",
      id: "voice-local-1",
      metadata: [],
      name: "Morgan",
      preview: {
        id: "voice-local-1:preview",
        kind: "voicePreview",
        label: "Morgan Preview",
        url: "/api/voices/voice-local-1/sample",
      },
    })
    expect(option).not.toHaveProperty("providerId")
    expect(option).not.toHaveProperty("voiceSettingsByProvider")
    expect(option).not.toHaveProperty("filePath")
  })

  it("normalizes current speaker-separation responses into one chronological transcript presentation", () => {
    const transcript = speakerSeparationToTranscriptDocument(speakerSeparationFixture, { documentId: "transcript-local-1" })

    expect(transcript).toMatchObject({
      id: "transcript-local-1",
      revision: 0,
      segments: [
        { id: "turn-1", speakerId: "speaker-local-2", text: "First turn." },
        { id: "turn-2", speakerId: "speaker-local-1", text: "Second turn." },
      ],
      speakers: [
        { id: "speaker-local-1", label: "Morgan" },
        { id: "speaker-local-2", label: "Speaker 2" },
      ],
    })
    expect(validateTranscriptDocument(transcript)).toBe(true)
    expect(transcript).not.toHaveProperty("providerId")
  })

  it("keeps transcript source provenance in a local playback source", () => {
    expect(
      transcriptSourceToPlaybackSource({
        documentId: "transcript-local-1",
        label: "Interview Source",
        url: "/api/sample-processing/jobs/job-local-1/source",
      })
    ).toEqual({
      id: "transcript-local-1:source",
      kind: "transcriptSource",
      label: "Interview Source",
      url: "/api/sample-processing/jobs/job-local-1/source",
    })
  })

  it("builds a stable local preview source without leaking a voice file path", () => {
    expect(voiceAssetToPreviewSource(voiceFixture)).toEqual({
      id: "voice-library:voice-local-1:preview",
      kind: "voicePreview",
      label: "Morgan Preview",
      url: "/api/voices/voice-local-1/sample",
    })
    expect(voiceAssetToPreviewSource({ id: "  ", name: "Morgan" })).toBeNull()
  })
})
