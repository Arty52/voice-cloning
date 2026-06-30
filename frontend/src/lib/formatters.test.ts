import { describe, expect, it } from "vitest"

import {
  formatCompactBytes,
  formatElapsedTime,
  formatExactBytes,
  formatGenerationElapsedTime,
  formatMediaDuration,
} from "./formatters"

const formatTestNumber = (value: number) => new Intl.NumberFormat().format(value)

describe("formatElapsedTime", () => {
  it("formats sub-second durations", () => {
    expect(formatElapsedTime(0)).toBe("0s")
    expect(formatElapsedTime(42)).toBe("< 0.1s")
    expect(formatElapsedTime(850)).toBe("0.9s")
  })

  it("formats second-scale durations", () => {
    expect(formatElapsedTime(1_000)).toBe("1s")
    expect(formatElapsedTime(1234)).toBe("1.2s")
    expect(formatElapsedTime(9_999)).toBe("10s")
    expect(formatElapsedTime(12_300)).toBe("12s")
  })

  it("formats minute-scale durations", () => {
    expect(formatElapsedTime(65_000)).toBe("1m 5s")
  })
})

describe("formatGenerationElapsedTime", () => {
  it("preserves generation elapsed labels through the shared formatter", () => {
    expect(formatGenerationElapsedTime(850)).toBe("0.9s")
    expect(formatGenerationElapsedTime(12_300)).toBe("12s")
    expect(formatGenerationElapsedTime(65_000)).toBe("1m 5s")
  })
})

describe("formatMediaDuration", () => {
  it("formats media positions as compact human-readable units", () => {
    expect(formatMediaDuration(0)).toBe("0s")
    expect(formatMediaDuration(39)).toBe("39s")
    expect(formatMediaDuration(365)).toBe("6m 5s")
    expect(formatMediaDuration(367 * 60)).toBe("6h 7m")
    expect(formatMediaDuration(373 * 60 + 5)).toBe("6h 13m 5s")
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
    expect(formatExactBytes(898_656)).toBe(`${formatTestNumber(898_656)} bytes`)
  })
})
