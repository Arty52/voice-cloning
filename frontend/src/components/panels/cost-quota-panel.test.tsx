import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { CostQuotaPanel } from "./cost-quota-panel"

it("distinguishes selective revision cost from regenerating the complete recording", () => {
  render(<CostQuotaPanel characterCount={8} estimatedCredits={4} fullGenerationEstimate={{ characterCount: 1600, credits: 800 }}
    hasModelRate={false} isExpanded isGenerating={false} modelError={null} modelStatus="success" models={[]}
    onModelChange={vi.fn()} onRefresh={vi.fn()} onToggleExpanded={vi.fn()} providerLinks={[]} result={null}
    selectedModel={null} selectedModelId="" subscription={null} subscriptionError={null} subscriptionStatus="success" />)
  expect(screen.getByText("Generate Changes")).toBeVisible()
  expect(screen.getByText("~4")).toBeVisible()
  expect(screen.getByText(/Regenerate All uses/)).toHaveTextContent("1,600 characters (~800 credits)")
})
