import { describe, expect, it, vi } from 'vitest'
import { PlayingBlocker, type SaveBlocker } from '../../src/main/playing'

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
