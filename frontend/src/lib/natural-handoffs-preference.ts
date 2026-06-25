export const NATURAL_HANDOFFS_STORAGE_KEY = "voice-cloning.naturalHandoffs.v1"

export function loadNaturalHandoffsPreference(storage: Storage = window.localStorage): boolean {
  try {
    const storedValue = storage.getItem(NATURAL_HANDOFFS_STORAGE_KEY)
    if (storedValue === "false") {
      return false
    }
    if (storedValue === "true") {
      return true
    }
    return true
  } catch {
    return true
  }
}

export function saveNaturalHandoffsPreference(
  enabled: boolean,
  storage: Storage = window.localStorage
): boolean {
  storage.setItem(NATURAL_HANDOFFS_STORAGE_KEY, String(enabled))
  return enabled
}
