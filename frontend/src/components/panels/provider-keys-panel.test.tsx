import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ProviderKeysPanel } from "./provider-keys-panel"

const sample = {
  maxSourceUploadBytes: 1024 * 1024 * 1024,
  maxUploadBytes: 10 * 1024 * 1024,
  maxWindowSeconds: 120,
  recommendedMinSeconds: 60,
  recommendedMaxSeconds: 120,
  targetSampleRateHz: 16000,
}

const elevenLabsProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  serverKeyConfigured: false,
  manageKeyUrl: "https://elevenlabs.io/app/subscription/api",
  docsUrl: "https://elevenlabs.io/docs/api-reference/authentication",
  links: [],
  sample,
  tuning: { controls: [], presets: [], defaultValues: {} },
}

const zonosProvider = {
  id: "zonos",
  label: "Zonos",
  serverKeyConfigured: false,
  manageKeyUrl: "https://example.test/zonos/key",
  docsUrl: "https://example.test/zonos/docs",
  links: [],
  sample,
  tuning: { controls: [], presets: [], defaultValues: {} },
}

describe("ProviderKeysPanel", () => {
  it("syncs the hidden draft key when the active provider changes", () => {
    const props = {
      keySource: "browser" as const,
      onClearProviderKey: vi.fn(),
      onSaveProviderKey: vi.fn(),
      providerError: null,
      providerStatus: "success" as const,
    }
    const { rerender } = render(
      <ProviderKeysPanel activeProvider={elevenLabsProvider} activeProviderKey="eleven-key" {...props} />
    )

    expect(screen.getByLabelText(/ElevenLabs API Key/i)).toHaveValue("eleven-key")

    rerender(<ProviderKeysPanel activeProvider={zonosProvider} activeProviderKey="zonos-key" {...props} />)

    const input = screen.getByLabelText(/Zonos API Key/i)
    expect(input).toHaveAttribute("type", "password")
    expect(input).toHaveValue("zonos-key")
  })

  it("uses provider-agnostic missing-key copy", () => {
    render(
      <ProviderKeysPanel
        activeProvider={elevenLabsProvider}
        activeProviderKey={null}
        keySource="missing"
        onClearProviderKey={vi.fn()}
        onSaveProviderKey={vi.fn()}
        providerError={null}
        providerStatus="success"
      />
    )

    expect(screen.getByText(/server-side provider key/i)).toBeInTheDocument()
    expect(screen.queryByText(/ELEVENLABS_API_KEY/)).not.toBeInTheDocument()
  })
})
