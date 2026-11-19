import { describe, expect, it, vi } from 'vitest'
import { SleepTimer, sleepLabel } from '../../../src/renderer/src/player/sleep'

function make(): { t: SleepTimer; fade: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  const fade = vi.fn()
  const stop = vi.fn()
  return { t: new SleepTimer(fade, stop), fade, stop }
}

describe('SleepTimer', () => {
  it('counts down only while playing', () => {
    const { t } = make()
    t.set(10, 1)
    expect(t.state).toEqual({ option: 10, remainingSec: 600 })
    t.tick(30, false)
    expect(t.state.remainingSec).toBe(600)
    t.tick(30, true)
    expect(t.state.remainingSec).toBe(570)
    expect(sleepLabel(t.state)).toBe('Sleep 9:30')
  })

  it('fades over the last five seconds then stops', () => {
    const { t, fade, stop } = make()
    t.set(10, 1)
    t.tick(594, true)
    expect(fade).not.toHaveBeenCalled()
    t.tick(1, true) // 5 s left
    expect(fade).toHaveBeenLastCalledWith(1)
    t.tick(2.5, true)
    expect(fade).toHaveBeenLastCalledWith(0.5)
    t.tick(2, true)
    expect(fade.mock.calls.at(-1)![0]).toBeCloseTo(0.1)
    expect(stop).not.toHaveBeenCalled()
    t.tick(0.5, true)
    expect(fade).toHaveBeenLastCalledWith(0)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(t.state).toEqual({ option: 'off', remainingSec: null })
    t.tick(10, true)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('page option stops after the last sentence of the page it was set on', () => {
    const { t, fade, stop } = make()
    const pageOf = (i: number): number => (i < 3 ? 1 : i < 5 ? 2 : -1)
    t.set('page', 1)
    expect(t.state).toEqual({ option: 'page', remainingSec: null })
    expect(sleepLabel(t.state)).toBe('Sleep · page')
    t.sentenceEnding(0, pageOf, 1)
    t.sentenceEnding(1, pageOf, 1)
    expect(fade).not.toHaveBeenCalled()
    t.sentenceEnding(2, pageOf, 8) // last of page 1, far from its end
    expect(fade).not.toHaveBeenCalled()
    t.sentenceEnding(2, pageOf, 2.5)
    expect(fade).toHaveBeenLastCalledWith(0.5)
    expect(stop).not.toHaveBeenCalled()
    t.sentenceEnding(2, pageOf, 0)
    expect(fade).toHaveBeenLastCalledWith(0)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(t.state.option).toBe('off')
  })

  it('page option fades a short last sentence entirely, and stops when the next one begins', () => {
    const { t, fade, stop } = make()
    const pageOf = (i: number): number => (i < 2 ? 1 : 2)
    t.set('page', 1)
    t.sentenceEnding(1, pageOf, 2) // only 2 s long: the fade starts from full volume
    expect(fade).toHaveBeenLastCalledWith(1)
    t.sentenceEnding(1, pageOf, 1)
    expect(fade).toHaveBeenLastCalledWith(0.5)
    t.sentenceEnding(2, pageOf, 3) // the engine has moved on before the last tick
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('page option ignores a seek away from the ending sentence and restores volume', () => {
    const { t, fade, stop } = make()
    const pageOf = (i: number): number => (i < 4 ? 1 : 2)
    t.set('page', 1)
    t.sentenceEnding(3, pageOf, 5)
    t.sentenceEnding(3, pageOf, 2)
    expect(fade).toHaveBeenLastCalledWith(0.4)
    t.sentenceEnding(0, pageOf, 9)
    expect(fade).toHaveBeenLastCalledWith(1)
    expect(stop).not.toHaveBeenCalled()
    expect(t.state.option).toBe('page')
  })

  it('setting Off cancels a fade in progress and restores volume', () => {
    const { t, fade, stop } = make()
    t.set(20, 1)
    t.tick(1196, true)
    expect(fade).toHaveBeenLastCalledWith(0.8)
    t.set('off', 1)
    expect(fade).toHaveBeenLastCalledWith(1)
    t.tick(30, true)
    expect(stop).not.toHaveBeenCalled()
    expect(t.state).toEqual({ option: 'off', remainingSec: null })
    expect(sleepLabel(t.state)).toBe('Sleep')
  })

  it('the reading option turns itself off when the reading finishes', () => {
    const { t, stop } = make()
    t.set('reading', 1)
    expect(sleepLabel(t.state)).toBe('Sleep · end')
    t.tick(9999, true)
    expect(t.state.option).toBe('reading')
    t.readingFinished()
    expect(t.state.option).toBe('off')
    expect(stop).not.toHaveBeenCalled()
  })

  it('sentenceEnded stops at once on the last sentence of the page and holds the reading', () => {
    const { t, stop } = make()
    const pageOf = (i: number): number => (i < 2 ? 1 : 2)
    t.set('page', 1)
    expect(t.sentenceEnded(0, pageOf)).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    expect(t.sentenceEnded(1, pageOf)).toBe(true)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(t.state.option).toBe('off')
    expect(t.sentenceEnded(1, pageOf)).toBe(false)
  })
})
