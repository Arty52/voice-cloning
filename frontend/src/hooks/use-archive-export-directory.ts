import { useEffect, useState } from "react"

import {
  BrowserArchiveExportPermissionError,
  BrowserArchiveExportUnsupportedError,
  exportGeneratedAudioToBrowserDirectory,
  forgetBrowserArchiveExportDirectory,
  isBrowserArchiveExportSupported,
  queryBrowserArchiveExportPermission,
  readBrowserArchiveExportDirectory,
  selectBrowserArchiveExportDirectory,
  type BrowserArchiveExportPermissionState,
  type BrowserArchiveExportTargetRecord,
} from "@/lib/generated-audio-export-target"
import {
  clearBrowserArchiveExportLedgerForTarget,
  listBrowserArchiveExportLedger,
  saveBrowserArchiveExportLedgerEntry,
  type BrowserArchiveExportLedgerEntry,
} from "@/lib/generated-audio-export-ledger"
import { buildGeneratedAudioExportRelativePath, type GeneratedAudioExportable } from "@/lib/generated-audio-export-metadata"
import type { GeneratedResult } from "@/types"

export type BrowserArchiveExportMutation = "select" | "forget" | "refresh" | "export" | "export-all"

export function useArchiveExportDirectory(items: GeneratedResult[]) {
  const [browserExportSupported] = useState(() => isBrowserArchiveExportSupported())
  const [browserExportTarget, setBrowserExportTarget] = useState<BrowserArchiveExportTargetRecord | null>(null)
  const [browserExportPermission, setBrowserExportPermission] =
    useState<BrowserArchiveExportPermissionState | null>(null)
  const [browserExportLedger, setBrowserExportLedger] = useState<BrowserArchiveExportLedgerEntry[]>([])
  const [browserExportError, setBrowserExportError] = useState<string | null>(null)
  const [browserExportMutation, setBrowserExportMutation] = useState<BrowserArchiveExportMutation | null>(null)

  useEffect(() => {
    let isMounted = true
    async function loadTarget() {
      try {
        const target = await readBrowserArchiveExportDirectory()
        if (!isMounted) {
          return
        }
        setBrowserExportTarget(target)
        if (!target) {
          setBrowserExportPermission(null)
          setBrowserExportLedger([])
          return
        }
        const [permission, ledger] = await Promise.all([
          queryBrowserArchiveExportPermission(target),
          listBrowserArchiveExportLedger(target.handleId),
        ])
        if (!isMounted) {
          return
        }
        setBrowserExportPermission(permission)
        setBrowserExportLedger(ledger)
      } catch (caught) {
        if (isMounted) {
          setBrowserExportError(formatBrowserExportError(caught))
        }
      }
    }
    void loadTarget()
    return () => {
      isMounted = false
    }
  }, [])

  async function refreshBrowserExportDirectory() {
    const mutation = startBrowserExportMutation("refresh")
    try {
      const target = await readBrowserArchiveExportDirectory()
      setBrowserExportTarget(target)
      if (!target) {
        setBrowserExportPermission(null)
        setBrowserExportLedger([])
        setBrowserExportError(null)
        return
      }
      const [permission, ledger] = await Promise.all([
        queryBrowserArchiveExportPermission(target),
        listBrowserArchiveExportLedger(target.handleId),
      ])
      setBrowserExportPermission(permission)
      setBrowserExportLedger(ledger)
      setBrowserExportError(null)
    } catch (caught) {
      setBrowserExportError(formatBrowserExportError(caught))
    } finally {
      clearBrowserExportMutation(mutation)
    }
  }

  async function selectBrowserExportDirectory() {
    const mutation = startBrowserExportMutation("select")
    try {
      const target = await selectBrowserArchiveExportDirectory()
      const permission = await queryBrowserArchiveExportPermission(target)
      setBrowserExportTarget(target)
      setBrowserExportPermission(permission)
      setBrowserExportLedger(await listBrowserArchiveExportLedger(target.handleId))
      setBrowserExportError(null)
    } catch (caught) {
      setBrowserExportError(formatBrowserExportError(caught))
    } finally {
      clearBrowserExportMutation(mutation)
    }
  }

  async function forgetBrowserExportDirectory() {
    const mutation = startBrowserExportMutation("forget")
    try {
      if (browserExportTarget) {
        await clearBrowserArchiveExportLedgerForTarget(browserExportTarget.handleId)
      }
      await forgetBrowserArchiveExportDirectory()
      setBrowserExportTarget(null)
      setBrowserExportPermission(null)
      setBrowserExportLedger([])
      setBrowserExportError(null)
    } catch (caught) {
      setBrowserExportError(formatBrowserExportError(caught))
    } finally {
      clearBrowserExportMutation(mutation)
    }
  }

  async function exportGeneratedAudioItemToBrowserDirectory(item: GeneratedResult) {
    await exportItemsToBrowserDirectory([item], "export")
  }

  async function exportAllGeneratedAudioToBrowserDirectory() {
    await exportItemsToBrowserDirectory(items, "export-all")
  }

  async function exportItemsToBrowserDirectory(nextItems: GeneratedResult[], mutationType: BrowserArchiveExportMutation) {
    if (!browserExportTarget) {
      setBrowserExportError("Select a browser export folder first.")
      return
    }
    const mutation = startBrowserExportMutation(mutationType)
    try {
      const nextLedger: BrowserArchiveExportLedgerEntry[] = []
      for (const item of nextItems) {
        nextLedger.push(await exportOne(browserExportTarget, item))
      }
      setBrowserExportLedger(await listBrowserArchiveExportLedger(browserExportTarget.handleId))
      setBrowserExportPermission(await queryBrowserArchiveExportPermission(browserExportTarget))
      setBrowserExportError(nextLedger.some((entry) => entry.status === "failed") ? "Some browser exports failed." : null)
    } catch (caught) {
      setBrowserExportError(formatBrowserExportError(caught))
    } finally {
      clearBrowserExportMutation(mutation)
    }
  }

  async function exportOne(target: BrowserArchiveExportTargetRecord, item: GeneratedResult) {
    const exportable = generatedResultToExportable(item)
    try {
      const blob = await fetchGeneratedAudioBlob(item)
      const result = await exportGeneratedAudioToBrowserDirectory(target, exportable, blob)
      return saveBrowserArchiveExportLedgerEntry({
        audioId: item.id,
        exportedAt: result.exportedAt,
        filename: result.filename,
        lastError: null,
        sha256: item.sha256,
        status: "exported",
        targetHandleId: target.handleId,
        updatedAt: new Date().toISOString(),
      })
    } catch (caught) {
      const message = formatBrowserExportError(caught)
      const entry = await saveBrowserArchiveExportLedgerEntry({
        audioId: item.id,
        exportedAt: null,
        filename: buildGeneratedAudioExportRelativePath(exportable),
        lastError: message,
        sha256: item.sha256,
        status: "failed",
        targetHandleId: target.handleId,
        updatedAt: new Date().toISOString(),
      })
      if (caught instanceof BrowserArchiveExportPermissionError) {
        setBrowserExportPermission("denied")
      }
      return entry
    }
  }

  function startBrowserExportMutation(type: BrowserArchiveExportMutation) {
    setBrowserExportMutation(type)
    return type
  }

  function clearBrowserExportMutation(type: BrowserArchiveExportMutation) {
    setBrowserExportMutation((current) => (current === type ? null : current))
  }

  return {
    browserExportError,
    browserExportLedger,
    browserExportMutation,
    browserExportPermission,
    browserExportSupported,
    browserExportTarget,
    exportAllGeneratedAudioToBrowserDirectory,
    exportGeneratedAudioItemToBrowserDirectory,
    forgetBrowserExportDirectory,
    refreshBrowserExportDirectory,
    selectBrowserExportDirectory,
  }
}

async function fetchGeneratedAudioBlob(item: GeneratedResult) {
  const response = await fetch(item.url)
  if (!response.ok) {
    throw new Error(`Unable to read generated audio ${item.id}.`)
  }
  return response.blob()
}

function generatedResultToExportable(item: GeneratedResult): GeneratedAudioExportable {
  return {
    appVoiceId: item.appVoiceId,
    cacheState: item.cacheState,
    characterCount: item.characterCount,
    contentType: item.contentType,
    createdAt: item.createdAt,
    generationElapsedMs: item.generationElapsedMs,
    id: item.id,
    modelId: item.modelId,
    multiVoiceMetadata: item.multiVoiceMetadata,
    providerId: null,
    requestId: item.requestId,
    sha256: item.sha256,
    sizeBytes: item.sizeBytes,
    tuningMetadata: item.tuningMetadata,
    voiceId: item.voiceId,
    voiceName: item.voiceName,
  }
}

function formatBrowserExportError(value: unknown) {
  if (value instanceof BrowserArchiveExportUnsupportedError) {
    return value.message
  }
  if (value instanceof Error) {
    return value.message
  }
  return "Unable to export generated audio to the browser folder."
}
