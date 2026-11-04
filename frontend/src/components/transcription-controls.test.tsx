import { render, screen } from "@testing-library/react"
import { it, expect, vi } from "vitest"
import type { TranscriptionSettingsController } from "@/hooks/use-transcription-settings"
import { TranscriptionControls } from "./transcription-controls"

it("describes text-only mode when speaker detection is disabled", () => {
  const settings = {
    options: { engineId: "parakeet-mlx", language: "en", detectSpeakers: false },
    engines: [], status: "success", nativeDiarizationReady: false,
    selectEngine: vi.fn(), selectLanguage: vi.fn(), setDetectSpeakers: vi.fn(), refresh: vi.fn(),
  } as unknown as TranscriptionSettingsController
  render(<TranscriptionControls settings={settings} disabled={false} />)
  expect(screen.getByRole("switch", { name: "Detect Speakers" })).not.toBeChecked()
  expect(screen.getByText("Text-only transcription. Speaker detection is off.")).toBeVisible()
  expect(screen.queryByText(/Turn it off/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Speaker detection is not prepared/)).not.toBeInTheDocument()
})
