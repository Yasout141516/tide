import { describe, expect, it } from 'vitest'
import {
  finishInLabel,
  finishInSpeed,
  readingSeconds
} from '../../../src/renderer/src/player/finish-in'

describe('finish-in', () => {
  it('readingSeconds sums characters over the voice rate', () => {
    expect(readingSeconds(['abcde', 'fghij', 'k'], 11)).toBe(1)
    expect(readingSeconds([], 12)).toBe(0)
  })

  it('finishInSpeed rounds up to 0.05 and never goes below 1×', () => {
    expect(finishInSpeed(3000, 60).speed).toBe(1)
    expect(finishInSpeed(4300, 60).speed).toBe(1.2)
    expect(finishInSpeed(4320, 60).speed).toBe(1.2)
    expect(finishInSpeed(4321, 60).speed).toBe(1.25)
    expect(finishInSpeed(3601, 60)).toMatchObject({ speed: 1.05, fits: true })
    expect(finishInSpeed(0, 30).speed).toBe(1)
  })

  it('finishInSpeed reports needed time at 2× when it does not fit', () => {
    const r = finishInSpeed(10800, 60)
    expect(r).toMatchObject({ speed: 2, fits: false, neededMinAt2x: 90 })
    expect(finishInSpeed(7200, 60)).toMatchObject({ speed: 2, fits: true })
  })

  it('finishInLabel wording for fits and does not fit', () => {
    expect(finishInLabel(finishInSpeed(4000, 60), 60)).toBe('Finishes in about 58 min at 1.15×')
    expect(finishInLabel(finishInSpeed(1000, 60), 60)).toBe('Finishes in about 17 min at 1×')
    expect(finishInLabel(finishInSpeed(10800, 60), 60)).toBe('Needs 1 h 30 min even at 2×')
    expect(finishInLabel(finishInSpeed(14400, 60), 60)).toBe('Needs 2 h even at 2×')
    expect(finishInLabel(finishInSpeed(4200, 30), 30)).toBe('Needs 35 min even at 2×')
  })
})
