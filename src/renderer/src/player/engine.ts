import type { TtsAudio, TtsStatus } from '../../../shared/ipc-types'
import { firstClips } from './clips'
import { Timeline } from './timeline'
import { pcmToWav } from './wav'

export interface AudioSink {
  setSource(url: string): void
  play(): Promise<void>
  pause(): void
  readonly currentTime: number
  volume: number
  onEnded(cb: () => void): void
  onError(cb: () => void): void
}

export interface TtsClient {
  synthesize(
    text: string,
    o: { voice: string; speed: number; priority: 'live'; gen: string }
  ): Promise<TtsAudio>
  cancel(gen: string): void
  status(): Promise<TtsStatus>
  onStatus(cb: (s: TtsStatus) => void): () => void
}

export type PlayerPhase =
  'idle' | 'loading-voice' | 'buffering' | 'playing' | 'paused' | 'finished' | 'error'

export interface PlayerSnapshot {
  phase: PlayerPhase
  index: number | null
  voice: string
  speed: number
  secondsLeft: number | null
}

export interface EngineDeps {
  sink: AudioSink
  tts: TtsClient
  makeUrl(wav: ArrayBuffer): string
  revokeUrl(url: string): void
  /**
   * Asked as sentence `index` finishes, before the next one starts. Returning true holds the
   * reading there: paused at `index`, the next sentence not started.
   */
  holdAfter?(index: number): boolean
}

const AHEAD = 3
const SAMPLE_RATE = 24000

/** Never reused for the life of the app: the TTS worker never forgets a cancelled gen. */
let genCounter = 0

interface Entry {
  /** Object URL per clip; undefined when not arrived yet or already played and revoked. */
  urls: (string | undefined)[]
  /** Real duration per clip once arrived. */
  secs: (number | undefined)[]
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}

function clamp(i: number, n: number): number {
  return Math.max(0, Math.min(n - 1, i))
}

export class PlayerEngine {
  private readonly deps: EngineDeps
  private texts: string[] = []
  private tl = new Timeline([])
  private voice: string
  private speed: number
  private index: number | null = null
  private phase: PlayerPhase = 'idle'
  private wantPlay = false
  private gen: string | null = null
  private genStart = 0
  private entries = new Map<number, Entry>()
  /** Next (or currently playing) clip: sentence i, clip p. */
  private cur = { i: 0, p: 0 }
  private clipLoaded = false
  private status: TtsStatus = 'ready'
  private restartPending = false
  private listeners = new Set<(s: PlayerSnapshot) => void>()
  private unsubStatus: () => void
  private disposed = false

  constructor(deps: EngineDeps, voice: string, speed: number) {
    this.deps = deps
    this.voice = voice
    this.speed = speed
    deps.sink.onEnded(() => this.handleEnded())
    deps.sink.onError(() => this.handleSinkError())
    this.unsubStatus = deps.tts.onStatus((s) => this.handleStatus(s))
    void deps.tts
      .status()
      .then((s) => this.handleStatus(s))
      .catch(() => undefined)
  }

  get timeline(): Timeline {
    return this.tl
  }

  setSentences(texts: string[], index: number | null): void {
    if (this.disposed) return
    this.deps.sink.pause()
    this.wantPlay = false
    this.texts = texts
    this.tl = new Timeline(texts)
    this.index = index === null || texts.length === 0 ? null : clamp(index, texts.length)
    this.restartPending = false
    this.newGeneration()
    this.phase = 'idle'
    this.emit()
  }

  setIndex(i: number): void {
    if (this.disposed || this.texts.length === 0) return
    this.index = clamp(i, this.texts.length)
    if (this.phase === 'finished' || this.phase === 'error') this.phase = 'paused'
    this.restart()
  }

  play(): void {
    if (this.disposed || this.index === null) return
    const needsRestart = this.phase === 'finished' || this.phase === 'error'
    if (this.phase === 'finished') this.index = 0
    this.wantPlay = true
    if (needsRestart) {
      this.restart()
      return
    }
    if (this.clipLoaded) {
      this.deps.sink.play().catch(() => undefined)
      this.phase = 'playing'
      this.emit()
      return
    }
    this.fill()
    this.tryStart()
  }

  pause(): void {
    if (this.disposed || !this.wantPlay) return
    this.wantPlay = false
    this.deps.sink.pause()
    this.phase = 'paused'
    this.emit()
  }

  toggle(): void {
    if (this.wantPlay) this.pause()
    else this.play()
  }

  skip(deltaSec: number): void {
    if (this.disposed || this.index === null) return
    this.setIndex(this.tl.skipTarget(this.index, this.offsetSec(), deltaSec, this.speed))
  }

  setVoice(id: string): void {
    if (this.disposed || id === this.voice) return
    this.voice = id
    this.restart()
  }

  setSpeed(s: number): void {
    if (this.disposed || s === this.speed) return
    this.speed = s
    this.restart()
  }

  /** Seconds played into the current sentence: finished clips plus the playing clip. */
  offsetSec(): number {
    if (this.index === null || this.cur.i !== this.index) return 0
    const e = this.entries.get(this.index)
    if (!e) return 0
    let sum = 0
    for (let p = 0; p < this.cur.p; p++) sum += e.secs[p] ?? 0
    if (this.clipLoaded) sum += this.deps.sink.currentTime
    return sum
  }

  subscribe(cb: (s: PlayerSnapshot) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  snapshot(): PlayerSnapshot {
    return {
      phase: this.phase,
      index: this.index,
      voice: this.voice,
      speed: this.speed,
      secondsLeft:
        this.index === null ? null : this.tl.secondsLeft(this.index, this.offsetSec(), this.speed)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.wantPlay = false
    this.deps.sink.pause()
    this.dropGeneration()
    this.unsubStatus()
    this.listeners.clear()
  }

  // ---- internals ----

  private dropGeneration(): void {
    if (this.gen !== null) this.deps.tts.cancel(this.gen)
    this.gen = null
    for (const e of this.entries.values()) {
      for (const u of e.urls) if (u !== undefined) this.deps.revokeUrl(u)
    }
    this.entries.clear()
    this.clipLoaded = false
  }

  private newGeneration(): void {
    this.dropGeneration()
    genCounter += 1
    this.gen = `live-${genCounter}`
    this.genStart = this.index ?? 0
    this.cur = { i: this.genStart, p: 0 }
  }

  /** New generation from the current index; keeps playing if it was playing. */
  private restart(): void {
    this.deps.sink.pause()
    this.newGeneration()
    if (this.wantPlay) {
      this.fill()
      this.tryStart()
    } else {
      this.emit()
    }
  }

  /** Keep the current sentence and AHEAD more requested. */
  private fill(): void {
    if (this.index === null || this.gen === null) return
    const last = Math.min(this.texts.length - 1, this.index + AHEAD)
    for (let i = this.index; i <= last; i++) if (!this.entries.has(i)) this.request(i)
  }

  private request(i: number): void {
    const gen = this.gen
    if (gen === null) return
    const pieces = i === this.genStart ? firstClips(this.texts[i]) : [this.texts[i]]
    this.entries.set(i, {
      urls: new Array<string | undefined>(pieces.length).fill(undefined),
      secs: new Array<number | undefined>(pieces.length).fill(undefined)
    })
    const speed = this.speed
    pieces.forEach((text, p) => {
      void this.deps.tts.synthesize(text, { voice: this.voice, speed, priority: 'live', gen }).then(
        (audio) => this.onAudio(gen, i, p, audio, speed),
        (err: unknown) => this.onFail(gen, err)
      )
    })
  }

  private onAudio(gen: string, i: number, p: number, audio: TtsAudio, speed: number): void {
    if (this.disposed || gen !== this.gen) return
    const entry = this.entries.get(i)
    if (!entry) return
    entry.secs[p] = audio.pcm.length / SAMPLE_RATE
    entry.urls[p] = this.deps.makeUrl(pcmToWav(audio.pcm, SAMPLE_RATE))
    if (entry.secs.every((s) => s !== undefined)) {
      this.tl.record(
        i,
        entry.secs.reduce<number>((a, b) => a + (b ?? 0), 0),
        speed
      )
    }
    this.tryStart()
    this.emit()
  }

  private onFail(gen: string, err: unknown): void {
    if (isAbort(err) || this.disposed || gen !== this.gen) return
    void this.deps.tts
      .status()
      .catch((): TtsStatus => 'failed')
      .then((s) => {
        if (this.disposed || gen !== this.gen) return
        if (s === 'restarting' || this.restartPending) {
          this.restartPending = true
          this.status = 'restarting'
          if (this.wantPlay && !this.clipLoaded) this.phase = 'loading-voice'
        } else {
          this.wantPlay = false
          this.deps.sink.pause()
          this.phase = 'error'
        }
        this.emit()
      })
  }

  private handleStatus(s: TtsStatus): void {
    if (this.disposed) return
    const prev = this.status
    this.status = s
    if (s === 'restarting') this.restartPending = true
    if (s === 'ready' && this.restartPending) {
      this.restartPending = false
      if (this.phase !== 'error') this.restart()
      return
    }
    if (prev !== s && this.wantPlay && !this.clipLoaded) {
      this.phase = this.waitPhase()
      this.emit()
    }
  }

  private waitPhase(): PlayerPhase {
    return this.status === 'loading' || this.status === 'restarting' ? 'loading-voice' : 'buffering'
  }

  /** Start the next clip if wanted, not already loaded and arrived; otherwise show a waiting phase. */
  private tryStart(): void {
    if (!this.wantPlay || this.clipLoaded) return
    const { i, p } = this.cur
    const url = this.entries.get(i)?.urls[p]
    if (url === undefined) {
      this.phase = this.waitPhase()
      this.emit()
      return
    }
    this.deps.sink.setSource(url)
    this.clipLoaded = true
    this.deps.sink.play().catch(() => undefined)
    this.phase = 'playing'
    if (i !== this.index) {
      this.index = i
      for (const k of [...this.entries.keys()]) if (k < i) this.discard(k)
      this.fill()
    }
    this.emit()
  }

  private discard(k: number): void {
    const e = this.entries.get(k)
    if (!e) return
    for (const u of e.urls) if (u !== undefined) this.deps.revokeUrl(u)
    this.entries.delete(k)
  }

  private handleEnded(): void {
    if (this.disposed || !this.clipLoaded) return
    const { i, p } = this.cur
    const entry = this.entries.get(i)
    const url = entry?.urls[p]
    if (entry && url !== undefined) {
      this.deps.revokeUrl(url)
      entry.urls[p] = undefined
    }
    this.clipLoaded = false
    if (entry && p + 1 < entry.urls.length) {
      this.cur = { i, p: p + 1 }
    } else if (i + 1 < this.texts.length) {
      this.cur = { i: i + 1, p: 0 }
      if (this.deps.holdAfter?.(i)) {
        this.wantPlay = false
        this.phase = 'paused'
        this.emit()
        return
      }
    } else {
      this.wantPlay = false
      this.phase = 'finished'
      this.emit()
      return
    }
    this.tryStart()
  }

  private handleSinkError(): void {
    if (this.disposed) return
    this.wantPlay = false
    this.clipLoaded = false
    this.phase = 'error'
    this.emit()
  }

  private emit(): void {
    if (this.listeners.size === 0) return
    const s = this.snapshot()
    for (const cb of [...this.listeners]) cb(s)
  }
}
