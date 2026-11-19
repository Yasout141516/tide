import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindMediaSession } from '../../../src/renderer/src/player/media-session'

class FakeMetadata {
  constructor(public init: { title: string; artist: string }) {}
}

function fakeSession(): {
  ms: MediaSession
  handlers: Map<string, (() => void) | null>
} {
  const handlers = new Map<string, (() => void) | null>()
  const ms = {
    metadata: null as unknown,
    playbackState: 'none',
    setActionHandler: (a: string, h: (() => void) | null) => void handlers.set(a, h)
  } as unknown as MediaSession
  return { ms, handlers }
}

describe('bindMediaSession', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('binds metadata and the four actions, and clears them on cleanup', () => {
    vi.stubGlobal('MediaMetadata', FakeMetadata)
    const { ms, handlers } = fakeSession()
    const h = { play: vi.fn(), pause: vi.fn(), back: vi.fn(), forward: vi.fn() }
    const off = bindMediaSession(ms, { title: 'Memory', artist: 'Tide' }, h)
    expect((ms.metadata as unknown as FakeMetadata).init).toEqual({
      title: 'Memory',
      artist: 'Tide'
    })
    for (const a of ['play', 'pause', 'seekbackward', 'previoustrack', 'seekforward', 'nexttrack'])
      handlers.get(a)?.()
    expect(h.play).toHaveBeenCalledTimes(1)
    expect(h.pause).toHaveBeenCalledTimes(1)
    expect(h.back).toHaveBeenCalledTimes(2)
    expect(h.forward).toHaveBeenCalledTimes(2)
    off()
    for (const a of ['play', 'pause', 'seekbackward', 'previoustrack', 'seekforward', 'nexttrack'])
      expect(handlers.get(a)).toBeNull()
    expect(ms.metadata).toBeNull()
  })

  it('does nothing without a MediaSession', () => {
    const off = bindMediaSession(undefined, null, {
      play: vi.fn(),
      pause: vi.fn(),
      back: vi.fn(),
      forward: vi.fn()
    })
    expect(() => off()).not.toThrow()
  })
})
