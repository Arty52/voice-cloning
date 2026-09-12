/** Workspace IDs are local identities, not security tokens. Support plain-HTTP LAN hosts. */
export function createDialogueIdentity(): string {
  return window.crypto?.randomUUID?.() ?? `dialogue-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
