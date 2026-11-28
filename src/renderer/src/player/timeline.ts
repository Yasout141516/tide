import { formatMinutes } from '../lib/minutes'

/** Estimated listening time: the 1x estimate over the rate the audio plays at. */
export function estimateSec(text: string, speed: number): number {
  return (text.length / 14.5 + 0.25) / speed
}

export class Timeline {
  private readonly texts: string[]
  /** measured duration at 1x (live audio is always made at 1x; the sink plays it faster or slower) */
  private readonly measured: (number | undefined)[]

  constructor(texts: string[]) {
    this.texts = texts
    this.measured = new Array<number | undefined>(texts.length).fill(undefined)
  }

  /** The real (1x) length of sentence i's audio. */
  record(i: number, seconds: number): void {
    this.measured[i] = seconds
  }

  /** Seconds of listening at playback rate `speed`. */
  durationOf(i: number, speed: number): number {
    const m = this.measured[i]
    return m !== undefined ? m / speed : estimateSec(this.texts[i], speed)
  }

  private start(i: number, speed: number): number {
    let s = 0
    for (let k = 0; k < i; k++) s += this.durationOf(k, speed)
    return s
  }

  /** `offsetSec` and `deltaSec` are seconds of listening (wall-clock), at rate `speed`. */
  skipTarget(current: number, offsetSec: number, deltaSec: number, speed: number): number {
    const last = this.texts.length - 1
    const total = this.start(last + 1, speed)
    const t = Math.max(0, this.start(current, speed) + offsetSec + deltaSec)
    if (t >= total) return last
    let acc = 0
    let idx = last
    for (let k = 0; k <= last; k++) {
      const end = acc + this.durationOf(k, speed)
      if (t < end) {
        idx = k
        break
      }
      acc = end
    }
    if (deltaSec > 0 && current < last && idx <= current) return current + 1
    if (deltaSec < 0 && idx === current && offsetSec > 3) return current
    return idx
  }

  secondsLeft(current: number, offsetSec: number, speed: number): number {
    let sum = -offsetSec
    for (let k = current; k < this.texts.length; k++) sum += this.durationOf(k, speed)
    return Math.max(0, sum)
  }
}

export function timeLeftLabel(sec: number): string {
  if (sec < 60) return 'Less than a minute left'
  return `About ${formatMinutes(Math.max(1, Math.round(sec / 60)))} left`
}
