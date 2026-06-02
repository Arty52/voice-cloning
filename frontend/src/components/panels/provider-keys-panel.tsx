import { Copy, ExternalLink, Eye, EyeOff, KeyRound } from "lucide-react"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { AsyncStatus, ProviderKeySource, VoiceProvider } from "@/types"

type ProviderKeysPanelProps = {
  activeProvider: VoiceProvider | null
  activeProviderKey: string | null
  keySource: ProviderKeySource
  onClearProviderKey: (providerId: string) => void
  onSaveProviderKey: (providerId: string, apiKey: string) => void
  providerError: string | null
  providerStatus: AsyncStatus
}

export function ProviderKeysPanel({
  activeProvider,
  activeProviderKey,
  keySource,
  onClearProviderKey,
  onSaveProviderKey,
  providerError,
  providerStatus,
}: ProviderKeysPanelProps) {
  const [draftKey, setDraftKey] = useState(activeProviderKey ?? "")
  const [isRevealed, setIsRevealed] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const providerId = activeProvider?.id ?? "elevenlabs"
  const providerLabel = activeProvider?.label ?? "Provider"
  const hasBrowserKey = keySource === "browser"
  const isMissingKey = providerStatus === "success" && keySource === "missing"
  const canCopy = Boolean(activeProviderKey)
  const canClear = hasBrowserKey
  const canSave = draftKey.trim() !== (activeProviderKey ?? "")

  function handleSave() {
    const nextKey = draftKey.trim()
    onSaveProviderKey(providerId, nextKey)
    setDraftKey(nextKey)
    setIsRevealed(false)
    setCopyStatus(null)
  }

  function handleClear() {
    onClearProviderKey(providerId)
    setDraftKey("")
    setIsRevealed(false)
    setCopyStatus(null)
  }

  async function handleCopy() {
    if (!activeProviderKey) {
      return
    }
    try {
      await window.navigator.clipboard.writeText(activeProviderKey)
      setCopyStatus("Copied")
    } catch {
      setCopyStatus("Copy failed")
    }
  }

  return (
    <Card aria-labelledby="provider-keys-title">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <KeyRound aria-hidden="true" className="size-4 text-primary" />
            <CardTitle id="provider-keys-title">Provider Keys</CardTitle>
          </div>
          <Badge>{keySourceLabel(keySource, providerStatus)}</Badge>
        </div>
        <CardDescription>Store a browser-local key for this workspace, or use the backend `.env` fallback.</CardDescription>
      </CardHeader>

      <CardContent>
        {isMissingKey ? (
          <Alert>
            <AlertTitle>Missing Key</AlertTitle>
            <AlertDescription>Add a browser key or set `ELEVENLABS_API_KEY` in `.env` before generating speech.</AlertDescription>
          </Alert>
        ) : null}

        {providerError ? (
          <Alert>
            <AlertTitle>Provider Settings Unavailable</AlertTitle>
            <AlertDescription>{providerError}</AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup>
          <Field data-invalid={isMissingKey ? true : undefined}>
            <FieldLabel htmlFor="provider-api-key">{providerLabel} API Key</FieldLabel>
            <div className="flex gap-2">
              <Input
                aria-invalid={isMissingKey ? true : undefined}
                autoComplete="off"
                id="provider-api-key"
                onChange={(event) => {
                  setDraftKey(event.target.value)
                  setCopyStatus(null)
                }}
                placeholder={activeProvider?.serverKeyConfigured ? "Using .env fallback" : "Enter API key"}
                spellCheck={false}
                type={isRevealed ? "text" : "password"}
                value={draftKey}
              />
              <Button
                aria-label={isRevealed ? "Hide Key" : "Peek Key"}
                onClick={() => setIsRevealed((current) => !current)}
                size="icon"
                type="button"
                variant="secondary"
              >
                {isRevealed ? <EyeOff aria-hidden="true" data-icon="inline-start" /> : <Eye aria-hidden="true" data-icon="inline-start" />}
              </Button>
              <Button
                aria-label="Copy Key"
                disabled={!canCopy}
                onClick={() => void handleCopy()}
                size="icon"
                type="button"
                variant="secondary"
              >
                <Copy aria-hidden="true" data-icon="inline-start" />
              </Button>
            </div>
            <FieldDescription>
              {hasBrowserKey
                ? "Browser key is active and overrides `.env` for provider requests."
                : activeProvider?.serverKeyConfigured
                  ? "No browser key saved; provider requests use `.env`."
                  : "No provider key is available yet."}
            </FieldDescription>
          </Field>
        </FieldGroup>

        {copyStatus ? <div className="text-xs text-muted-foreground">{copyStatus}</div> : null}
      </CardContent>

      <CardFooter>
        <Button disabled={!canSave} onClick={handleSave} size="sm" type="button">
          Save Key
        </Button>
        <Button disabled={!canClear} onClick={handleClear} size="sm" type="button" variant="secondary">
          Clear Key
        </Button>
        {activeProvider?.manageKeyUrl ? (
          <a
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={activeProvider.manageKeyUrl}
            rel="noreferrer"
            target="_blank"
          >
            Manage API Key
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </CardFooter>
    </Card>
  )
}

function keySourceLabel(keySource: ProviderKeySource, providerStatus: AsyncStatus) {
  if (providerStatus === "loading" || providerStatus === "idle") {
    return "Loading"
  }
  if (keySource === "browser") {
    return "Browser Key"
  }
  if (keySource === "server") {
    return ".env Fallback"
  }
  return "Missing Key"
}
