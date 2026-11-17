import type { TideApi } from '../../../preload/index.d'

let api: TideApi | null = null

/** The preload bridge. Components call this instead of touching `window.tide`. */
export function tide(): TideApi {
  const a = api ?? (typeof window === 'undefined' ? null : window.tide)
  if (!a) throw new Error('window.tide is not available')
  return a
}

/** Install a replacement bridge (tests). */
export function setTide(next: TideApi): void {
  api = next
}
