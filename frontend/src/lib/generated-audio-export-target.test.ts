import { afterEach, describe, expect, it, vi } from "vitest"

import { sha256Blob } from "./generated-audio-hash"
import {
  BrowserArchiveExportPermissionError,
  BrowserArchiveExportUnsupportedError,
  BrowserArchiveExportWriteError,
  exportGeneratedAudioToBrowserDirectory,
  selectBrowserArchiveExportDirectory,
  type BrowserArchiveExportPermissionState,
  type BrowserArchiveExportTargetRecord,
  type BrowserFileSystemDirectoryHandle,
  type BrowserFileSystemFileHandle,
  type BrowserFileSystemWritableFileStream,
} from "./generated-audio-export-target"
import type { GeneratedAudioExportable } from "./generated-audio-export-metadata"

describe("browser generated audio export target", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reports unsupported browsers before selecting a folder", async () => {
    vi.stubGlobal("showDirectoryPicker", undefined)

    await expect(selectBrowserArchiveExportDirectory()).rejects.toBeInstanceOf(BrowserArchiveExportUnsupportedError)
  })

  it("rejects exports when permission is denied", async () => {
    const target = targetRecord(new MemoryDirectoryHandle("Exports", { permission: "denied" }))
    const blob = new Blob(["audio"], { type: "audio/mpeg" })

    await expect(exportGeneratedAudioToBrowserDirectory(target, await exportItem(blob), blob)).rejects.toBeInstanceOf(
      BrowserArchiveExportPermissionError
    )
  })

  it("requests permission and exports audio, sidecar, and index files", async () => {
    const root = new MemoryDirectoryHandle("Exports", { permission: "prompt", requestPermission: "granted" })
    const target = targetRecord(root)
    const blob = new Blob(["audio"], { type: "audio/mpeg" })
    const item = await exportItem(blob, { sha256: null })
    const expectedSha256 = await sha256Blob(blob)

    const result = await exportGeneratedAudioToBrowserDirectory(target, item, blob)

    expect(result).toMatchObject({
      alreadyExported: false,
      filename: `generated-audio/2026/07/20260701T184522Z--default-voice--eleven-multilingual-v2--${expectedSha256.slice(
        0,
        8
      )}.mp3`,
      sha256: expectedSha256,
    })
    const archiveRoot = root.directory("Voice Clone Lab Archive")
    const audioDirectory = archiveRoot.directory("generated-audio").directory("2026").directory("07")
    expect(await (await audioDirectory.file(result.filename.split("/").at(-1) ?? "")).text()).toBe("audio")
    const sidecar = JSON.parse(await (await audioDirectory.file(result.sidecarFilename.split("/").at(-1) ?? "")).text()) as {
      id: string
      filePath?: string
      sha256: string
    }
    expect(sidecar.id).toBe("audio-id")
    expect(sidecar.sha256).toBe(expectedSha256)
    expect(sidecar).not.toHaveProperty("filePath")
    expect(await (await archiveRoot.directory("index").file("generated-audio.jsonl")).text()).toContain('"id":"audio-id"')
  })

  it("can reuse caller-granted permission without requesting it again", async () => {
    const root = new MemoryDirectoryHandle("Exports", { permission: "prompt", requestPermission: "denied" })
    const target = targetRecord(root)
    const blob = new Blob(["audio"], { type: "audio/mpeg" })

    await expect(
      exportGeneratedAudioToBrowserDirectory(target, await exportItem(blob), blob, { permissionGranted: true })
    ).resolves.toMatchObject({ alreadyExported: false })

    expect(root.requestPermissionCalls).toBe(0)
  })

  it("keeps exports retryable when the temp audio write fails", async () => {
    const root = new MemoryDirectoryHandle("Exports", { failWrite: (name) => name.endsWith(".part") })
    const target = targetRecord(root)
    const blob = new Blob(["audio"], { type: "audio/mpeg" })

    await expect(
      exportGeneratedAudioToBrowserDirectory(target, await exportItem(blob, { sha256: null }), blob)
    ).rejects.toBeInstanceOf(
      BrowserArchiveExportWriteError
    )

    const archiveRoot = root.directory("Voice Clone Lab Archive")
    const audioDirectory = archiveRoot.directory("generated-audio").directory("2026").directory("07")
    expect(audioDirectory.files.size).toBe(0)
  })

  it("writes audio before sidecar and leaves failed sidecars retryable", async () => {
    const root = new MemoryDirectoryHandle("Exports", { failWrite: (name) => name.endsWith(".json.part") })
    const target = targetRecord(root)
    const blob = new Blob(["audio"], { type: "audio/mpeg" })
    const item = await exportItem(blob, { sha256: null })
    const expectedFilename = `20260701T184522Z--default-voice--eleven-multilingual-v2--${(
      await sha256Blob(blob)
    ).slice(0, 8)}.mp3`

    await expect(exportGeneratedAudioToBrowserDirectory(target, item, blob)).rejects.toBeInstanceOf(
      BrowserArchiveExportWriteError
    )

    const archiveRoot = root.directory("Voice Clone Lab Archive")
    const audioDirectory = archiveRoot.directory("generated-audio").directory("2026").directory("07")
    expect(await (await audioDirectory.file(expectedFilename)).text()).toBe("audio")
    expect(audioDirectory.files.has(expectedFilename.replace(".mp3", ".json"))).toBe(false)
  })

  it("uses the next deterministic filename when a different audio file already exists", async () => {
    const root = new MemoryDirectoryHandle("Exports")
    const target = targetRecord(root)
    const blob = new Blob(["audio"], { type: "audio/mpeg" })
    const item = await exportItem(blob, { sha256: "abcdef123456" })
    const archiveRoot = await root.getDirectoryHandle("Voice Clone Lab Archive", { create: true })
    const audioDirectory = await getOrCreateDirectory(archiveRoot, ["generated-audio", "2026", "07"])
    await audioDirectory.putFile(
      "20260701T184522Z--default-voice--eleven-multilingual-v2--abcdef12.mp3",
      new Blob(["other"], { type: "audio/mpeg" })
    )

    const result = await exportGeneratedAudioToBrowserDirectory(target, item, blob)

    expect(result.filename).toBe(
      "generated-audio/2026/07/20260701T184522Z--default-voice--eleven-multilingual-v2--abcdef12--audio-id.mp3"
    )
  })

  it("treats an existing file with the same hash as already exported", async () => {
    const root = new MemoryDirectoryHandle("Exports")
    const target = targetRecord(root)
    const blob = new Blob(["audio"], { type: "audio/mpeg" })
    const item = await exportItem(blob)
    const expectedFilename = `20260701T184522Z--default-voice--eleven-multilingual-v2--${item.sha256?.slice(0, 8)}.mp3`
    const archiveRoot = await root.getDirectoryHandle("Voice Clone Lab Archive", { create: true })
    const audioDirectory = await getOrCreateDirectory(archiveRoot, ["generated-audio", "2026", "07"])
    await audioDirectory.putFile(expectedFilename, blob)

    const result = await exportGeneratedAudioToBrowserDirectory(target, item, blob)

    expect(result.alreadyExported).toBe(true)
    expect(result.filename).toBe(`generated-audio/2026/07/${expectedFilename}`)
  })

  it("uses computed hashes to keep legacy hashless exports idempotent", async () => {
    const root = new MemoryDirectoryHandle("Exports")
    const target = targetRecord(root)
    const blob = new Blob(["audio"], { type: "audio/mpeg" })
    const item = await exportItem(blob, { sha256: null })
    const expectedSha256 = await sha256Blob(blob)

    const firstResult = await exportGeneratedAudioToBrowserDirectory(target, item, blob)
    const retryResult = await exportGeneratedAudioToBrowserDirectory(target, item, blob)

    expect(firstResult.sha256).toBe(expectedSha256)
    expect(retryResult.alreadyExported).toBe(true)
    expect(retryResult.filename).toBe(firstResult.filename)
    const archiveRoot = root.directory("Voice Clone Lab Archive")
    const audioDirectory = archiveRoot.directory("generated-audio").directory("2026").directory("07")
    const audioFiles = [...audioDirectory.files.keys()].filter((filename) => filename.endsWith(".mp3"))
    expect(audioFiles).toEqual([firstResult.filename.split("/").at(-1)])
  })
})

async function exportItem(blob: Blob, overrides: Partial<GeneratedAudioExportable> = {}): Promise<GeneratedAudioExportable> {
  return {
    appVoiceId: "default",
    cacheState: "miss",
    characterCount: 12,
    contentType: "audio/mpeg",
    createdAt: "2026-07-01T18:45:22.000Z",
    generationElapsedMs: 1234,
    id: "audio-id",
    modelId: "Eleven Multilingual v2",
    multiVoiceMetadata: null,
    providerId: "elevenlabs",
    requestId: "req_123",
    sha256: await sha256Blob(blob),
    sizeBytes: blob.size,
    tuningMetadata: null,
    voiceId: "provider-voice",
    voiceName: "Default Voice",
    ...overrides,
  }
}

function targetRecord(handle: MemoryDirectoryHandle): BrowserArchiveExportTargetRecord {
  return {
    handle,
    handleId: "handle-1",
    id: "selected-browser-directory",
    name: handle.name,
    selectedAt: "2026-07-01T18:45:22.000Z",
    updatedAt: "2026-07-01T18:45:22.000Z",
  }
}

async function getOrCreateDirectory(root: BrowserFileSystemDirectoryHandle, names: string[]) {
  let current = root
  for (const name of names) {
    current = await current.getDirectoryHandle(name, { create: true })
  }
  return current as MemoryDirectoryHandle
}

type MemoryDirectoryOptions = {
  failWrite?: (name: string) => boolean
  permission?: BrowserArchiveExportPermissionState
  requestPermission?: BrowserArchiveExportPermissionState
}

class MemoryDirectoryHandle implements BrowserFileSystemDirectoryHandle {
  readonly directories = new Map<string, MemoryDirectoryHandle>()
  readonly files = new Map<string, MemoryFileHandle>()
  readonly kind = "directory"
  readonly name: string
  requestPermissionCalls = 0
  private permission: BrowserArchiveExportPermissionState
  private readonly requestPermissionResult: BrowserArchiveExportPermissionState
  private readonly failWrite: (name: string) => boolean

  constructor(name: string, options: MemoryDirectoryOptions = {}) {
    this.failWrite = options.failWrite ?? (() => false)
    this.name = name
    this.permission = options.permission ?? "granted"
    this.requestPermissionResult = options.requestPermission ?? this.permission
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const existing = this.directories.get(name)
    if (existing) {
      return existing
    }
    if (!options.create) {
      throw new DOMException("Directory not found.", "NotFoundError")
    }
    const next = new MemoryDirectoryHandle(name, {
      failWrite: this.failWrite,
      permission: this.permission,
      requestPermission: this.requestPermissionResult,
    })
    this.directories.set(name, next)
    return next
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    const existing = this.files.get(name)
    if (existing) {
      return existing
    }
    if (!options.create) {
      throw new DOMException("File not found.", "NotFoundError")
    }
    const next = new MemoryFileHandle(name, this.failWrite)
    this.files.set(name, next)
    return next
  }

  async removeEntry(name: string) {
    this.files.delete(name)
    this.directories.delete(name)
  }

  async queryPermission() {
    return this.permission
  }

  async requestPermission() {
    this.requestPermissionCalls += 1
    this.permission = this.requestPermissionResult
    return this.permission
  }

  directory(name: string) {
    const directory = this.directories.get(name)
    if (!directory) {
      throw new Error(`Directory ${name} was not found.`)
    }
    return directory
  }

  async putFile(name: string, blob: Blob) {
    const handle = await this.getFileHandle(name, { create: true })
    await handle.writeBlob(blob)
  }

  async file(name: string) {
    const handle = this.files.get(name)
    if (!handle) {
      throw new Error(`File ${name} was not found.`)
    }
    return handle.getFile()
  }
}

class MemoryFileHandle implements BrowserFileSystemFileHandle {
  readonly kind = "file"
  readonly name: string
  private blob = new Blob([])
  private readonly failWrite: (name: string) => boolean

  constructor(name: string, failWrite: (name: string) => boolean) {
    this.failWrite = failWrite
    this.name = name
  }

  async getFile() {
    return new File([this.blob], this.name, { type: this.blob.type })
  }

  async createWritable(): Promise<BrowserFileSystemWritableFileStream> {
    if (this.failWrite(this.name)) {
      throw new Error(`Write failed for ${this.name}.`)
    }
    const chunks: Array<Blob | string> = []
    return {
      abort: async () => {
        chunks.length = 0
      },
      close: async () => {
        this.blob = new Blob(chunks)
      },
      write: async (data: Blob | string) => {
        chunks.push(data)
      },
    }
  }

  async writeBlob(blob: Blob) {
    this.blob = blob
  }
}
