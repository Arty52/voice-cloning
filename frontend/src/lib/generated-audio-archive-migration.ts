export const GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY = "voice-clone-generated-audio-archive-imported-ids"
export const GENERATED_AUDIO_ARCHIVE_CLEARED_IDS_KEY = "voice-clone-generated-audio-archive-cleared-ids"
export const GENERATED_AUDIO_ARCHIVE_CONFLICT_IDS_KEY = "voice-clone-generated-audio-archive-conflict-ids"

export type GeneratedAudioArchiveMigrationState = {
  clearedIds: Set<string>
  conflictIds: Set<string>
  importedIds: Set<string>
}

export function readGeneratedAudioArchiveMigrationState(): GeneratedAudioArchiveMigrationState {
  return {
    clearedIds: readIdSet(GENERATED_AUDIO_ARCHIVE_CLEARED_IDS_KEY),
    conflictIds: readIdSet(GENERATED_AUDIO_ARCHIVE_CONFLICT_IDS_KEY),
    importedIds: readIdSet(GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY),
  }
}

export function markGeneratedAudioArchiveImported(ids: Iterable<string>) {
  appendIds(GENERATED_AUDIO_ARCHIVE_IMPORTED_IDS_KEY, ids)
}

export function markGeneratedAudioArchiveCleared(ids: Iterable<string>) {
  appendIds(GENERATED_AUDIO_ARCHIVE_CLEARED_IDS_KEY, ids)
}

export function markGeneratedAudioArchiveConflicted(ids: Iterable<string>) {
  appendIds(GENERATED_AUDIO_ARCHIVE_CONFLICT_IDS_KEY, ids)
}

function appendIds(key: string, ids: Iterable<string>) {
  const nextIds = readIdSet(key)
  for (const id of ids) {
    if (id) {
      nextIds.add(id)
    }
  }
  window.localStorage.setItem(key, JSON.stringify([...nextIds].sort()))
}

function readIdSet(key: string) {
  const rawValue = window.localStorage.getItem(key)
  if (!rawValue) {
    return new Set<string>()
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) {
      return new Set<string>()
    }
    return new Set(parsed.filter((value): value is string => typeof value === "string" && value.length > 0))
  } catch {
    return new Set<string>()
  }
}
