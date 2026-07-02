import {
  BROWSER_ARCHIVE_ROOT_NAME,
  BROWSER_GENERATED_AUDIO_EXPORT_DIR,
  BROWSER_GENERATED_AUDIO_INDEX_DIR,
  BROWSER_GENERATED_AUDIO_INDEX_FILENAME,
  buildGeneratedAudioExportDescriptor,
  buildGeneratedAudioExportFilenameCandidates,
  buildGeneratedAudioExportSidecar,
  type GeneratedAudioExportable,
} from "@/lib/generated-audio-export-metadata"
import { sha256Blob } from "@/lib/generated-audio-hash"
import {
  GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME,
  idbRequest,
  idbTransaction,
  openGeneratedAudioDatabase,
} from "@/lib/generated-audio-storage"

const BROWSER_EXPORT_TMP_DIR = ".tmp"
export const BROWSER_ARCHIVE_EXPORT_TARGET_RECORD_ID = "selected-browser-directory"

export type BrowserArchiveExportPermissionState = "granted" | "denied" | "prompt"

export type BrowserFileSystemWritableFileStream = {
  write: (data: Blob | string) => Promise<void>
  close: () => Promise<void>
  abort?: () => Promise<void>
}

export type BrowserFileSystemFileHandle = {
  kind: "file"
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<BrowserFileSystemWritableFileStream>
}

export type BrowserFileSystemDirectoryHandle = {
  kind: "directory"
  name: string
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<BrowserFileSystemDirectoryHandle>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserFileSystemFileHandle>
  removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<BrowserArchiveExportPermissionState>
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<BrowserArchiveExportPermissionState>
}

export type BrowserArchiveExportTargetRecord = {
  id: string
  handleId: string
  name: string
  handle: BrowserFileSystemDirectoryHandle
  selectedAt: string
  updatedAt: string
}

export type BrowserArchiveExportWriteResult = {
  alreadyExported: boolean
  exportedAt: string
  filename: string
  indexFilename: string
  sha256: string
  sidecarFilename: string
}

export class BrowserArchiveExportUnsupportedError extends Error {
  constructor(message = "Browser folder export is not supported in this browser.") {
    super(message)
    this.name = "BrowserArchiveExportUnsupportedError"
  }
}

export class BrowserArchiveExportPermissionError extends Error {
  constructor(message = "Browser folder export permission was denied.") {
    super(message)
    this.name = "BrowserArchiveExportPermissionError"
  }
}

export class BrowserArchiveExportWriteError extends Error {
  constructor(message = "Browser folder export could not write the selected directory.") {
    super(message)
    this.name = "BrowserArchiveExportWriteError"
  }
}

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BrowserFileSystemDirectoryHandle>
}

export function isBrowserArchiveExportSupported() {
  return typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === "function"
}

export function isBrowserArchiveExportSelectionCanceled(value: unknown) {
  return isNamedBrowserError(value, "AbortError")
}

export async function selectBrowserArchiveExportDirectory(): Promise<BrowserArchiveExportTargetRecord> {
  const showDirectoryPicker = (window as WindowWithDirectoryPicker).showDirectoryPicker
  if (typeof showDirectoryPicker !== "function") {
    throw new BrowserArchiveExportUnsupportedError()
  }
  const now = new Date().toISOString()
  const handle = await showDirectoryPicker({ mode: "readwrite" })
  const record: BrowserArchiveExportTargetRecord = {
    handle,
    handleId: createBrowserArchiveExportHandleId(),
    id: BROWSER_ARCHIVE_EXPORT_TARGET_RECORD_ID,
    name: handle.name || "Selected Folder",
    selectedAt: now,
    updatedAt: now,
  }
  await saveBrowserArchiveExportTargetRecord(record)
  return record
}

export async function readBrowserArchiveExportDirectory(): Promise<BrowserArchiveExportTargetRecord | null> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME, "readonly")
    const request = transaction.objectStore(GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME).get(
      BROWSER_ARCHIVE_EXPORT_TARGET_RECORD_ID
    )
    return (await idbRequest<BrowserArchiveExportTargetRecord | undefined>(request)) ?? null
  } finally {
    database.close()
  }
}

export async function forgetBrowserArchiveExportDirectory(): Promise<void> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME, "readwrite")
    transaction.objectStore(GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME).delete(BROWSER_ARCHIVE_EXPORT_TARGET_RECORD_ID)
    await idbTransaction(transaction)
  } finally {
    database.close()
  }
}

export async function ensureBrowserArchiveExportPermission(
  target: BrowserArchiveExportTargetRecord
): Promise<BrowserArchiveExportPermissionState> {
  const descriptor = { mode: "readwrite" as const }
  const queried = await queryBrowserArchiveExportPermission(target)
  if (queried === "granted") {
    return "granted"
  }
  const requested = await target.handle.requestPermission?.(descriptor)
  return requested ?? queried ?? "granted"
}

export async function queryBrowserArchiveExportPermission(
  target: BrowserArchiveExportTargetRecord
): Promise<BrowserArchiveExportPermissionState> {
  return (await target.handle.queryPermission?.({ mode: "readwrite" })) ?? "prompt"
}

export async function exportGeneratedAudioToBrowserDirectory(
  target: BrowserArchiveExportTargetRecord,
  item: GeneratedAudioExportable,
  blob: Blob
): Promise<BrowserArchiveExportWriteResult> {
  const permission = await ensureBrowserArchiveExportPermission(target)
  if (permission !== "granted") {
    throw new BrowserArchiveExportPermissionError()
  }
  try {
    const exportItem = await withExportSha256(item, blob)
    const archiveRoot = await target.handle.getDirectoryHandle(BROWSER_ARCHIVE_ROOT_NAME, { create: true })
    const tmpDirectory = await archiveRoot.getDirectoryHandle(BROWSER_EXPORT_TMP_DIR, { create: true })
    const descriptor = buildGeneratedAudioExportDescriptor(exportItem)
    const audioDirectory = await getOrCreateDirectory(archiveRoot, [
      BROWSER_GENERATED_AUDIO_EXPORT_DIR,
      descriptor.year,
      descriptor.month,
    ])
    const audioResult = await writeAudioFile(audioDirectory, tmpDirectory, exportItem, blob)
    const exportedAt = new Date().toISOString()
    const sidecarFilename = replaceExtension(audioResult.filename, ".json")
    const sidecarPayload = buildGeneratedAudioExportSidecar(exportItem, audioResult.filename, exportedAt)
    await writeTextFileViaTemp(
      audioDirectory,
      tmpDirectory,
      sidecarFilename,
      `${JSON.stringify(sidecarPayload, null, 2)}\n`
    )
    const indexDirectory = await getOrCreateDirectory(archiveRoot, [BROWSER_GENERATED_AUDIO_INDEX_DIR])
    await appendIndexLine(indexDirectory, tmpDirectory, sidecarPayload)
    return {
      alreadyExported: audioResult.alreadyExported,
      exportedAt,
      filename: `${BROWSER_GENERATED_AUDIO_EXPORT_DIR}/${descriptor.year}/${descriptor.month}/${audioResult.filename}`,
      indexFilename: `${BROWSER_GENERATED_AUDIO_INDEX_DIR}/${BROWSER_GENERATED_AUDIO_INDEX_FILENAME}`,
      sha256: exportItem.sha256,
      sidecarFilename: `${BROWSER_GENERATED_AUDIO_EXPORT_DIR}/${descriptor.year}/${descriptor.month}/${sidecarFilename}`,
    }
  } catch (caught) {
    if (caught instanceof BrowserArchiveExportPermissionError) {
      throw caught
    }
    throw new BrowserArchiveExportWriteError(caught instanceof Error ? caught.message : undefined)
  }
}

async function withExportSha256(
  item: GeneratedAudioExportable,
  blob: Blob
): Promise<GeneratedAudioExportable & { sha256: string }> {
  if (item.sha256) {
    return { ...item, sha256: item.sha256 }
  }
  return { ...item, sha256: await sha256Blob(blob) }
}

async function saveBrowserArchiveExportTargetRecord(record: BrowserArchiveExportTargetRecord): Promise<void> {
  const database = await openGeneratedAudioDatabase()
  try {
    const transaction = database.transaction(GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME, "readwrite")
    transaction.objectStore(GENERATED_AUDIO_EXPORT_TARGET_STORE_NAME).put(record)
    await idbTransaction(transaction)
  } finally {
    database.close()
  }
}

async function getOrCreateDirectory(
  root: BrowserFileSystemDirectoryHandle,
  names: string[]
): Promise<BrowserFileSystemDirectoryHandle> {
  let current = root
  for (const name of names) {
    current = await current.getDirectoryHandle(name, { create: true })
  }
  return current
}

async function writeAudioFile(
  audioDirectory: BrowserFileSystemDirectoryHandle,
  tmpDirectory: BrowserFileSystemDirectoryHandle,
  item: GeneratedAudioExportable,
  blob: Blob
) {
  for (const filename of buildGeneratedAudioExportFilenameCandidates(item)) {
    const existing = await getFileHandleIfExists(audioDirectory, filename)
    if (existing) {
      if (item.sha256 && (await sha256Blob(await existing.getFile())) === item.sha256) {
        return { alreadyExported: true, filename }
      }
      continue
    }
    await writeBlobFileViaTemp(audioDirectory, tmpDirectory, filename, blob, tempPartName(item))
    return { alreadyExported: false, filename }
  }
  throw new BrowserArchiveExportWriteError("Unable to allocate a generated audio export filename.")
}

async function appendIndexLine(
  indexDirectory: BrowserFileSystemDirectoryHandle,
  tmpDirectory: BrowserFileSystemDirectoryHandle,
  payload: Record<string, unknown>
) {
  const previousIndex = await readTextFileIfExists(indexDirectory, BROWSER_GENERATED_AUDIO_INDEX_FILENAME)
  const nextIndex = `${previousIndex}${JSON.stringify(payload)}\n`
  await writeTextFileViaTemp(indexDirectory, tmpDirectory, BROWSER_GENERATED_AUDIO_INDEX_FILENAME, nextIndex)
}

async function writeBlobFileViaTemp(
  targetDirectory: BrowserFileSystemDirectoryHandle,
  tmpDirectory: BrowserFileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
  tmpFilename: string
) {
  const tmpHandle = await tmpDirectory.getFileHandle(tmpFilename, { create: true })
  try {
    await writeFile(tmpHandle, blob)
    const stagedFile = await tmpHandle.getFile()
    const finalHandle = await targetDirectory.getFileHandle(filename, { create: true })
    await writeFile(finalHandle, stagedFile)
  } finally {
    await removeEntryIfSupported(tmpDirectory, tmpFilename)
  }
}

async function writeTextFileViaTemp(
  targetDirectory: BrowserFileSystemDirectoryHandle,
  tmpDirectory: BrowserFileSystemDirectoryHandle,
  filename: string,
  contents: string
) {
  const tmpFilename = `${filename}.part`
  const tmpHandle = await tmpDirectory.getFileHandle(tmpFilename, { create: true })
  try {
    await writeFile(tmpHandle, contents)
    const stagedFile = await tmpHandle.getFile()
    const finalHandle = await targetDirectory.getFileHandle(filename, { create: true })
    await writeFile(finalHandle, stagedFile)
  } finally {
    await removeEntryIfSupported(tmpDirectory, tmpFilename)
  }
}

async function writeFile(handle: BrowserFileSystemFileHandle, data: Blob | string) {
  const writable = await handle.createWritable()
  try {
    await writable.write(data)
    await writable.close()
  } catch (caught) {
    await writable.abort?.()
    throw caught
  }
}

async function getFileHandleIfExists(
  directory: BrowserFileSystemDirectoryHandle,
  filename: string
): Promise<BrowserFileSystemFileHandle | null> {
  try {
    return await directory.getFileHandle(filename)
  } catch (caught) {
    if (isNotFoundError(caught)) {
      return null
    }
    throw caught
  }
}

async function readTextFileIfExists(directory: BrowserFileSystemDirectoryHandle, filename: string) {
  const handle = await getFileHandleIfExists(directory, filename)
  if (!handle) {
    return ""
  }
  return handle.getFile().then((file) => file.text())
}

async function removeEntryIfSupported(directory: BrowserFileSystemDirectoryHandle, name: string) {
  if (typeof directory.removeEntry !== "function") {
    return
  }
  try {
    await directory.removeEntry(name)
  } catch (caught) {
    if (!isNotFoundError(caught)) {
      throw caught
    }
  }
}

function tempPartName(item: GeneratedAudioExportable) {
  const descriptor = buildGeneratedAudioExportDescriptor(item)
  return `${descriptor.idSlug}-${descriptor.sha8}.part`
}

function replaceExtension(filename: string, extension: string) {
  return filename.replace(/\.[^.]+$/, extension)
}

function createBrowserArchiveExportHandleId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return `browser-directory-${window.crypto.randomUUID()}`
  }
  return `browser-directory-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isNotFoundError(value: unknown) {
  return isNamedBrowserError(value, "NotFoundError")
}

function isNamedBrowserError(value: unknown, name: string) {
  const DomExceptionCtor = globalThis.DOMException
  if (typeof DomExceptionCtor === "function" && value instanceof DomExceptionCtor) {
    return value.name === name
  }
  return value instanceof Error && value.name === name
}
