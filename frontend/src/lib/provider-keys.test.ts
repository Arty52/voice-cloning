import { describe, expect, it } from "vitest"

import {
  clearStoredProviderKey,
  loadStoredProviderKeys,
  PROVIDER_KEYS_STORAGE_KEY,
  saveStoredProviderKeys,
  setStoredProviderKey,
} from "./provider-keys"

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe("provider key storage", () => {
  it("saves trimmed provider keys and omits empty values", () => {
    const storage = new MemoryStorage()
    const keys = saveStoredProviderKeys({ elevenlabs: " key ", empty: "   " }, storage)

    expect(keys).toEqual({ elevenlabs: "key" })
    expect(loadStoredProviderKeys(storage)).toEqual({ elevenlabs: "key" })
  })

  it("normalizes provider keys loaded from storage", () => {
    const storage = new MemoryStorage()
    storage.setItem(PROVIDER_KEYS_STORAGE_KEY, JSON.stringify({ " elevenlabs ": " key ", empty: "   " }))

    expect(loadStoredProviderKeys(storage)).toEqual({ elevenlabs: "key" })
  })

  it("removes storage when the last provider key is cleared", () => {
    const storage = new MemoryStorage()
    const withKey = setStoredProviderKey({}, "elevenlabs", "browser-key")
    saveStoredProviderKeys(withKey, storage)

    const withoutKey = clearStoredProviderKey(withKey, " elevenlabs ")
    saveStoredProviderKeys(withoutKey, storage)

    expect(storage.getItem(PROVIDER_KEYS_STORAGE_KEY)).toBeNull()
    expect(loadStoredProviderKeys(storage)).toEqual({})
  })

  it("ignores invalid stored payloads", () => {
    const storage = new MemoryStorage()
    storage.setItem(PROVIDER_KEYS_STORAGE_KEY, JSON.stringify(["not", "a", "map"]))

    expect(loadStoredProviderKeys(storage)).toEqual({})
  })
})
