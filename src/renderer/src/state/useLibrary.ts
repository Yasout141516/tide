import { useSyncExternalStore } from 'react'
import type { TideApi } from '../../../preload/index.d'
import type { LibrarySnapshot } from '../../../shared/library/types'
import { tide } from '../lib/tide'

interface Store {
  snapshot: LibrarySnapshot | null
  listeners: Set<() => void>
  stop: (() => void) | null
  ready: boolean
  // Stable identities: React resubscribes whenever `subscribe` changes.
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => LibrarySnapshot | null
}

// One store per bridge, so tests that install a fresh fake never see another test's library.
const stores = new WeakMap<TideApi, Store>()

function start(api: TideApi, s: Store): void {
  let stopped = false
  let pushed = false
  const publish = (next: LibrarySnapshot): void => {
    s.snapshot = next
    for (const l of [...s.listeners]) l()
  }
  const off = api.library.onChanged((next) => {
    pushed = true
    publish(next)
  })
  s.stop = () => {
    stopped = true
    off()
  }
  api.library
    .get()
    .then((first) => {
      // A push that arrived while this get was in flight is newer: keep it.
      if (!stopped && !pushed) publish(first)
    })
    .catch(() => {
      // Stay on the current state; the next library change will fill it in.
    })
    .finally(() => {
      // The library state has mounted: main may now send queued commands (once).
      if (!s.ready) {
        s.ready = true
        api.ready()
      }
    })
}

function storeFor(api: TideApi): Store {
  let s = stores.get(api)
  if (!s) {
    const store: Store = {
      snapshot: null,
      listeners: new Set(),
      stop: null,
      ready: false,
      subscribe: (cb) => {
        store.listeners.add(cb)
        if (!store.stop) start(api, store)
        return () => {
          store.listeners.delete(cb)
          if (store.listeners.size === 0) {
            store.stop?.()
            store.stop = null
          }
        }
      },
      getSnapshot: () => store.snapshot
    }
    stores.set(api, store)
    s = store
  }
  return s
}

/** The whole library as the renderer sees it, or null until the first load. Also signals `ready()` to main once. */
export function useLibrary(): LibrarySnapshot | null {
  const s = storeFor(tide())
  return useSyncExternalStore(s.subscribe, s.getSnapshot)
}
