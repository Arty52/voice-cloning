import { describe, expect, it } from "vitest"

import { formatCompactBytes, formatExactBytes, formatGenerationElapsedTime } from "./formatters"

describe("formatGenerationElapsedTime", () => {
  it("formats sub-second durations", () => {
    expect(formatGenerationElapsedTime(0)).toBe("0s")
    expect(formatGenerationElapsedTime(42)).toBe("< 0.1s")
    expect(formatGenerationElapsedTime(850)).toBe("0.9s")
  })

  it("formats second-scale durations", () => {
    expect(formatGenerationElapsedTime(1_000)).toBe("1s")
    expect(formatGenerationElapsedTime(1234)).toBe("1.2s")
    expect(formatGenerationElapsedTime(9_999)).toBe("10s")
    expect(formatGenerationElapsedTime(12_300)).toBe("12s")
  })

  it("formats minute-scale durations", () => {
    expect(formatGenerationElapsedTime(65_000)).toBe("1m 5s")
  })
})

describe("formatCompactBytes", () => {
  it("formats byte-scale values", () => {
    expect(formatCompactBytes(0)).toBe("0 B")
    expect(formatCompactBytes(1)).toBe("1 B")
    expect(formatCompactBytes(512)).toBe("512 B")
  })

  it("formats kibibyte-scale values as compact KB labels", () => {
    expect(formatCompactBytes(1_024)).toBe("1 KB")
    expect(formatCompactBytes(898_656)).toBe("878 KB")
  })

  it("formats mebibyte-scale values as compact MB labels", () => {
    expect(formatCompactBytes(1_048_576)).toBe("1 MB")
    expect(formatCompactBytes(1_258_291)).toBe("1.2 MB")
  })
})

describe("formatExactBytes", () => {
  it("formats exact byte counts", () => {
    expect(formatExactBytes(0)).toBe("0 bytes")
    expect(formatExactBytes(1)).toBe("1 byte")
    expect(formatExactBytes(898_656)).toBe("898,656 bytes")
  })
})
