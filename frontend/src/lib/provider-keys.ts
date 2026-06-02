export const PROVIDER_KEYS_STORAGE_KEY = "voice-cloning.providerKeys.v1"

export type StoredProviderKeys = Record<string, string>

export function loadStoredProviderKeys(storage: Storage = window.localStorage): StoredProviderKeys {
  try {
    const rawValue = storage.getItem(PROVIDER_KEYS_STORAGE_KEY)
    if (!rawValue) {
      return {}
    }
    const parsed = JSON.parse(rawValue) as unknown
    if (!isStoredProviderKeys(parsed)) {
      return {}
    }
    return parsed
  } catch {
    return {}
  }
}

export function saveStoredProviderKeys(keys: StoredProviderKeys, storage: Storage = window.localStorage) {
  const sanitized = sanitizeProviderKeys(keys)
  if (Object.keys(sanitized).length === 0) {
    storage.removeItem(PROVIDER_KEYS_STORAGE_KEY)
    return sanitized
  }
  storage.setItem(PROVIDER_KEYS_STORAGE_KEY, JSON.stringify(sanitized))
  return sanitized
}

export function setStoredProviderKey(
  keys: StoredProviderKeys,
  providerId: string,
  apiKey: string,
): StoredProviderKeys {
  const trimmedProviderId = providerId.trim()
  const trimmedApiKey = apiKey.trim()
  const nextKeys = { ...keys }
  if (!trimmedProviderId) {
    return sanitizeProviderKeys(nextKeys)
  }
  if (trimmedApiKey) {
    nextKeys[trimmedProviderId] = trimmedApiKey
  } else {
    delete nextKeys[trimmedProviderId]
  }
  return sanitizeProviderKeys(nextKeys)
}

export function clearStoredProviderKey(keys: StoredProviderKeys, providerId: string): StoredProviderKeys {
  const nextKeys = { ...keys }
  delete nextKeys[providerId]
  return sanitizeProviderKeys(nextKeys)
}

function sanitizeProviderKeys(keys: StoredProviderKeys): StoredProviderKeys {
  return Object.fromEntries(
    Object.entries(keys)
      .map(([providerId, apiKey]) => [providerId.trim(), apiKey.trim()])
      .filter(([providerId, apiKey]) => providerId.length > 0 && apiKey.length > 0)
  )
}

function isStoredProviderKeys(value: unknown): value is StoredProviderKeys {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  return Object.entries(value).every(([providerId, apiKey]) => providerId.length > 0 && typeof apiKey === "string")
}
