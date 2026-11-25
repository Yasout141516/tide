import { useSyncExternalStore } from 'react'

// Stable identities per query: React resubscribes whenever `subscribe` changes.
const subscribers = new Map<string, (onChange: () => void) => () => void>()

function subscriberFor(query: string): (onChange: () => void) => () => void {
  let s = subscribers.get(query)
  if (!s) {
    s = (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    subscribers.set(query, s)
  }
  return s
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(subscriberFor(query), () => window.matchMedia(query).matches)
}
