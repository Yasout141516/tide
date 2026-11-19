/** Media keys and the OS "Now Playing" card. A no-op where the browser has no MediaSession. */
export interface MediaHandlers {
  play(): void
  pause(): void
  back(): void
  forward(): void
}

type Action = MediaSessionAction

export function bindMediaSession(
  ms: MediaSession | undefined,
  meta: { title: string; artist: string } | null,
  h: MediaHandlers
): () => void {
  if (!ms) return () => {}
  const actions: [Action, () => void][] = [
    ['play', h.play],
    ['pause', h.pause],
    ['seekbackward', h.back],
    ['previoustrack', h.back],
    ['seekforward', h.forward],
    ['nexttrack', h.forward]
  ]
  const set = (a: Action, fn: (() => void) | null): void => {
    try {
      ms.setActionHandler(a, fn)
    } catch {
      // An action this platform doesn't know is simply not offered.
    }
  }
  if (meta && typeof MediaMetadata !== 'undefined') ms.metadata = new MediaMetadata(meta)
  for (const [a, fn] of actions) set(a, fn)
  return () => {
    for (const [a] of actions) set(a, null)
    ms.metadata = null
  }
}
