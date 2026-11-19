import { describe, expect, it } from 'vitest'
import { estimateSec, Timeline, timeLeftLabel } from '../../../src/renderer/src/player/timeline'

// 145 chars at speed 1 => 10.25 s
const T = (n: number): string => 'x'.repeat(n)
const make = (): Timeline => new Timeline([T(145), T(145), T(145), T(145)]) // 10.25 s each

describe('timeline', () => {
  it('estimateSec scales inversely with speed', () => {
    expect(estimateSec(T(145), 1)).toBeCloseTo(10.25)
    expect(estimateSec(T(145), 2)).toBeCloseTo(5.25)
  })

  it('measured durations replace estimates and are speed-normalised', () => {
    const t = make()
    t.record(0, 4, 2) // 8 s at 1x
    expect(t.durationOf(0, 1)).toBeCloseTo(8)
    expect(t.durationOf(0, 2)).toBeCloseTo(4)
    expect(t.durationOf(1, 1)).toBeCloseTo(10.25)
  })

  it('forward 15 s lands on the sentence containing the target and always advances at least one', () => {
    const t = make()
    expect(t.skipTarget(0, 0, 15, 1)).toBe(1) // 15 in sentence 1 (10.25-20.5)
    expect(t.skipTarget(0, 0, 5, 1)).toBe(1) // inside current -> advance
    expect(t.skipTarget(0, 8, 15, 1)).toBe(2) // 23 in sentence 2
  })

  it('back 15 s from 2 s into a sentence goes to the sentence containing the target', () => {
    const t = make()
    expect(t.skipTarget(2, 2, -15, 1)).toBe(0) // 20.5+2-15=7.5 -> sentence 0
  })

  it('back 15 s from 5 s into a long sentence restarts it', () => {
    const t = new Timeline([T(145), T(145 * 4)]) // second is 40.5 s
    expect(t.skipTarget(1, 5, -3, 1)).toBe(1)
    expect(t.skipTarget(1, 5, -15, 1)).toBe(0)
    expect(t.skipTarget(1, 5, -4, 1)).toBe(1)
  })

  it('skipTarget clamps at the first and last sentence', () => {
    const t = make()
    expect(t.skipTarget(0, 1, -15, 1)).toBe(0)
    expect(t.skipTarget(3, 0, 15, 1)).toBe(3)
    expect(t.skipTarget(2, 0, 500, 1)).toBe(3)
  })

  it('secondsLeft sums the rest of the reading', () => {
    const t = make()
    expect(t.secondsLeft(1, 2, 1)).toBeCloseTo(10.25 * 3 - 2)
    expect(t.secondsLeft(1, 2, 2)).toBeCloseTo(5.25 * 3 - 2)
  })

  it('timeLeftLabel wording', () => {
    expect(timeLeftLabel(30)).toBe('Less than a minute left')
    expect(timeLeftLabel(59.9)).toBe('Less than a minute left')
    expect(timeLeftLabel(60)).toBe('About 1 min left')
    expect(timeLeftLabel(600)).toBe('About 10 min left')
    expect(timeLeftLabel(95)).toBe('About 2 min left')
  })
})
