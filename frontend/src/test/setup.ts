import "@testing-library/jest-dom/vitest"
import "fake-indexeddb/auto"

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub
