export type SleepOption = 'off' | 10 | 20 | 30 | 45 | 'page' | 'reading'
/** remainingSec is null for page, reading and off. */
export type SleepState = { option: SleepOption; remainingSec: number | null }

/** The volume falls linearly over this many seconds before a stop. */
export const FADE_SEC = 5

export const SLEEP_CHOICES: ReadonlyArray<{ option: SleepOption; label: string }> = [
  { option: 'off', label: 'Off' },
  { option: 10, label: '10 minutes' },
  { option: 20, label: '20 minutes' },
  { option: 30, label: '30 minutes' },
  { option: 45, label: '45 minutes' },
  { option: 'page', label: 'End of this page' },
  { option: 'reading', label: 'End of this reading' }
]

/**
 * A pure sleep timer: no clock of its own. The owner reports elapsed time and the sentence being
 * read; the timer answers with volume (onFade) and a stop (onStop).
 */
export class SleepTimer {
  private option: SleepOption = 'off'
  private remaining: number | null = null
  private page = 0
  /** The last sentence of the page, once it is the one being read. */
  private ending: { index: number; window: number } | null = null
  /** Whether the volume has been moved since it was last at full. */
  private faded = false
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly onFade: (volume: number) => void,
    private readonly onStop: () => void
  ) {}

  /** Choose an option. Whatever fade was running is cancelled and the volume restored. */
  set(o: SleepOption, page: number): void {
    this.option = o
    this.page = page
    this.ending = null
    this.remaining = typeof o === 'number' ? o * 60 : null
    this.restore()
    this.emit()
  }

  /** Called whenever the option or the countdown changes. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Minutes count down only while playing. */
  tick(elapsedSec: number, playing: boolean): void {
    if (this.remaining === null || !playing) return
    this.remaining = Math.max(0, this.remaining - elapsedSec)
    if (this.remaining <= FADE_SEC) this.fade(this.remaining / FADE_SEC)
    if (this.remaining <= 0) this.stop()
    else this.emit()
  }

  /** The owner reports the sentence being read; only the page option listens. */
  sentenceEnding(
    index: number,
    sentencePage: (i: number) => number,
    remainingInSentenceSec: number
  ): void {
    if (this.option !== 'page') return
    const end = this.ending
    if (end && index !== end.index) {
      // Moving on from the last sentence of the page is the end of it; anything else is a seek.
      if (index === end.index + 1) return this.stop()
      this.ending = null
      this.restore()
    }
    if (!this.ending) {
      const last = sentencePage(index) === this.page && sentencePage(index + 1) !== this.page
      if (!last) return
      // A sentence shorter than the fade is faded over all of it.
      this.ending = { index, window: Math.min(FADE_SEC, remainingInSentenceSec) }
    }
    const left = Math.max(0, remainingInSentenceSec)
    if (left <= this.ending.window) {
      this.fade(this.ending.window > 0 ? left / this.ending.window : 0)
      if (left <= 0) this.stop()
    }
  }

  /** The reading ran out on its own: a timer waiting for that has done its job. */
  readingFinished(): void {
    if (this.option === 'reading') this.set('off', this.page)
  }

  get state(): SleepState {
    return { option: this.option, remainingSec: this.remaining }
  }

  private stop(): void {
    this.option = 'off'
    this.remaining = null
    this.ending = null
    this.faded = false
    this.onStop()
    this.emit()
  }

  private fade(v: number): void {
    this.faded = true
    this.onFade(v)
  }

  private restore(): void {
    if (!this.faded) return
    this.faded = false
    this.onFade(1)
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb()
  }
}

/** 'Sleep' | 'Sleep 19:42' | 'Sleep · page' | 'Sleep · end' */
export function sleepLabel(s: SleepState): string {
  if (s.option === 'page') return 'Sleep · page'
  if (s.option === 'reading') return 'Sleep · end'
  if (s.remainingSec === null) return 'Sleep'
  const total = Math.ceil(s.remainingSec)
  return `Sleep ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
