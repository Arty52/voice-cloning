import { describe, expect, it } from "vitest"

import {
  loadNaturalHandoffsPreference,
  NATURAL_HANDOFFS_STORAGE_KEY,
  saveNaturalHandoffsPreference,
} from "./natural-handoffs-preference"

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

class ReadFailingStorage extends MemoryStorage {
  override getItem(key: string): string | null {
    void key
    throw new Error("storage unavailable")
  }
}

describe("natural handoffs preference storage", () => {
  it("defaults to enabled when no preference is stored", () => {
    expect(loadNaturalHandoffsPreference(new MemoryStorage())).toBe(true)
  })

  it("loads stored enabled and disabled preferences", () => {
    const storage = new MemoryStorage()

    storage.setItem(NATURAL_HANDOFFS_STORAGE_KEY, "false")
    expect(loadNaturalHandoffsPreference(storage)).toBe(false)

    storage.setItem(NATURAL_HANDOFFS_STORAGE_KEY, "true")
    expect(loadNaturalHandoffsPreference(storage)).toBe(true)
  })

  it("saves boolean preferences as string values", () => {
    const storage = new MemoryStorage()

    expect(saveNaturalHandoffsPreference(false, storage)).toBe(false)
    expect(storage.getItem(NATURAL_HANDOFFS_STORAGE_KEY)).toBe("false")

    expect(saveNaturalHandoffsPreference(true, storage)).toBe(true)
    expect(storage.getItem(NATURAL_HANDOFFS_STORAGE_KEY)).toBe("true")
  })

  it("ignores invalid stored values", () => {
    const storage = new MemoryStorage()
    storage.setItem(NATURAL_HANDOFFS_STORAGE_KEY, "nope")

    expect(loadNaturalHandoffsPreference(storage)).toBe(true)
  })

  it("defaults to enabled when browser storage cannot be read", () => {
    expect(loadNaturalHandoffsPreference(new ReadFailingStorage())).toBe(true)
  })
})
