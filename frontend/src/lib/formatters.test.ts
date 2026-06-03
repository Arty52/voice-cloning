import { describe, expect, it } from "vitest"

import { formatGenerationElapsedTime } from "./formatters"

describe("formatGenerationElapsedTime", () => {
  it("formats sub-second durations", () => {
    expect(formatGenerationElapsedTime(0)).toBe("0s")
    expect(formatGenerationElapsedTime(42)).toBe("< 0.1s")
    expect(formatGenerationElapsedTime(850)).toBe("0.9s")
  })

  it("formats second-scale durations", () => {
    expect(formatGenerationElapsedTime(1234)).toBe("1.2s")
    expect(formatGenerationElapsedTime(12_300)).toBe("12s")
  })

  it("formats minute-scale durations", () => {
    expect(formatGenerationElapsedTime(65_000)).toBe("1m 5s")
  })
})
