import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES } from "@/lib/generated-audio-storage"

import { GeneratedAudioPanel } from "./generated-audio-panel"

describe("GeneratedAudioPanel pending mutations", () => {
  it("renders archive mutations with the pending work surface", () => {
    render(
      <GeneratedAudioPanel
        allItems={[]}
        items={[]}
        libraryStatus="success"
        mutationStatus="clear"
        onClear={vi.fn()}
        onDelete={vi.fn()}
        onStorageLimitChange={vi.fn()}
        storageError={null}
        storageLimitBytes={DEFAULT_GENERATED_AUDIO_STORAGE_LIMIT_BYTES}
        usage={null}
      />
    )

    const status = screen.getByRole("status", { name: "Clearing Audio" })
    const surface = status.closest(".pending-work-status")

    expect(status).toHaveTextContent("Updating")
    expect(status).toHaveTextContent("Removing saved generated audio from the browser archive.")
    expect(surface).toHaveClass("pending-work-status")
    expect(surface?.querySelector(".pending-work-status__shine")).toBeInTheDocument()
  })
})
