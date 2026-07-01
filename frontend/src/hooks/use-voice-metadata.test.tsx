import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useVoiceMetadata } from "./use-voice-metadata"
import type { ModelOption, SubscriptionResponse } from "@/types"

const BROWSER_SELECTED_MODEL_BY_PROVIDER_KEY = "voice-clone-selected-model-by-provider"

const multilingualModel = modelOption({
  modelId: "eleven_multilingual_v2",
  name: "Multilingual V2",
})

const flashModel = modelOption({
  modelId: "eleven_flash_v2_5",
  name: "Flash V2.5",
})

const subscription: SubscriptionResponse = {
  available: true,
  canExtendCharacterLimit: false,
  characterCount: 0,
  characterLimit: 1000,
  error: null,
  maxCreditLimitExtension: null,
  nextCharacterCountResetUnix: null,
  remainingCharacters: 1000,
  status: "active",
  tier: "free",
}

function VoiceMetadataHarness() {
  const metadata = useVoiceMetadata({
    canUseProvider: true,
    providerId: "elevenlabs",
    providerKey: null,
    providerStatus: "success",
  })

  return (
    <div>
      <div data-testid="model-error">{metadata.modelError ?? ""}</div>
      <div data-testid="model-status">{metadata.modelStatus}</div>
      <div data-testid="selected-model">{metadata.selectedModelId}</div>
      <button onClick={() => metadata.setSelectedModelId(flashModel.modelId)}>Select Flash</button>
    </div>
  )
}

function modelOption(overrides: Partial<ModelOption>): ModelOption {
  return {
    canUseSpeakerBoost: true,
    canUseStyle: true,
    characterCostMultiplier: 1,
    description: "",
    maxCharactersRequestFreeUser: null,
    maxCharactersRequestSubscribedUser: null,
    maximumTextLengthPerRequest: null,
    modelId: "model",
    name: "Model",
    ...overrides,
  }
}

function mockMetadataEndpointsWithUnavailableSettings() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith("/api/subscription") && !init) {
        return okJson(subscription)
      }
      if (url.startsWith("/api/models") && !init) {
        return okJson({
          available: true,
          defaultModelId: multilingualModel.modelId,
          error: null,
          models: [multilingualModel, flashModel],
        })
      }
      if (url === "/api/settings") {
        return jsonResponse({ detail: "App settings persistence is not configured." }, 503)
      }
      return jsonResponse({ detail: "Not found." }, 404)
    })
  )
}

function okJson(payload: unknown) {
  return jsonResponse(payload, 200)
}

function jsonResponse(payload: unknown, status: number) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  )
}

describe("useVoiceMetadata", () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("keeps selected model in browser storage when app settings are unavailable", async () => {
    const user = userEvent.setup()
    mockMetadataEndpointsWithUnavailableSettings()
    const { unmount } = render(<VoiceMetadataHarness />)

    await waitFor(() => expect(screen.getByTestId("model-status")).toHaveTextContent("success"))
    expect(screen.getByTestId("selected-model")).toHaveTextContent(multilingualModel.modelId)

    await user.click(screen.getByRole("button", { name: /select flash/i }))

    await waitFor(() =>
      expect(localStorage.getItem(BROWSER_SELECTED_MODEL_BY_PROVIDER_KEY)).toContain(flashModel.modelId)
    )
    expect(screen.getByTestId("model-error")).toHaveTextContent("")

    unmount()
    render(<VoiceMetadataHarness />)

    await waitFor(() => expect(screen.getByTestId("model-status")).toHaveTextContent("success"))
    expect(screen.getByTestId("selected-model")).toHaveTextContent(flashModel.modelId)
  })
})
