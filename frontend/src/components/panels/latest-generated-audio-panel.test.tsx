import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import type { GenerationPendingStatus, GeneratedResult, ProviderTuningControl, VoiceAsset } from "@/types"
import { TooltipProvider } from "@/components/ui/tooltip"

import { LatestGeneratedAudioPanel } from "./latest-generated-audio-panel"

const narrator = voice("narrator", "Narrator")
const villain = voice("villain", "Villain")
const segmentTuningControls: ProviderTuningControl[] = [
  {
    defaultValue: 0.4,
    description: "Lower values allow more expressive delivery.",
    id: "stability",
    label: "Stability",
    max: 1,
    min: 0,
    step: 0.01,
    type: "slider",
  },
  {
    defaultValue: false,
    description: "Boosts speaker similarity.",
    id: "useSpeakerBoost",
    label: "Speaker Boost",
    type: "toggle",
  },
]

const item: GeneratedResult = {
  appVoiceId: "narrator",
  cacheState: "multi-voice",
  characterCount: 24,
  contentType: "audio/mpeg",
  createdAt: "2026-06-23T00:00:00.000Z",
  generatedAt: "Jun 23, 2026",
  generationElapsedMs: 1200,
  id: "generated-1",
  modelId: "eleven_flash_v2_5",
  multiVoiceMetadata: {
    jobId: "job-1",
    resultSha256: "combined-hash",
    segmentCount: 2,
    segments: [
      {
        assignmentKind: "assigned",
        characterCount: 12,
        generationCount: 1,
        id: "segment-one",
        index: 0,
        resultSha256: "segment-one-hash",
        text: "Hello narrator.",
        voiceId: "narrator",
        voiceName: "Narrator",
        voiceSettings: { useSpeakerBoost: false },
      },
      {
        assignmentKind: "default",
        characterCount: 12,
        generationCount: 2,
        id: "segment-two",
        index: 1,
        resultSha256: "segment-two-hash",
        text: "Villain replies.",
        voiceId: "villain",
        voiceName: "Villain",
        voiceSettings: { useSpeakerBoost: false },
      },
    ],
    voices: [
      { segmentCount: 1, voiceId: "narrator", voiceName: "Narrator" },
      { segmentCount: 1, voiceId: "villain", voiceName: "Villain" },
    ],
  },
  requestId: null,
  sizeBytes: 12,
  tuningMetadata: null,
  url: "blob:generated-1",
  voiceId: "narrator",
  voiceName: "Multi-Voice",
}

function voice(id: string, name: string): VoiceAsset {
  return {
    contentType: "audio/mpeg",
    createdAt: "2026-06-23T00:00:00.000Z",
    filePath: `${id}.mp3`,
    id,
    name,
    processingSteps: [],
    sampleMode: "excerpt",
    sha256: `${id}-hash`,
    source: "upload",
    sourceContentType: null,
    sourceFilePath: null,
    sourceSha256: null,
    voicePresetId: "standardNarration",
    voiceSettingsByProvider: {},
    windowDurationSeconds: null,
    windowStartSeconds: null,
  }
}

function renderLatestPanel(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe("LatestGeneratedAudioPanel pending generation", () => {
  it("renders lifted dialogue progress while generation is running", () => {
    const generationPendingStatus: GenerationPendingStatus = {
      activeDetail: "Segment 2: Villain",
      description: "Rendering dialogue rows into a combined audio result.",
      elapsedMs: 1234,
      meta: ["5 Segments"],
      segments: [
        {
          detail: "Narrator opens.",
          id: "segment-one",
          index: 0,
          isActive: false,
          label: "Segment 1",
          status: "success",
          voiceName: "Narrator",
        },
        {
          detail: "Villain replies.",
          id: "segment-two",
          index: 1,
          isActive: true,
          label: "Segment 2",
          status: "running",
          voiceName: "Villain",
        },
        {
          detail: "Hero waits.",
          id: "segment-three",
          index: 2,
          isActive: false,
          label: "Segment 3",
          status: "pending",
          voiceName: "Hero",
        },
        {
          detail: "Segment failed.",
          id: "segment-four",
          index: 3,
          isActive: false,
          label: "Segment 4",
          status: "error",
          voiceName: "Narrator",
        },
        {
          detail: "Segment canceled.",
          id: "segment-five",
          index: 4,
          isActive: false,
          label: "Segment 5",
          status: "canceled",
          voiceName: "Villain",
        },
      ],
      statusLabel: "Running",
      title: "Generating Dialogue",
    }

    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        generationPendingStatus={generationPendingStatus}
        isDeleteDisabled={false}
        item={null}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        segmentResultUrls={{}}
        status="generating"
        storageError={null}
        voices={[narrator, villain]}
      />
    )

    const pending = screen.getByRole("status", { name: "Generating Dialogue" })
    expect(pending).toHaveTextContent("Rendering dialogue rows into a combined audio result.")
    expect(pending).toHaveTextContent("Elapsed 1.2s")
    expect(pending).toHaveTextContent("5 Segments")
    expect(pending).toHaveTextContent("Active: Segment 2: Villain")
    expect(screen.getByRole("list", { name: "Generation Progress" })).toBeInTheDocument()
    expect(pending).toHaveTextContent("Segment 1")
    expect(pending).toHaveTextContent("Complete")
    expect(pending).toHaveTextContent("Segment 2")
    expect(pending).toHaveTextContent("Running")
    expect(pending).toHaveTextContent("Segment 3")
    expect(pending).toHaveTextContent("Queued")
    expect(pending).toHaveTextContent("Segment 4")
    expect(pending).toHaveTextContent("Error")
    expect(pending).toHaveTextContent("Segment 5")
    expect(pending).toHaveTextContent("Canceled")
  })

  it("falls back to speech generation copy without a detailed pending model", () => {
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        item={null}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        segmentResultUrls={{}}
        status="generating"
        storageError={null}
        voices={[narrator]}
      />
    )

    expect(screen.getByRole("status", { name: "Generating Speech" })).toHaveTextContent("Running")
  })
})

describe("LatestGeneratedAudioPanel multi-voice results", () => {
  it("keeps segment controls collapsed until opened", async () => {
    const user = userEvent.setup()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        onRegenerateVoiceSegments={vi.fn()}
        onSaveVoiceTuning={vi.fn()}
        segmentResultUrls={{
          "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result",
          "segment-two": "/api/speech/jobs/job-1/segments/segment-two/result",
        }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )

    expect(screen.getByRole("region", { name: /multi-voice segment controls/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /show segments/i })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getAllByRole("button", { name: /play audio/i })).toHaveLength(1)
    expect(screen.queryByRole("group", { name: /generated segment 1 playback/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /show segments/i }))

    expect(screen.getByRole("button", { name: /hide segments/i })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Hello narrator.")).toBeInTheDocument()
    expect(screen.getByText("Villain replies.")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /play audio/i })).toHaveLength(3)

    await user.click(screen.getByRole("button", { name: /hide segments/i }))

    expect(screen.getByRole("button", { name: /show segments/i })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getAllByRole("button", { name: /play audio/i })).toHaveLength(1)
    expect(screen.queryByRole("group", { name: /generated segment 1 playback/i })).not.toBeInTheDocument()
  })

  it("plays segments and regenerates with an optional changed voice", async () => {
    const user = userEvent.setup()
    const onRegenerateSegment = vi.fn()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={onRegenerateSegment}
        onRegenerateVoiceSegments={vi.fn()}
        onSaveVoiceTuning={vi.fn()}
        segmentResultUrls={{
          "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result",
          "segment-two": "/api/speech/jobs/job-1/segments/segment-two/result",
        }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))

    expect(screen.getByRole("region", { name: /multi-voice segment controls/i })).toBeInTheDocument()
    expect(screen.getByText("Hello narrator.")).toBeInTheDocument()
    expect(screen.getByText("Villain replies.")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /play audio/i })).toHaveLength(3)

    await user.click(screen.getByRole("button", { name: /voice for segment 1: narrator/i }))
    await user.click(screen.getByRole("menuitemradio", { name: "Villain" }))
    await user.click(screen.getAllByRole("button", { name: /^Regenerate$/i })[0])

    expect(onRegenerateSegment).toHaveBeenCalledWith("segment-one", "villain")
  })

  it("resets segment voice choices when the latest job changes", async () => {
    const user = userEvent.setup()
    const onRegenerateSegment = vi.fn()
    const renderPanel = (panelItem: GeneratedResult) => (
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={panelItem}
        onDelete={vi.fn()}
        onRegenerateSegment={onRegenerateSegment}
        onRegenerateVoiceSegments={vi.fn()}
        onSaveVoiceTuning={vi.fn()}
        segmentResultUrls={{
          "segment-one": `/api/speech/jobs/${panelItem.multiVoiceMetadata?.jobId}/segments/segment-one/result`,
        }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )
    const { rerender } = renderLatestPanel(renderPanel(item))

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    await user.click(screen.getByRole("button", { name: /voice for segment 1: narrator/i }))
    await user.click(screen.getByRole("menuitemradio", { name: "Villain" }))
    expect(screen.getByRole("button", { name: /voice for segment 1: villain/i })).toBeInTheDocument()

    const nextItem: GeneratedResult = {
      ...item,
      id: "generated-2",
      multiVoiceMetadata: {
        ...item.multiVoiceMetadata!,
        jobId: "job-2",
        resultSha256: "combined-hash-2",
        segments: item.multiVoiceMetadata!.segments.map((segment) =>
          segment.id === "segment-one" ? { ...segment, generationCount: 2, resultSha256: "segment-one-hash-2" } : segment
        ),
      },
    }
    rerender(<TooltipProvider>{renderPanel(nextItem)}</TooltipProvider>)

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    expect(screen.getByRole("button", { name: /voice for segment 1: narrator/i })).toBeInTheDocument()

    await user.click(screen.getAllByRole("button", { name: /^Regenerate$/i })[0])

    expect(onRegenerateSegment).toHaveBeenLastCalledWith("segment-one", null)
  })

  it("regenerates with the current voice when no override is selected", async () => {
    const user = userEvent.setup()
    const onRegenerateSegment = vi.fn()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={onRegenerateSegment}
        onRegenerateVoiceSegments={vi.fn()}
        onSaveVoiceTuning={vi.fn()}
        segmentResultUrls={{ "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result" }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    await user.click(screen.getAllByRole("button", { name: /^Regenerate$/i })[0])

    expect(onRegenerateSegment).toHaveBeenCalledWith("segment-one", null)
  })

  it("keeps a segment's current voice visible when it is missing from the voice library", async () => {
    const user = userEvent.setup()
    const archivedVoiceItem: GeneratedResult = {
      ...item,
      multiVoiceMetadata: {
        ...item.multiVoiceMetadata!,
        segments: item.multiVoiceMetadata!.segments.map((segment) =>
          segment.id === "segment-one"
            ? { ...segment, voiceId: "archived", voiceName: "Archived Voice" }
            : segment
        ),
      },
    }

    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={archivedVoiceItem}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        onRegenerateVoiceSegments={vi.fn()}
        onSaveVoiceTuning={vi.fn()}
        segmentResultUrls={{ "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result" }}
        status="success"
        storageError={null}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))

    expect(screen.getByRole("button", { name: /voice for segment 1: archived voice/i })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /voice for segment 1: archived voice/i }))

    expect(screen.getByRole("menuitemradio", { name: "Archived Voice" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("menuitemradio", { name: "Narrator" })).toBeInTheDocument()
  })

  it("does not autofocus tuning help when segment tuning opens", async () => {
    const user = userEvent.setup()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        onRegenerateVoiceSegments={vi.fn()}
        onSaveVoiceTuning={vi.fn()}
        providerTuningControls={segmentTuningControls}
        segmentResultUrls={{ "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result" }}
        status="success"
        storageError={null}
        tuning={{ stability: 0.4, useSpeakerBoost: false }}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    await user.click(screen.getAllByRole("button", { name: /^Tune$/i })[0])

    const stabilityHelp = screen.getByRole("button", { name: "Stability help" })
    expect(screen.getByRole("heading", { name: "Segment 1 Tuning" })).toBeInTheDocument()
    expect(screen.getByText("Adjust settings for the next time this segment regenerates.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open Segment 1 Tuning Actions" })).toBeInTheDocument()
    expect(document.body.querySelector('label[for="segment-segment-one-tuning-stability"]')).toHaveTextContent(
      "Stability"
    )
    expect(stabilityHelp).not.toHaveFocus()
  })

  it("regenerates with a segment tuning override", async () => {
    const user = userEvent.setup()
    const onRegenerateSegment = vi.fn()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={onRegenerateSegment}
        onRegenerateVoiceSegments={vi.fn()}
        onSaveVoiceTuning={vi.fn()}
        providerTuningControls={segmentTuningControls}
        segmentResultUrls={{ "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result" }}
        status="success"
        storageError={null}
        tuning={{ useSpeakerBoost: false }}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    await user.click(screen.getAllByRole("button", { name: /^Tune$/i })[0])
    await user.click(screen.getByRole("checkbox", { name: "Speaker Boost" }))
    await user.click(screen.getAllByRole("button", { name: /^Regenerate$/i })[0])

    expect(onRegenerateSegment).toHaveBeenCalledWith("segment-one", null, { useSpeakerBoost: true })
  })

  it("regenerates all segments for a shared voice with the selected tuning", async () => {
    const user = userEvent.setup()
    const onRegenerateVoiceSegments = vi.fn()
    const sharedVoiceItem: GeneratedResult = {
      ...item,
      multiVoiceMetadata: {
        ...item.multiVoiceMetadata!,
        segments: item.multiVoiceMetadata!.segments.map((segment) => ({
          ...segment,
          voiceId: "narrator",
          voiceName: "Narrator",
        })),
        voices: [{ segmentCount: 2, voiceId: "narrator", voiceName: "Narrator" }],
      },
    }
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={sharedVoiceItem}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        onRegenerateVoiceSegments={onRegenerateVoiceSegments}
        onSaveVoiceTuning={vi.fn()}
        providerTuningControls={segmentTuningControls}
        segmentResultUrls={{
          "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result",
          "segment-two": "/api/speech/jobs/job-1/segments/segment-two/result",
        }}
        status="success"
        storageError={null}
        tuning={{ useSpeakerBoost: false }}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    expect(screen.queryByRole("button", { name: "Regenerate All For Voice" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save Tuning To Voice" })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole("button", { name: /^Tune$/i })[0])
    const segmentActions = screen.getByRole("button", { name: "Open Segment 1 Tuning Actions" })
    await user.click(segmentActions)
    expect(screen.getByRole("menuitem", { name: "Regenerate Same Voice Segments" })).toBeDisabled()
    await user.click(segmentActions)
    await user.click(screen.getByRole("checkbox", { name: "Speaker Boost" }))
    await user.click(screen.getByRole("button", { name: "Open Segment 1 Tuning Actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Regenerate Same Voice Segments" }))

    expect(onRegenerateVoiceSegments).toHaveBeenCalledWith("narrator", { useSpeakerBoost: true })
  })

  it("uses the currently selected voice for same-voice regeneration", async () => {
    const user = userEvent.setup()
    const onRegenerateVoiceSegments = vi.fn()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        onRegenerateVoiceSegments={onRegenerateVoiceSegments}
        onSaveVoiceTuning={vi.fn()}
        providerTuningControls={segmentTuningControls}
        segmentResultUrls={{
          "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result",
          "segment-two": "/api/speech/jobs/job-1/segments/segment-two/result",
        }}
        status="success"
        storageError={null}
        tuning={{ useSpeakerBoost: false }}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    await user.click(screen.getByRole("button", { name: "Voice For Segment 2: Villain" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Narrator" }))
    await user.click(screen.getAllByRole("button", { name: /^Tune$/i })[1])
    await user.click(screen.getByRole("checkbox", { name: "Speaker Boost" }))
    await user.click(screen.getByRole("button", { name: "Open Segment 2 Tuning Actions" }))
    const regenerateSameVoice = screen.getByRole("menuitem", { name: "Regenerate Same Voice Segments" })

    expect(regenerateSameVoice).not.toBeDisabled()
    await user.click(regenerateSameVoice)

    expect(onRegenerateVoiceSegments).toHaveBeenCalledWith("narrator", { useSpeakerBoost: true })
  })

  it("saves segment tuning to the selected voice", async () => {
    const user = userEvent.setup()
    const onSaveVoiceTuning = vi.fn()
    renderLatestPanel(
      <LatestGeneratedAudioPanel
        activeProviderId="elevenlabs"
        error={null}
        isDeleteDisabled={false}
        isSavingVoiceTuning={false}
        item={item}
        onDelete={vi.fn()}
        onRegenerateSegment={vi.fn()}
        onRegenerateVoiceSegments={vi.fn()}
        onSaveVoiceTuning={onSaveVoiceTuning}
        providerTuningControls={segmentTuningControls}
        segmentResultUrls={{ "segment-one": "/api/speech/jobs/job-1/segments/segment-one/result" }}
        status="success"
        storageError={null}
        tuning={{ useSpeakerBoost: false }}
        voices={[narrator, villain]}
      />
    )

    await user.click(screen.getByRole("button", { name: /show segments/i }))
    expect(screen.queryByRole("button", { name: "Save Tuning To Voice" })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole("button", { name: /^Tune$/i })[0])
    const segmentActions = screen.getByRole("button", { name: "Open Segment 1 Tuning Actions" })
    await user.click(segmentActions)
    expect(screen.getByRole("menuitem", { name: "Save Tuning To Voice" })).toBeDisabled()
    await user.click(segmentActions)
    await user.click(screen.getByRole("checkbox", { name: "Speaker Boost" }))
    await user.click(screen.getByRole("button", { name: "Open Segment 1 Tuning Actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Save Tuning To Voice" }))

    expect(onSaveVoiceTuning).toHaveBeenCalledWith("narrator", { useSpeakerBoost: true })
  })
})
