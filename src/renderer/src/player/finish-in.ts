import { formatMinutes } from '../lib/minutes'
import { speedLabel } from '../../../shared/voices'

// Finish in…: the speed that fits a whole reading into a time limit. Pure.
const STEP = 20 // steps of 0.05
const MAX_SPEED = 2

export interface FinishInResult {
  /** The effective speed: 0.05 steps, never below 1×, at most 2×. */
  speed: number
  /** Whether the limit can be met at 2× or slower. */
  fits: boolean
  /** Minutes the whole reading takes at 2×, rounded up. */
  neededMinAt2x: number
  /** Minutes the whole reading takes at `speed`, rounded up. */
  minutes: number
}

/** Seconds to read all the sentences at 1×. */
export function readingSeconds(texts: string[], charsPerSec: number): number {
  let chars = 0
  for (const t of texts) chars += t.length
  return chars / charsPerSec
}

export function finishInSpeed(totalSec: number, limitMin: number): FinishInResult {
  const needed = totalSec / (limitMin * 60)
  // The small epsilon keeps an exact 1.2 from rounding up to 1.25 on float noise.
  const stepped = Math.ceil(needed * STEP - 1e-9) / STEP
  const speed = Math.min(MAX_SPEED, Math.max(1, stepped))
  return {
    speed,
    fits: stepped <= MAX_SPEED,
    neededMinAt2x: Math.ceil(totalSec / MAX_SPEED / 60),
    minutes: Math.ceil(totalSec / speed / 60)
  }
}

export function finishInLabel(r: FinishInResult, _limitMin: number): string {
  void _limitMin
  return r.fits
    ? `Finishes in about ${formatMinutes(r.minutes, true)} at ${speedLabel(r.speed)}`
    : `Needs ${formatMinutes(r.neededMinAt2x, true)} even at 2×`
}
