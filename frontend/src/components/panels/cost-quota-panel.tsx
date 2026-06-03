import { BarChart3, Check, ChevronDown, ExternalLink, Gauge, RefreshCw } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Loading } from "@/components/ui/loading"
import { BACKEND_DEFAULT_MODEL_LABEL } from "@/constants"
import { formatNumber } from "@/lib/formatters"
import { cn } from "@/lib/utils"
import type { AsyncStatus, GeneratedResult, ModelOption, ProviderLink, SubscriptionResponse } from "@/types"

type CostQuotaPanelProps = {
  characterCount: number
  estimatedCredits: number
  hasModelRate: boolean
  isExpanded: boolean
  isGenerating: boolean
  modelError: string | null
  modelStatus: AsyncStatus
  models: ModelOption[]
  onModelChange: (modelId: string) => void
  onRefresh: () => void
  onToggleExpanded: () => void
  providerLinks: ProviderLink[]
  result: GeneratedResult | null
  selectedModel: ModelOption | null
  selectedModelId: string
  subscription: SubscriptionResponse | null
  subscriptionError: string | null
  subscriptionStatus: AsyncStatus
}

export function CostQuotaPanel({
  characterCount,
  estimatedCredits,
  hasModelRate,
  isExpanded,
  isGenerating,
  modelError,
  modelStatus,
  models,
  onModelChange,
  onRefresh,
  onToggleExpanded,
  providerLinks,
  result,
  selectedModel,
  selectedModelId,
  subscription,
  subscriptionError,
  subscriptionStatus,
}: CostQuotaPanelProps) {
  const isLoading = subscriptionStatus === "loading" || modelStatus === "loading"
  const isSubscriptionLoading = subscriptionStatus === "loading"
  const detailsId = "cost-quota-details"
  const quotaStatus =
    isSubscriptionLoading
      ? <Loading text="Loading Quota" size="sm" variant="secondary" />
      : subscription
        ? `${formatNumber(subscription.remainingCharacters)} remaining`
        : "Quota unavailable"
  const usedPercent =
    subscription && subscription.characterLimit > 0
      ? Math.min(100, Math.round((subscription.characterCount / subscription.characterLimit) * 100))
      : null

  return (
    <section className="rounded-lg border border-border bg-card/90 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Cost & Quota</h2>
          <p className="mt-1 text-sm text-muted-foreground">Estimate, quota, and last run usage.</p>
        </div>
        <Button
          aria-controls={detailsId}
          aria-expanded={isExpanded}
          onClick={onToggleExpanded}
          size="sm"
          type="button"
          variant="secondary"
        >
          {isExpanded ? "Collapse" : "Expand"}
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
        </Button>
      </div>

      <div className="grid gap-3 border-y border-border py-3 sm:grid-cols-3 sm:divide-x sm:divide-border">
        <MetricTile
          icon={<BarChart3 aria-hidden="true" className="size-4" />}
          label="Estimate"
          value={`~${formatNumber(estimatedCredits)}`}
        />
        <MetricTile icon={<Gauge aria-hidden="true" className="size-4" />} label="Quota" value={quotaStatus} />
        <MetricTile
          icon={<Check aria-hidden="true" className="size-4" />}
          label="Actual"
          value={
            result?.characterCount !== null && result?.characterCount !== undefined
              ? formatNumber(result.characterCount)
              : "No run"
          }
        />
      </div>

      <div aria-hidden={!isExpanded} className="mt-4 space-y-4" hidden={!isExpanded} id={detailsId}>
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>Details</span>
            {isLoading ? <Loading text="Refreshing Metadata" size="sm" variant="secondary" /> : null}
          </div>
          <Button
            aria-label="Refresh cost and quota"
            disabled={isLoading}
            onClick={onRefresh}
            size="icon"
            type="button"
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" className={cn("size-4", isLoading && "animate-spin")} />
          </Button>
        </div>

        <label className="block space-y-2 text-sm font-medium" htmlFor="model-select">
          <span>Model</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isGenerating || modelStatus === "loading" || models.length === 0}
            id="model-select"
            onChange={(event) => onModelChange(event.target.value)}
            value={selectedModelId}
          >
            {models.length > 0 ? (
              models.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.name}
                </option>
              ))
            ) : (
              <option value={selectedModelId}>{BACKEND_DEFAULT_MODEL_LABEL}</option>
            )}
          </select>
        </label>

        <div className="grid gap-3 border-b border-border pb-3 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <div className="font-medium text-foreground">Estimate Basis</div>
            <div className="mt-1 font-mono tabular-nums">
              {formatNumber(characterCount)} chars
              {hasModelRate ? ` x ${selectedModel?.characterCostMultiplier}` : " x character count"}
            </div>
            <div className="mt-1">{hasModelRate ? "Uses model rate metadata." : "Rate unavailable; using character count."}</div>
          </div>
          <div>
            <div className="font-medium text-foreground">Account Period</div>
            <div className="mt-1 font-mono tabular-nums">
              {subscription ? `${formatNumber(subscription.characterCount)} / ${formatNumber(subscription.characterLimit)}` : "Unavailable"}
            </div>
            <div className="mt-1">
              {subscription
                ? `${subscription.tier} - ${subscription.status}${usedPercent === null ? "" : ` - ${usedPercent}% used`}`
                : subscriptionError || "No quota loaded."}
            </div>
          </div>
        </div>

        {modelError ? <div className="text-sm text-muted-foreground">Model metadata unavailable: {modelError}</div> : null}

        {result?.requestId ? <div className="font-mono text-xs text-muted-foreground">Request {result.requestId}</div> : null}

        {providerLinks.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {providerLinks.map((link) => (
              <a
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={link.href}
                key={link.href}
                rel="noreferrer"
                target="_blank"
              >
                {link.label}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function MetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 sm:px-3 first:sm:pl-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 min-h-5 truncate text-sm text-foreground">
        {typeof value === "string" ? <span className="font-mono tabular-nums">{value}</span> : value}
      </div>
    </div>
  )
}
