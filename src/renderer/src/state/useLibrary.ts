import { useSyncExternalStore } from 'react'
import type { TideApi } from '../../../preload/index.d'
import type { LibrarySnapshot } from '../../../shared/library/types'
import { tide } from '../lib/tide'

interface Store {
  snapshot: LibrarySnapshot | null
  listeners: Set<() => void>
  stop: (() => void) | null
  ready: boolean
}

// One store per bridge, so tests that install a fresh fake never see another test's library.
const stores = new WeakMap<TideApi, Store>()

function storeFor(api: TideApi): Store {
  let s = stores.get(api)
  if (!s) {
    s = { snapshot: null, listeners: new Set(), stop: null, ready: false }
    stores.set(api, s)
  }
  return s
}

function start(api: TideApi, s: Store): void {
  const publish = (next: LibrarySnapshot): void => {
    s.snapshot = next
    for (const l of [...s.listeners]) l()
  }
  const off = api.library.onChanged(publish)
  let stopped = false
  s.stop = () => {
    stopped = true
    off()
  }
  api.library
    .get()
    .then((first) => {
      // A push that arrived while the first get was in flight is newer: keep it.
      if (!stopped && s.snapshot === null) publish(first)
    })
    .catch(() => {
      // Stay on the loading state; the next library change will fill it in.
    })
    .finally(() => {
      // The library state has mounted: main may now send queued commands (once).
      if (!s.ready) {
        s.ready = true
        api.ready()
      }
    })
}

/** The whole library as the renderer sees it, or null until the first load. Also signals `ready()` to main once. */
export function useLibrary(): LibrarySnapshot | null {
  const api = tide()
  const s = storeFor(api)
  return useSyncExternalStore(
    (cb) => {
      s.listeners.add(cb)
      if (!s.stop) start(api, s)
      return () => {
        s.listeners.delete(cb)
        if (s.listeners.size === 0) {
          s.stop?.()
          s.stop = null
        }
      }
    },
    () => s.snapshot
  )
}
