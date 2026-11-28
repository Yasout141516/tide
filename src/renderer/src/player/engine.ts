import type { TtsAudio, TtsStatus } from '../../../shared/ipc-types'
import { isAbortError } from '../../../shared/abort'
import { SAMPLE_RATE } from '../../../shared/pcm'
import { progressiveClips } from './clips'
import { Timeline } from './timeline'
import { pcmToWav } from './wav'

export interface AudioSink {
  setSource(url: string): void
  play(): Promise<void>
  pause(): void
  readonly currentTime: number
  volume: number
  /** How fast the clip plays (pitch kept); the engine sets it to the effective speed. */
  playbackRate: number
  onEnded(cb: () => void): void
  onError(cb: () => void): void
}

export interface TtsClient {
  synthesize(
    text: string,
    o: { voice: string; speed: number; priority: 'live'; gen: string; front?: boolean }
  ): Promise<TtsAudio>
  cancel(gen: string): void
  status(): Promise<TtsStatus>
  onStatus(cb: (s: TtsStatus) => void): () => void
}

export type PlayerPhase =
  'idle' | 'loading-voice' | 'buffering' | 'playing' | 'paused' | 'finished' | 'error'

/** Whether she is (or is about to be) hearing the reading: playing, or waiting on audio or the voice. */
export function isListening(p: PlayerPhase | undefined): boolean {
  return p === 'playing' || p === 'buffering' || p === 'loading-voice'
}

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
  /**
   * Sentence `index` could not be read aloud (it failed twice) and playback moved past it. Called
   * once per skipped sentence; the caller shows the toast and writes the log.
   */
  onSkip?(index: number, reason: string): void
}

const AHEAD = 3
/** This many skipped sentences with no good one between them: not one bad sentence, a dead voice. */
const MAX_SKIPS_IN_A_ROW = 3
/** Sentences of made audio kept (the current one, those ahead, and those just played). */
const CACHE_MAX = 8
/**
 * The sentence playback (re)starts at is cut into progressively larger clips: the first has at most
 * this many words, so the first audio comes early, and each next one is only as much larger as the
 * measured synthesis speed allows (see `clipGrowth`), so no clip is still being made when the
 * one before it ends.
 */
const FIRST_CLIP_WORDS = 8

/** Never reused for the life of the app: the TTS worker never forgets a cancelled gen. */
let genCounter = 0

/**
 * Audio for one sentence, made for one voice. Live audio is always made at 1x; the speed is the
 * sink's playbackRate (RS-1), so it is no part of what an entry is.
 */
interface Entry {
  /** Unique per request, so cancelling one sentence never touches another. */
  gen: string
  voice: string
  /** Kept playing in its old voice after a voice change (RS-2) until the reading moves off it. */
  keepVoice?: boolean
  /** Request order; the lowest pending one is at the head of the worker's queue. */
  seq: number
  /** Queued ahead of other jobs (a seek target). */
  front: boolean
  /** Clips not arrived yet; the entry is still in flight while this is above zero. */
  pending: number
  /** Object URL per clip; undefined when not arrived yet. Kept after playing, revoked on eviction. */
  urls: (string | undefined)[]
  /** The text of each clip, kept so a failed one can be asked for again. */
  pieces: string[]
  /**
   * A clip failed for good (R37, RS-3). Its `pending` is settled like an arrival, so it is never
   * taken for in-flight work. 'skip': it failed twice, so playback moves past the sentence when it
   * reaches it. 'down': the voice engine itself is gone, so playback stops with an error there.
   */
  failed?: 'skip' | 'down'
  /** Real duration per clip once arrived. */
  secs: (number | undefined)[]
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
  /** The sentence whose request is cut into short first clips (set on play, seek, voice change). */
  private firstIdx = 0
  private entries = new Map<number, Entry>()
  /** Next (or currently playing) clip: sentence i, clip p. */
  private cur = { i: 0, p: 0 }
  private clipLoaded = false
  private status: TtsStatus = 'ready'
  /** Synthesis time per second of audio, smoothed over the clips made so far; 1 until measured. */
  private rtf = 1
  private restartPending = false
  /** Failures per sentence index; two make it a skipped one (RS-3). Kept across a worker restart. */
  private failCounts = new Map<number, number>()
  /** Sentences given up on: requested as already failed, so playback passes them without synthesis. */
  private skipped = new Set<number>()
  private lastError = ''
  /** Sentences skipped in a row; reaching MAX_SKIPS_IN_A_ROW means the voice itself is broken. */
  private skipRun = 0
  private listeners = new Set<(s: PlayerSnapshot) => void>()
  private unsubStatus: () => void
  private disposed = false

  constructor(deps: EngineDeps, voice: string, speed: number) {
    this.deps = deps
    this.voice = voice
    this.speed = speed
    deps.sink.playbackRate = speed
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
    this.failCounts.clear()
    this.skipped.clear()
    this.skipRun = 0
    this.dropAll()
    this.resetCursor()
    this.phase = 'idle'
    this.emit()
  }

  setIndex(i: number): void {
    if (this.disposed || this.texts.length === 0) return
    this.index = clamp(i, this.texts.length)
    // An explicit jump onto a skipped sentence is a fresh try at it.
    this.failCounts.delete(this.index)
    this.skipped.delete(this.index)
    if (this.phase === 'finished' || this.phase === 'error') this.phase = 'paused'
    this.seek()
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

  /**
   * While a clip plays, the current sentence goes on in the old voice and only what follows it is
   * dropped and asked for again in the new one (RS-2). Otherwise start again from the index.
   */
  setVoice(id: string): void {
    if (this.disposed || id === this.voice) return
    this.voice = id
    const cur = this.entries.get(this.cur.i)
    if (this.wantPlay && this.clipLoaded && cur) {
      cur.keepVoice = true
      for (const k of [...this.entries.keys()]) if (k !== this.cur.i) this.evict(k)
      this.firstIdx = this.cur.i + 1 // the new voice's first audio comes in short clips
      this.fill()
      this.emit()
      return
    }
    this.restart()
  }

  /** The audio is made at 1x, so a new speed is only a new playback rate: nothing is redone. */
  setSpeed(s: number): void {
    if (this.disposed || s === this.speed) return
    this.speed = s
    this.deps.sink.playbackRate = s
    this.emit()
  }

  /**
   * Her pronunciation fixes changed: audio made so far says the old thing. Cancel it, drop it, and
   * start the current sentence again (as a voice change does). Nothing cached: nothing to redo.
   */
  refreshAudio(): void {
    if (this.disposed || this.entries.size === 0) return
    this.restart()
  }

  /** Seconds of listening into the current sentence: finished clips plus the playing clip, over the rate. */
  offsetSec(): number {
    if (this.index === null || this.cur.i !== this.index) return 0
    const e = this.entries.get(this.index)
    if (!e) return 0
    let sum = 0
    for (let p = 0; p < this.cur.p; p++) sum += e.secs[p] ?? 0
    if (this.clipLoaded) sum += this.deps.sink.currentTime
    return sum / this.speed
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
    this.dropAll()
    this.unsubStatus()
    this.listeners.clear()
  }

  // ---- internals ----

  private dropAll(): void {
    for (const k of [...this.entries.keys()]) this.evict(k)
    this.clipLoaded = false
  }

  /** Forget sentence k: cancel it if still in flight, revoke every URL made for it. */
  private evict(k: number): void {
    const e = this.entries.get(k)
    if (!e) return
    if (e.pending > 0) this.deps.tts.cancel(e.gen)
    for (const u of e.urls) if (u !== undefined) this.deps.revokeUrl(u)
    this.entries.delete(k)
  }

  private resetCursor(): void {
    this.firstIdx = this.index ?? 0
    this.cur = { i: this.firstIdx, p: 0 }
  }

  /** Audio for sentence i, only if it was made for the current voice (or is the one finishing in the old). */
  private entryFor(i: number): Entry | undefined {
    const e = this.entries.get(i)
    if (e && e.voice !== this.voice && !e.keepVoice) {
      this.evict(i)
      return undefined
    }
    return e
  }

  /** Voice, speed or engine restart: nothing made so far can be used; start again from the index. */
  private restart(): void {
    this.deps.sink.pause()
    this.dropAll()
    this.resetCursor()
    this.resume()
  }

  /**
   * Move to the current index keeping the audio already made. Only jobs outside the new window are
   * cancelled; a missing (or still waiting) target is queued at the front so it does not wait behind kept jobs.
   */
  private seek(): void {
    if (this.index === null) return
    this.deps.sink.pause()
    this.clipLoaded = false
    this.resetCursor()
    for (const e of this.entries.values()) e.keepVoice = false // a jump ends the old-voice grace
    const lo = this.index
    const hi = this.index + AHEAD
    for (const [k, e] of [...this.entries]) {
      if (e.failed || (e.pending > 0 && (k < lo || k > hi))) this.evict(k) // a failed one is retried
    }
    if (this.wantPlay && this.needsFront(lo)) {
      this.evict(lo)
      this.request(lo, true)
    }
    this.resume()
  }

  /**
   * Whether the target must be (re)queued at the front: it is missing, or it is pending with nothing
   * arrived, was not itself queued at the front, and is not the oldest pending entry (that one is
   * the head of the worker's queue or already running; redoing it would only cost a chunk).
   */
  private needsFront(i: number): boolean {
    const e = this.entryFor(i)
    if (e === undefined) return true
    if (e.front || e.pending !== e.urls.length) return false
    for (const o of this.entries.values()) if (o.pending > 0 && o.seq < e.seq) return true
    return false
  }

  private resume(): void {
    if (this.wantPlay) {
      this.fill()
      this.tryStart()
    } else {
      this.emit()
    }
  }

  /** Keep at most CACHE_MAX sentences, dropping those farthest from the current one (behind first). */
  private trim(): void {
    const at = this.index ?? 0
    while (this.entries.size > CACHE_MAX) {
      let victim: number | null = null
      for (const k of this.entries.keys()) {
        if (k === at || k === this.cur.i) continue
        if (victim === null) victim = k
        else {
          const dv = Math.abs(victim - at)
          const dk = Math.abs(k - at)
          if (dk > dv || (dk === dv && k < victim)) victim = k
        }
      }
      if (victim === null) return
      this.evict(victim)
    }
  }

  /** Keep the current sentence and AHEAD more requested. */
  private fill(): void {
    if (this.index === null) return
    const last = Math.min(this.texts.length - 1, this.index + AHEAD)
    for (let i = this.index; i <= last; i++) if (this.entryFor(i) === undefined) this.request(i)
    this.trim()
  }

  /** A restart right after a cold start (nothing measured yet) uses rtf = 1: flat 8-word pieces. */
  private request(i: number, front = false): void {
    const pieces =
      i === this.firstIdx
        ? progressiveClips(this.texts[i], { firstWords: FIRST_CLIP_WORDS, growth: 1 / this.rtf })
        : [this.texts[i]]
    genCounter += 1
    const entry: Entry = {
      gen: `live-${genCounter}`,
      seq: genCounter,
      front,
      voice: this.voice,
      pieces,
      pending: pieces.length,
      urls: new Array<string | undefined>(pieces.length).fill(undefined),
      secs: new Array<number | undefined>(pieces.length).fill(undefined)
    }
    this.entries.set(i, entry)
    if (this.skipped.has(i)) {
      entry.pending = 0
      entry.failed = 'skip'
      return
    }
    for (let p = 0; p < pieces.length; p++) this.synthPiece(i, entry, p)
  }

  private synthPiece(i: number, entry: Entry, p: number): void {
    void this.deps.tts
      .synthesize(entry.pieces[p], {
        voice: entry.voice,
        speed: 1, // live audio is made at 1x; the sink plays it at the chosen rate (RS-1)
        priority: 'live',
        gen: entry.gen,
        ...(entry.front && { front: true })
      })
      .then(
        (audio) => this.onAudio(i, entry, p, audio),
        (err: unknown) => this.onFail(i, entry, p, err)
      )
  }

  private onAudio(i: number, entry: Entry, p: number, audio: TtsAudio): void {
    // Dropped when the entry was evicted meanwhile (seek, voice or speed change): never played.
    if (this.disposed || this.entries.get(i) !== entry) return
    entry.pending -= 1
    this.skipRun = 0
    entry.secs[p] = audio.pcm.length / SAMPLE_RATE
    if (entry.secs[p] > 0 && audio.synthMs > 0) {
      this.rtf = 0.5 * this.rtf + 0.5 * (audio.synthMs / 1000 / entry.secs[p])
    }
    entry.urls[p] = this.deps.makeUrl(pcmToWav(audio.pcm, SAMPLE_RATE))
    if (entry.secs.every((s) => s !== undefined)) {
      this.tl.record(
        i,
        entry.secs.reduce<number>((a, b) => a + (b ?? 0), 0)
      )
    }
    this.tryStart()
    this.emit()
  }

  private onFail(i: number, entry: Entry, p: number, err: unknown): void {
    if (isAbortError(err) || this.disposed || this.entries.get(i) !== entry) return
    this.lastError = err instanceof Error ? err.message : String(err)
    const count = (this.failCounts.get(i) ?? 0) + 1
    this.failCounts.set(i, count)
    void this.deps.tts
      .status()
      .catch((): TtsStatus => 'failed')
      .then((s) => {
        if (this.disposed || this.entries.get(i) !== entry) return
        if (s === 'restarting' || this.restartPending) {
          entry.pending -= 1 // settled; the restart asks for it again, unless it has failed twice
          if (count >= 2) this.skipped.add(i)
          this.restartPending = true
          this.status = 'restarting'
          if (this.wantPlay && !this.clipLoaded) this.phase = 'loading-voice'
        } else if (s === 'failed') {
          entry.pending -= 1
          entry.failed = 'down' // the voice engine is gone, not one bad sentence
          if (i === this.cur.i) this.failNow()
        } else if (count < 2) {
          this.synthPiece(i, entry, p) // one more try (RS-3); pending stays, it is still in flight
          return
        } else {
          entry.pending -= 1
          entry.failed = 'skip'
          this.skipped.add(i)
          if (i === this.cur.i) this.failNow()
        }
        this.emit()
      })
  }

  /** The sentence being waited on or just playing failed: if nothing is playing, act on it now. */
  private failNow(): void {
    if (this.wantPlay && !this.clipLoaded) this.tryStart()
  }

  /** Give up on sentence i (RS-3): tell the caller, then carry on with the next one. */
  private skipPast(i: number): void {
    this.deps.onSkip?.(i, this.lastError)
    if (++this.skipRun >= MAX_SKIPS_IN_A_ROW) {
      this.raiseError() // "the voice isn't working": failures across different sentences
      this.emit()
    } else if (i + 1 < this.texts.length) {
      this.cur = { i: i + 1, p: 0 }
      if (this.deps.holdAfter?.(i)) {
        // e.g. the sleep timer's "end of page": the skipped sentence ended the page, so stop there
        this.wantPlay = false
        this.phase = 'paused'
        this.emit()
        return
      }
      this.index = i + 1
      this.fill() // the window moves on, so what follows a run of skipped sentences is requested
      this.tryStart()
    } else {
      this.wantPlay = false
      this.phase = 'finished'
      this.emit()
    }
  }

  private raiseError(): void {
    this.wantPlay = false
    this.deps.sink.pause()
    this.phase = 'error'
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
    const entry = this.entryFor(i)
    if (entry?.failed === 'down') {
      this.raiseError()
      this.emit()
      return
    }
    if (entry?.failed === 'skip') {
      this.skipPast(i)
      return
    }
    const url = entry?.urls[p]
    if (url === undefined) {
      this.phase = this.waitPhase()
      this.emit()
      return
    }
    this.deps.sink.setSource(url)
    this.deps.sink.playbackRate = this.speed
    this.clipLoaded = true
    this.deps.sink.play().catch(() => undefined)
    this.phase = 'playing'
    if (i !== this.index) {
      this.index = i
      this.fill()
    }
    this.emit()
  }

  private handleEnded(): void {
    if (this.disposed || !this.clipLoaded) return
    const { i, p } = this.cur
    const entry = this.entries.get(i)
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
