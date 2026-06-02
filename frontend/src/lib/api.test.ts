import { describe, expect, it } from "vitest"

import { providerHeaders, VOICE_PROVIDER_KEY_HEADER } from "./api"

describe("provider request headers", () => {
  it("adds the provider key header when a browser key is available", () => {
    expect(providerHeaders({ providerKey: " browser-key " })).toEqual({
      [VOICE_PROVIDER_KEY_HEADER]: "browser-key",
    })
  })

  it("omits provider headers when no browser key is available", () => {
    expect(providerHeaders({ providerKey: null })).toBeUndefined()
    expect(providerHeaders({ providerKey: "   " })).toBeUndefined()
  })
})
