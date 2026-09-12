import { afterEach, expect, it, vi } from "vitest"
import { createDialogueIdentity } from "./dialogue-identity"

afterEach(() => vi.unstubAllGlobals())

it("creates distinct identities on HTTP hosts without randomUUID", () => {
  vi.stubGlobal("crypto", { randomUUID: undefined })
  const first = createDialogueIdentity()
  expect(first).toMatch(/^dialogue-[A-Za-z0-9-]+$/)
  expect(createDialogueIdentity()).not.toBe(first)
})

it("uses browser UUIDs when available", () => {
  const randomUUID = vi.fn(() => "secure-uuid")
  vi.stubGlobal("crypto", { randomUUID })
  expect(createDialogueIdentity()).toBe("secure-uuid")
  expect(randomUUID).toHaveBeenCalledOnce()
})
