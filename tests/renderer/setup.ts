import { afterEach, beforeEach } from 'vitest'

// This file is a setupFile for every test, including node-env unit tests: only touch the DOM
// when a test opted in to jsdom.
type Listener = (e: { matches: boolean }) => void
const NARROW = '(max-width: 1099px)'
let narrow = false
const listeners = new Set<{ query: string; fn: Listener }>()

/** Drives every `(max-width: 1099px)` matchMedia query: true = narrow window. */
export function setNarrow(on: boolean): void {
  narrow = on
  for (const l of listeners) if (l.query === NARROW) l.fn({ matches: on })
}

class ResizeObserverStub {
  observe(): void {
    // no-op
  }
  unobserve(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}

beforeEach(() => {
  if (typeof window === 'undefined') return
  narrow = false
  listeners.clear()
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === NARROW ? narrow : false
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: Listener) => listeners.add({ query, fn }),
    removeEventListener: (_: string, fn: Listener) => {
      for (const l of listeners) if (l.fn === fn) listeners.delete(l)
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
})

afterEach(async () => {
  if (typeof window === 'undefined') return
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})
