import { describe, expect, it, vi } from 'vitest'
import { PlayingBlocker, releaseWhenRendererLost, type SaveBlocker } from '../../src/main/playing'

function fakeBlocker(): SaveBlocker & {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  isStarted: ReturnType<typeof vi.fn>
} {
  const live = new Set<number>()
  let next = 7
  return {
    start: vi.fn(() => {
      live.add(next)
      return next++
    }),
    stop: vi.fn((id: number) => live.delete(id)),
    isStarted: vi.fn((id: number) => live.has(id))
  }
}

describe('PlayingBlocker', () => {
  it('starts once while playing and stops on pause and dispose', () => {
    const b = fakeBlocker()
    const p = new PlayingBlocker(b)
    p.set(true)
    p.set(true)
    expect(b.start).toHaveBeenCalledTimes(1)
    expect(b.start).toHaveBeenCalledWith('prevent-app-suspension')
    p.set(false)
    expect(b.stop).toHaveBeenCalledWith(7)
    p.set(false)
    expect(b.stop).toHaveBeenCalledTimes(1)
    p.set(true)
    expect(b.start).toHaveBeenCalledTimes(2)
    p.dispose()
    expect(b.stop).toHaveBeenLastCalledWith(8)
    p.dispose()
    expect(b.stop).toHaveBeenCalledTimes(2)
  })
})

describe('releaseWhenRendererLost', () => {
  function setup(): {
    b: ReturnType<typeof fakeBlocker>
    p: PlayingBlocker
    emit: (event: string, ...args: unknown[]) => void
  } {
    const b = fakeBlocker()
    const p = new PlayingBlocker(b)
    const handlers = new Map<string, (...a: unknown[]) => void>()
    releaseWhenRendererLost(
      { on: (e: string, fn: (...a: unknown[]) => void) => handlers.set(e, fn) } as never,
      p
    )
    p.set(true)
    return { b, p, emit: (e, ...a) => handlers.get(e)?.(...a) }
  }

  it('releases when the renderer process dies', () => {
    const { b, emit } = setup()
    emit('render-process-gone', {}, { reason: 'crashed' })
    expect(b.stop).toHaveBeenCalledWith(7)
  })

  it('releases when the page starts a new navigation (reload)', () => {
    const { b, emit } = setup()
    emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(b.stop).toHaveBeenCalledWith(7)
  })

  it('stays on for sub-frame and same-document navigations', () => {
    const { b, emit } = setup()
    emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    expect(b.stop).not.toHaveBeenCalled()
  })

  it('a later play after the reload starts the blocker again', () => {
    const { b, p, emit } = setup()
    emit('render-process-gone')
    p.set(true)
    expect(b.start).toHaveBeenCalledTimes(2)
  })
})
