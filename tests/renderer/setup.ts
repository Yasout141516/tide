import { afterEach, beforeEach, vi } from 'vitest'
import type { TideApi } from '../../src/preload/index.d'
import type { AppCommand } from '../../src/shared/ipc-types'
import type { LibrarySnapshot } from '../../src/shared/library/types'

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

class IntersectionObserverStub {
  observe(): void {
    // no-op: the render window starts around the anchor page, which is all the tests need
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
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver
  Element.prototype.scrollIntoView = () => {}
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

type Call = Record<string, unknown[][]>

/**
 * In-memory stand-in for the preload bridge. `library.*` methods are vi.fns that update the snapshot and
 * fire `onChanged`; install it with `setTide()`. `emit` plays a menu command; `calls` records every call.
 */
export function fakeTide(
  init: { snapshot?: Partial<LibrarySnapshot>; platform?: string } = {}
): TideApi & { emit(c: AppCommand): void; calls: Call } {
  let snap: LibrarySnapshot = {
    courses: [],
    readings: [],
    settings: {
      reading: {
        skipHeadersFooters: true,
        skipFootnotes: true,
        stopAtReferences: true,
        skipCaptionsTables: true,
        skipCoverPages: true,
        readCitations: false
      },
      zoom: 1,
      voice: 'bf_emma',
      speed: 1
    },
    ui: { collapsed: [], tipsSeen: [] },
    ...init.snapshot
  }
  const calls: Call = {}
  const changed = new Set<(s: LibrarySnapshot) => void>()
  const commands = new Set<(c: AppCommand) => void>()
  const set = (next: LibrarySnapshot): void => {
    snap = next
    for (const cb of [...changed]) cb(snap)
  }
  const fn = <A extends unknown[], R>(name: string, impl: (...a: A) => R): ((...a: A) => R) =>
    vi.fn((...a: A): R => {
      ;(calls[name] ??= []).push(a)
      return impl(...a)
    })

  return {
    platform: init.platform ?? 'win32',
    ready: fn('ready', () => undefined),
    onCommand: (cb) => {
      commands.add(cb)
      return () => commands.delete(cb)
    },
    emit: (c) => {
      for (const cb of [...commands]) cb(c)
    },
    calls,
    tts: {
      synthesize: fn('tts.synthesize', () => Promise.reject(new Error('no voice in tests'))),
      cancel: fn('tts.cancel', () => Promise.resolve()),
      status: fn('tts.status', () => Promise.resolve('ready' as const)),
      onStatus: () => () => {}
    },
    app: {
      setPlaying: fn('app.setPlaying', () => undefined),
      relaunch: fn('app.relaunch', () => undefined)
    },
    library: {
      get: fn('library.get', () => Promise.resolve(snap)),
      onChanged: (cb) => {
        changed.add(cb)
        return () => changed.delete(cb)
      },
      pickPdf: fn('library.pickPdf', () => Promise.resolve({ kind: 'cancelled' as const })),
      readPdf: fn('library.readPdf', () =>
        Promise.resolve({ ok: true as const, data: new Uint8Array([1]) })
      ),
      add: fn('library.add', (i) => {
        const id = `r${snap.readings.length + 1}`
        set({
          ...snap,
          readings: [
            ...snap.readings,
            {
              id,
              title: i.title,
              courseId: null,
              pageCount: i.pageCount,
              position: null,
              addedAt: 0,
              lastOpenedAt: null,
              finished: false,
              readEverything: false,
              fileName: `${id}.pdf`,
              missing: false
            }
          ]
        })
        return Promise.resolve(id)
      }),
      update: fn('library.update', (id, p) => {
        const { opened, ...rest } = p
        set({
          ...snap,
          readings: snap.readings.map((r) =>
            r.id === id ? { ...r, ...rest, ...(opened ? { lastOpenedAt: 1 } : {}) } : r
          )
        })
        return Promise.resolve()
      }),
      remove: fn('library.remove', (id) => {
        set({ ...snap, readings: snap.readings.filter((r) => r.id !== id) })
        return Promise.resolve()
      }),
      findFile: fn('library.findFile', () => Promise.resolve({ kind: 'cancelled' as const })),
      useDifferentFile: fn('library.useDifferentFile', () => Promise.resolve()),
      setCollapsed: fn('library.setCollapsed', (key, collapsed) => {
        const rest = snap.ui.collapsed.filter((k) => k !== key)
        set({ ...snap, ui: { ...snap.ui, collapsed: collapsed ? [...rest, key] : rest } })
        return Promise.resolve()
      }),
      setZoom: fn('library.setZoom', (zoom) => {
        set({ ...snap, settings: { ...snap.settings, zoom } })
        return Promise.resolve()
      }),
      setVoice: fn('library.setVoice', (voice, speed) => {
        set({ ...snap, settings: { ...snap.settings, voice, speed } })
        return Promise.resolve()
      }),
      flush: fn('library.flush', () => Promise.resolve()),
      tipSeen: fn('library.tipSeen', (key) => {
        if (!snap.ui.tipsSeen.includes(key))
          set({ ...snap, ui: { ...snap.ui, tipsSeen: [...snap.ui.tipsSeen, key] } })
        return Promise.resolve()
      })
    }
  }
}
