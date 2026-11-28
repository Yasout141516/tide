import { describe, expect, it } from 'vitest'
import type { TtsAudio, TtsStatus } from '../../../src/shared/ipc-types'
import {
  PlayerEngine,
  type AudioSink,
  type EngineDeps,
  type PlayerSnapshot,
  type TtsClient
} from '../../../src/renderer/src/player/engine'
import { progressiveClips } from '../../../src/renderer/src/player/clips'

class FakeSink implements AudioSink {
  sources: string[] = []
  currentTime = 0
  volume = 1
  playbackRate = 1
  plays = 0
  pauses = 0
  private ended: () => void = () => undefined
  private errored: () => void = () => undefined
  setSource(url: string): void {
    this.sources.push(url)
  }
  play(): Promise<void> {
    this.plays += 1
    return Promise.resolve()
  }
  pause(): void {
    this.pauses += 1
  }
  onEnded(cb: () => void): void {
    this.ended = cb
  }
  onError(cb: () => void): void {
    this.errored = cb
  }
  triggerEnded(): void {
    this.ended()
  }
  triggerError(): void {
    this.errored()
  }
}

interface Call {
  text: string
  gen: string
  front?: boolean
  voice: string
  speed: number
  resolve(a: TtsAudio): void
  reject(e: unknown): void
}

class FakeTts implements TtsClient {
  calls: Call[] = []
  cancels: string[] = []
  state: TtsStatus = 'ready'
  private cbs = new Set<(s: TtsStatus) => void>()
  synthesize(
    text: string,
    o: { voice: string; speed: number; priority: 'live'; gen: string; front?: boolean }
  ): Promise<TtsAudio> {
    return new Promise<TtsAudio>((resolve, reject) => {
      this.calls.push({
        text,
        gen: o.gen,
        front: o.front,
        voice: o.voice,
        speed: o.speed,
        resolve,
        reject
      })
    })
  }
  cancel(gen: string): void {
    this.cancels.push(gen)
  }
  status(): Promise<TtsStatus> {
    return Promise.resolve(this.state)
  }
  onStatus(cb: (s: TtsStatus) => void): () => void {
    this.cbs.add(cb)
    return () => this.cbs.delete(cb)
  }
  emitStatus(s: TtsStatus): void {
    this.state = s
    for (const cb of this.cbs) cb(s)
  }
  texts(): string[] {
    return this.calls.map((c) => c.text)
  }
}

const audio = (sec: number): TtsAudio => ({
  pcm: new Float32Array(Math.round(sec * 24000)),
  sampleRate: 24000,
  synthMs: 1,
  chunks: 1
})

const flush = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve()
}

interface Rig {
  engine: PlayerEngine
  sink: FakeSink
  tts: FakeTts
  made: string[]
  revoked: string[]
  snaps: PlayerSnapshot[]
  skipped: number[]
}

let holdAfter: (i: number) => boolean = () => false

/** The old fixed window (3 ahead, 8 cached): the mechanics tests below were written against it. */
const NARROW = { maxAhead: 3, keepBehind: 4 }

function setup(
  texts: string[],
  index: number | null = 0,
  prefetch: EngineDeps['prefetch'] = NARROW
): Rig {
  const sink = new FakeSink()
  const tts = new FakeTts()
  let n = 0
  const made: string[] = []
  const revoked: string[] = []
  const skipped: number[] = []
  const engine = new PlayerEngine(
    {
      sink,
      tts,
      makeUrl: () => {
        const u = `blob:${++n}`
        made.push(u)
        return u
      },
      revokeUrl: (u) => {
        revoked.push(u)
      },
      holdAfter: (i) => holdAfter(i),
      onSkip: (i) => {
        skipped.push(i)
      },
      prefetch
    },
    'v1',
    1
  )
  engine.setSentences(texts, index)
  const snaps: PlayerSnapshot[] = []
  engine.subscribe((s) => snaps.push(s))
  return { engine, sink, tts, made, revoked, snaps, skipped }
}

const S = ['One short.', 'Two short.', 'Three short.', 'Four short.', 'Five short.', 'Six short.']

/** 21 words: cut into progressive pieces (a clause boundary after 8 words, then the rest). */
const LONG =
  'Well then my friends and neighbours, we shall go forth today and see what the old road holds for us.'
// before any clip is measured the engine assumes RTF 1, so the pieces do not grow
const LONG_PIECES = progressiveClips(LONG, { growth: 1 })

describe('PlayerEngine', () => {
  it('play requests the current sentence and the next three, and plays the first clip when it arrives', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    expect(tts.texts()).toEqual(S.slice(0, 4))
    expect(new Set(tts.calls.map((c) => c.gen)).size).toBe(4) // one gen per sentence
    expect(tts.calls[0].gen).toMatch(/^live-\d+$/)
    expect(tts.calls[0]).toMatchObject({ voice: 'v1', speed: 1 })
    tts.calls[0].resolve(audio(1))
    await flush()
    expect(sink.sources).toHaveLength(1)
    expect(sink.plays).toBe(1)
    expect(engine.snapshot().phase).toBe('playing')
  })

  it('the first sentence after play is requested as its first clips; later sentences whole', async () => {
    const long = LONG
    const { engine, sink, tts } = setup([long, 'Second one here.'])
    engine.play()
    expect(tts.texts()).toEqual([...LONG_PIECES, 'Second one here.'])
    const np = LONG_PIECES.length
    for (let k = 0; k < np; k++) tts.calls[k].resolve(audio(1))
    await flush()
    expect(sink.sources).toHaveLength(1)
    for (let k = 1; k < np; k++) {
      sink.currentTime = 1
      sink.triggerEnded()
      expect(sink.sources).toHaveLength(k + 1) // next clip back to back
      expect(engine.snapshot().index).toBe(0)
    }
    tts.calls[np].resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(sink.sources).toHaveLength(np + 1)
    expect(engine.snapshot().index).toBe(1)
  })

  it('ended advances to the next sentence, reports its index and keeps the window at three ahead', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    expect(tts.calls).toHaveLength(4)
    sink.triggerEnded()
    expect(engine.snapshot().index).toBe(1)
    expect(tts.texts()).toEqual(S.slice(0, 5))
    sink.triggerEnded()
    expect(engine.snapshot().index).toBe(2)
    expect(tts.texts()).toEqual(S)
  })

  it('waiting for audio shows buffering; before the voice is ready it shows loading-voice', async () => {
    const a = setup(S)
    a.engine.play()
    expect(a.engine.snapshot().phase).toBe('buffering')
    a.tts.calls[0].resolve(audio(1))
    await flush()
    a.sink.triggerEnded() // sentence 1 not arrived yet
    expect(a.engine.snapshot().phase).toBe('buffering')

    const b = setup(S)
    b.tts.emitStatus('loading')
    b.engine.play()
    expect(b.engine.snapshot().phase).toBe('loading-voice')
    b.tts.emitStatus('ready')
    expect(b.engine.snapshot().phase).toBe('buffering')
  })

  it('late audio from a superseded generation is dropped and its URL revoked', async () => {
    const { engine, sink, tts, made, revoked } = setup(S)
    engine.play()
    const first = [...tts.calls]
    engine.setIndex(3)
    engine.setIndex(4)
    // 0..2 left the window at the first seek, 3 at the second; only 3..6 then 4..7 were asked
    expect(tts.cancels).toHaveLength(4)
    for (const c of first) c.resolve(audio(1))
    await flush()
    expect(sink.sources).toHaveLength(0)
    expect(engine.snapshot().phase).toBe('buffering')
    expect(made).toHaveLength(0) // none of the late audio was even turned into a URL
    // a voice change throws away audio that did arrive for the old voice
    const fresh = tts.calls.filter((c) => !first.includes(c))
    for (const c of fresh) c.resolve(audio(1))
    await flush()
    const arrived = made.length
    expect(arrived).toBeGreaterThan(0)
    engine.pause() // nothing playing: a voice change starts afresh
    engine.setVoice('v2')
    expect(revoked).toHaveLength(arrived)
    expect(made.every((u) => revoked.includes(u))).toBe(true)
  })

  it('an AbortError from a cancelled generation is ignored', async () => {
    const { engine, tts } = setup(S)
    engine.play()
    const old = tts.calls[0]
    engine.setIndex(2)
    old.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await flush()
    expect(engine.snapshot().phase).toBe('buffering')
  })

  it('setSpeed while playing changes the rate only: no request, no cancel, no pause', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    sink.triggerEnded()
    const n = tts.calls.length
    const pauses = sink.pauses
    const sources = sink.sources.length
    engine.setSpeed(1.5)
    expect(tts.calls).toHaveLength(n)
    expect(tts.cancels).toEqual([])
    expect(sink.playbackRate).toBe(1.5)
    expect(sink.pauses).toBe(pauses)
    expect(sink.sources).toHaveLength(sources)
    expect(engine.snapshot()).toMatchObject({ speed: 1.5, phase: 'playing', index: 1 })
    // everything is synthesised at 1x whatever the chosen speed is
    expect(tts.calls.every((c) => c.speed === 1)).toBe(true)
    sink.triggerEnded() // the next clip plays at the new rate too
    expect(sink.playbackRate).toBe(1.5)
  })

  it('a speed set before playing sets the rate and later requests stay at 1x', () => {
    const { engine, sink, tts } = setup(S)
    engine.setSpeed(2)
    expect(sink.playbackRate).toBe(2)
    engine.play()
    expect(tts.calls.every((c) => c.speed === 1)).toBe(true)
  })

  it('setVoice while playing keeps the current sentence and re-requests only those after it', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls.slice(0, 2)) c.resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(engine.snapshot().index).toBe(1)
    const current = tts.calls.find((c) => c.text === S[1])!
    const later = tts.calls.filter((c) => S.indexOf(c.text) > 1 && c.gen !== current.gen)
    const n = tts.calls.length
    const pauses = sink.pauses
    const sources = sink.sources.length
    engine.setVoice('v2')
    expect(engine.snapshot().voice).toBe('v2')
    expect(engine.snapshot().phase).toBe('playing')
    expect(sink.pauses).toBe(pauses)
    expect(sink.sources).toHaveLength(sources)
    expect(tts.cancels).not.toContain(current.gen)
    expect(tts.cancels).toEqual(expect.arrayContaining(later.map((c) => c.gen)))
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual(S.slice(2, 5))
    expect(fresh.every((c) => c.voice === 'v2')).toBe(true)
    // the current sentence ends, the next one plays from the new voice's audio
    for (const c of fresh) c.resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(engine.snapshot().index).toBe(2)
    expect(sink.sources).toHaveLength(sources + 1)
  })

  it('setVoice while nothing is playing starts afresh from the current sentence', async () => {
    const { engine, tts } = setup(S)
    engine.play()
    const n = tts.calls.length // still buffering: nothing is playing
    engine.setVoice('v2')
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual(S.slice(0, 4))
    expect(fresh.every((c) => c.voice === 'v2')).toBe(true)
  })

  it('refreshAudio still starts the current sentence again', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    const n = tts.calls.length
    engine.refreshAudio()
    expect(tts.calls.slice(n)[0].text).toBe(S[0])
    expect(sink.pauses).toBeGreaterThan(0)
  })

  it('time maths divide the 1x durations by the effective rate', async () => {
    const { engine, sink, tts } = setup(S.slice(0, 2))
    engine.play()
    for (const c of tts.calls) c.resolve(audio(2))
    await flush()
    expect(engine.snapshot().secondsLeft).toBeCloseTo(4)
    engine.setSpeed(2)
    expect(engine.snapshot().secondsLeft).toBeCloseTo(2)
    sink.currentTime = 1 // one second of audio = half a second of listening at 2x
    expect(engine.offsetSec()).toBeCloseTo(0.5)
    expect(engine.snapshot().secondsLeft).toBeCloseTo(1.5)
  })

  it('skip moves 15 s of listening at any rate', async () => {
    const texts = Array.from({ length: 30 }, (_, i) => `Sentence number ${i}.`)
    const { engine, tts } = setup(texts)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(2)) // 2 s of audio each at 1x
    await flush()
    engine.setSpeed(2) // each sentence lasts 1 s of listening
    engine.skip(5)
    expect(engine.snapshot().index).toBe(5)
  })

  it('refreshAudio cancels cached gens and re-requests the current sentence while playing', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls.slice(0, 2)) c.resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(engine.snapshot().index).toBe(1)
    const inFlight = tts.calls.slice(2).map((c) => c.gen) // arrived audio needs no cancel
    expect(inFlight.length).toBeGreaterThan(0)
    const n = tts.calls.length
    engine.refreshAudio()
    expect(tts.cancels).toEqual(expect.arrayContaining(inFlight))
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual(S.slice(1, 5))
    expect(fresh.every((c) => !inFlight.includes(c.gen))).toBe(true)
    expect(engine.snapshot().index).toBe(1)
  })

  it('refreshAudio does nothing when nothing is cached', () => {
    const { engine, tts } = setup(S)
    engine.refreshAudio()
    expect(tts.calls).toHaveLength(0)
    expect(tts.cancels).toHaveLength(0)
  })

  it('never reuses a generation id', () => {
    const { engine, tts } = setup(S)
    engine.play()
    engine.setIndex(1)
    engine.setIndex(5)
    engine.setSentences(S, 0)
    engine.play()
    engine.setVoice('v2')
    const gens = tts.calls.map((c) => c.gen)
    expect(new Set(gens).size).toBe(gens.length)
  })

  it('skip uses the timeline target and keeps playing', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(2))
    await flush()
    // each sentence is 2s at 1x: +5s from 0 lands in sentence 2
    engine.skip(5)
    expect(engine.snapshot().index).toBe(2)
    expect(engine.snapshot().phase).toBe('playing') // sentence 2 was already made
    expect(sink.sources).toHaveLength(2)
  })

  it('secondsLeft follows the index and speed', async () => {
    const { engine, sink, tts, snaps } = setup(S.slice(0, 2))
    engine.play()
    for (const c of tts.calls) c.resolve(audio(2))
    await flush()
    expect(engine.snapshot().secondsLeft).toBeCloseTo(4)
    sink.triggerEnded()
    expect(snaps[snaps.length - 1].secondsLeft).toBeCloseTo(2)
  })

  it('the last sentence ending gives finished; play from finished restarts at 0', async () => {
    const { engine, sink, tts } = setup(['A one.', 'B two.'], 1)
    engine.play()
    tts.calls[0].resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(engine.snapshot().phase).toBe('finished')
    const n = tts.calls.length
    engine.play()
    expect(engine.snapshot().index).toBe(0)
    expect(tts.calls.slice(n)[0].text).toBe('A one.')
    expect(engine.snapshot().phase).toBe('buffering')
  })

  it('pause and play resume the loaded clip', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    tts.calls[0].resolve(audio(1))
    await flush()
    engine.toggle()
    expect(engine.snapshot().phase).toBe('paused')
    engine.toggle()
    expect(engine.snapshot().phase).toBe('playing')
    expect(sink.plays).toBe(2)
    expect(sink.sources).toHaveLength(1)
  })

  it('every URL made is revoked when it is evicted or the engine is disposed', async () => {
    const { engine, sink, tts, made, revoked } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(revoked).toHaveLength(0) // a played sentence stays cached for a seek back
    engine.dispose()
    expect(made.length).toBeGreaterThan(1)
    expect([...revoked].sort()).toEqual([...made].sort())
    expect(new Set(revoked).size).toBe(revoked.length)
  })

  it('a seek within cached sentences plays at once without new synthesis', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    const n = tts.calls.length
    engine.setIndex(2)
    expect(engine.snapshot()).toMatchObject({ index: 2, phase: 'playing' })
    expect(sink.sources).toHaveLength(2)
    expect(tts.calls.slice(n).map((c) => c.text)).toEqual([S[4], S[5]]) // only the window's missing
    expect(tts.cancels).toHaveLength(0)
    engine.setIndex(0) // back to one already played
    expect(engine.snapshot()).toMatchObject({ index: 0, phase: 'playing' })
    expect(sink.sources).toHaveLength(3)
    expect(tts.calls).toHaveLength(n + 2)
  })

  it('a seek cancels only jobs outside the new window', async () => {
    const texts = Array.from({ length: 12 }, (_, k) => `Sentence number ${k}.`)
    const { engine, tts } = setup(texts)
    engine.play() // 0..3 in flight, none arrived
    const byText = (t: string): Call => tts.calls.find((c) => c.text === t) as Call
    engine.setIndex(2) // window 2..5: 0 and 1 go, 2 and 3 stay
    expect(tts.cancels).toEqual([byText(texts[0]).gen, byText(texts[1]).gen])
    expect(tts.texts().slice(4)).toEqual([texts[4], texts[5]])
  })

  it('a seek to an uncached target keeps in-window in-flight jobs and queues the target first', () => {
    const texts = Array.from({ length: 12 }, (_, k) => `Sentence number ${k}.`)
    const { engine, tts } = setup(texts, 5)
    engine.play() // 5..8 in flight
    const n = tts.calls.length
    const inFlight = (t: string): Call => tts.calls.find((c) => c.text === t) as Call
    engine.setIndex(3) // window 3..6: 5 and 6 stay, 7 and 8 go, 3 and 4 are new
    expect(tts.cancels).toEqual([inFlight(texts[7]).gen, inFlight(texts[8]).gen])
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual([texts[3], texts[4]])
    expect(fresh[0].front).toBe(true) // the target goes ahead of the kept jobs
    expect(fresh[1].front).toBeUndefined()
  })

  it('a seek to a pending target re-requests it at the front', () => {
    const texts = Array.from({ length: 12 }, (_, k) => `Sentence number ${k}.`)
    const { engine, tts } = setup(texts, 5)
    engine.play() // 5..8 in flight
    engine.setIndex(3) // 3 (front) and 4 are new behind 5 and 6; 7 and 8 are cancelled
    const byText = (t: string): Call[] => tts.calls.filter((c) => c.text === t)
    const oldFour = byText(texts[4])[0]
    const n = tts.calls.length
    const cancelled = tts.cancels.length
    engine.setIndex(4) // 4 waits behind 5 and 6 and nothing of it has arrived: ask again, first
    expect(tts.cancels.slice(cancelled)).toEqual([byText(texts[3])[0].gen, oldFour.gen])
    const fresh = tts.calls.slice(n)
    expect(fresh[0]).toMatchObject({ text: texts[4], front: true })
    expect(fresh[0].gen).not.toBe(oldFour.gen)
    expect(tts.cancels).not.toContain(byText(texts[5])[0].gen) // kept jobs are untouched
    // late audio of the cancelled request is dropped
    oldFour.resolve(audio(1))
    expect(engine.snapshot().phase).toBe('buffering')
  })

  it('a seek to the oldest pending entry leaves it where it is', () => {
    const texts = Array.from({ length: 12 }, (_, k) => `Sentence number ${k}.`)
    const { engine, tts } = setup(texts, 5)
    engine.play() // 5..8 in flight; 5 is at the head of the queue
    const n = tts.calls.length
    engine.setIndex(6) // 6 is pending behind 5 (cancelled, outside window): 6 is now the oldest
    expect(tts.calls.slice(n).map((c) => c.text)).toEqual([texts[9]])
    expect(tts.calls.slice(n)[0].front).toBeUndefined()
  })

  it('a first-clip target is queued at the front with its clips still in order', () => {
    const long = LONG
    const texts = [S[0], S[1], long, S[3], S[4], S[5], S[0], S[1]]
    const { engine, tts } = setup(texts, 6)
    engine.play()
    const n = tts.calls.length
    engine.setIndex(2)
    const fresh = tts.calls.slice(n)
    // clips are sent in natural order (clip 0 first), the queue keeps them together at the front
    expect(fresh.slice(0, LONG_PIECES.length).map((c) => c.text)).toEqual(LONG_PIECES)
    expect(fresh.slice(0, LONG_PIECES.length).every((c) => c.front === true)).toBe(true)
  })

  it('the cache holds at most 8 sentences and revokes evicted URLs', async () => {
    const texts = Array.from({ length: 20 }, (_, k) => `Sentence number ${k}.`)
    const { engine, sink, tts, made, revoked } = setup(texts)
    engine.play()
    // play through 0..9, each made and played
    for (let k = 0; k < 10; k++) {
      for (const c of tts.calls) c.resolve(audio(1))
      await flush()
      sink.triggerEnded()
    }
    expect(engine.snapshot().index).toBe(10)
    // made URLs: one per sentence 0..12; 8 entries kept (6..13, 13 not yet made), so 0..5 were revoked
    expect(made).toHaveLength(13)
    expect(revoked).toHaveLength(made.length - 7)
    const live = made.filter((u) => !revoked.includes(u))
    expect(live).toHaveLength(7)
    expect((engine as unknown as { entries: Map<number, unknown> }).entries.size).toBe(8)
    engine.dispose()
    expect([...revoked].sort()).toEqual([...made].sort())
    expect(new Set(revoked).size).toBe(revoked.length)
  })

  it('a voice change while playing discards the cache after the current sentence only', async () => {
    const { engine, sink, tts, made, revoked } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    const n = tts.calls.length
    engine.setVoice('v2')
    expect(revoked).toHaveLength(made.length - 1) // the playing sentence's clip stays
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual(S.slice(1, 4))
    expect(fresh.every((c) => c.voice === 'v2')).toBe(true)
    // the old voice's audio can never be served: a seek must ask again
    engine.setIndex(1)
    expect(sink.sources).toHaveLength(1)
    expect(engine.snapshot().phase).toBe('buffering')
  })

  it('the first sentence is cut into short clips after a seek, and a cached one needs no new request', async () => {
    const long = LONG
    const { engine, tts } = setup([S[0], S[1], S[2], S[3], S[4], S[5], long, S[1]])
    engine.play()
    engine.setIndex(6)
    expect(tts.texts().slice(-(LONG_PIECES.length + 1))).toEqual([...LONG_PIECES, S[1]])
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    const n = tts.calls.length
    engine.setIndex(7)
    engine.setIndex(6) // cached: plays from the made clips
    expect(tts.calls).toHaveLength(n)
    expect(engine.snapshot()).toMatchObject({ index: 6, phase: 'playing' })
  })

  describe('a sentence that fails is skipped, not fatal (RS-3)', () => {
    it('a first failure is retried once; a second skips the sentence and playback continues', async () => {
      const { engine, tts, skipped } = setup(S)
      engine.play()
      const n = tts.calls.length
      tts.calls[0].reject(new Error('boom'))
      await flush()
      expect(tts.calls).toHaveLength(n + 1) // the retry
      expect(tts.calls[n].text).toBe(S[0])
      expect(skipped).toEqual([])
      tts.calls[n].reject(new Error('boom again'))
      await flush()
      expect(skipped).toEqual([0])
      expect(engine.snapshot().phase).not.toBe('error')
      tts.calls[1].resolve(audio(1)) // sentence 1 arrives
      await flush()
      expect(engine.snapshot()).toMatchObject({ index: 1, phase: 'playing' })
      expect(skipped).toEqual([0]) // reported once
    })

    it('a retry that works plays the sentence normally', async () => {
      const { engine, tts, skipped } = setup(S)
      engine.play()
      const n = tts.calls.length
      tts.calls[0].reject(new Error('boom'))
      await flush()
      tts.calls[n].resolve(audio(1))
      await flush()
      expect(skipped).toEqual([])
      expect(engine.snapshot()).toMatchObject({ index: 0, phase: 'playing' })
    })

    it('a failing sentence in the middle is skipped when playback reaches it, and the one after plays', async () => {
      const { engine, sink, tts, skipped } = setup(S)
      engine.play()
      tts.calls[0].resolve(audio(1))
      tts.calls[1].resolve(audio(1))
      await flush()
      const n = tts.calls.length
      tts.calls[2].reject(new Error('boom'))
      await flush()
      tts.calls[n].reject(new Error('boom'))
      await flush()
      expect(skipped).toEqual([]) // not reached yet
      tts.calls[3].resolve(audio(1))
      await flush()
      sink.triggerEnded() // -> 1
      sink.triggerEnded() // -> 2 skipped -> 3
      await flush()
      expect(skipped).toEqual([2])
      expect(engine.snapshot()).toMatchObject({ index: 3, phase: 'playing' })
    })

    it('the last sentence failing twice finishes the reading rather than erroring', async () => {
      const { engine, tts, skipped } = setup(['Only one.'])
      engine.play()
      tts.calls[0].reject(new Error('boom'))
      await flush()
      tts.calls[1].reject(new Error('boom'))
      await flush()
      expect(skipped).toEqual([0])
      expect(engine.snapshot().phase).toBe('finished')
    })

    it('three skipped sentences in a row mean the voice is not working: the error state', async () => {
      const { engine, tts, skipped } = setup(S)
      engine.play()
      const first = tts.calls.length
      for (let k = 0; k < first; k++) tts.calls[k].reject(new Error('boom'))
      await flush()
      const retries = tts.calls.slice(first)
      for (const c of retries) c.reject(new Error('boom'))
      await flush()
      expect(skipped).toEqual([0, 1, 2])
      expect(engine.snapshot().phase).toBe('error')
    })

    it('a good sentence between skips resets the count', async () => {
      const { engine, sink, tts, skipped } = setup(S)
      engine.play()
      const first = tts.calls.length // sentences 0..3
      tts.calls[0].reject(new Error('boom'))
      tts.calls[1].resolve(audio(1))
      tts.calls[2].reject(new Error('boom'))
      tts.calls[3].reject(new Error('boom'))
      await flush()
      for (const c of tts.calls.slice(first)) c.reject(new Error('boom')) // retries of 0, 2, 3
      await flush()
      expect(skipped).toEqual([0]) // 0 skipped; 1 plays
      sink.triggerEnded() // 1 done -> 2 skipped, 3 skipped: only two in a row since 1 was good
      await flush()
      expect(skipped).toEqual([0, 2, 3])
    })

    it('a skipped last sentence of a page still honours the end-of-page sleep', async () => {
      holdAfter = (i) => i === 1 // the page ends after sentence 1
      try {
        const { engine, sink, tts, skipped } = setup(S)
        engine.play()
        tts.calls[0].resolve(audio(1))
        const n = tts.calls.length
        tts.calls[1].reject(new Error('boom'))
        await flush()
        tts.calls[n].reject(new Error('boom'))
        await flush()
        sink.triggerEnded() // 0 done -> 1 is skipped -> held at the page end
        await flush()
        expect(skipped).toEqual([1])
        expect(engine.snapshot().phase).toBe('paused')
        expect(engine.snapshot().index).toBe(0)
      } finally {
        holdAfter = () => false
      }
    })

    it('a voice engine that is gone for good (status failed) still raises the error', async () => {
      const { engine, tts, skipped } = setup(S)
      engine.play()
      tts.state = 'failed'
      tts.calls[0].reject(new Error('voice engine stopped'))
      await flush()
      expect(skipped).toEqual([])
      expect(engine.snapshot().phase).toBe('error')
    })

    it('a sentence that keeps failing across worker restarts is still skipped', async () => {
      const { engine, tts, skipped } = setup(S)
      engine.play()
      for (let round = 0; round < 2; round++) {
        const n = tts.calls.length
        tts.state = 'restarting'
        tts.calls[round === 0 ? 0 : n - S.length].reject(new Error('timed out'))
        tts.emitStatus('restarting')
        await flush()
        tts.emitStatus('ready') // restart: asks again from the current sentence
      }
      await flush()
      // the second restart's re-request of sentence 0 is not made: it was given up on
      expect(skipped).toEqual([])
      const last = tts.calls.at(-1)!
      expect(last.text).not.toBe(S[0])
    })
  })

  it('a prefetched sentence that fails does not stop the current one; it is skipped on reaching it (R37, RS-3)', async () => {
    const { engine, sink, tts, skipped } = setup(S)
    engine.play()
    tts.calls[0].resolve(audio(1))
    tts.calls[1].resolve(audio(1))
    await flush()
    const pausesBefore = sink.pauses
    const n = tts.calls.length
    tts.calls[2].reject(new Error('boom')) // sentence 2 fails while sentence 0 plays
    await flush()
    tts.calls[n].reject(new Error('boom')) // and again on its retry
    await flush()
    expect(engine.snapshot().phase).toBe('playing')
    expect(sink.pauses).toBe(pausesBefore)
    sink.triggerEnded() // -> sentence 1, still fine
    expect(engine.snapshot()).toMatchObject({ index: 1, phase: 'playing' })
    tts.calls[3].resolve(audio(1))
    sink.triggerEnded() // -> sentence 2, the failed one: skipped, 3 plays
    await flush()
    expect(skipped).toEqual([2])
    expect(engine.snapshot()).toMatchObject({ index: 3, phase: 'playing' })
  })

  describe('a failed prefetched sentence (R37 follow-up)', () => {
    /** Plays sentence 0 with 0 and 1 ready, and sentence 2 failed. */
    async function failedTwo(): Promise<Rig> {
      const r = setup(S)
      r.engine.play()
      r.tts.calls[0].resolve(audio(1))
      r.tts.calls[1].resolve(audio(1))
      await flush()
      const n = r.tts.calls.length
      r.tts.calls[2].reject(new Error('boom'))
      await flush()
      r.tts.calls[n].reject(new Error('boom')) // the retry fails too: sentence 2 is given up on
      await flush()
      return r
    }

    it('does not stay pending, so it never counts as the oldest in-flight job', async () => {
      const { engine } = await failedTwo()
      const entries = (engine as unknown as { entries: Map<number, { pending: number }> }).entries
      expect(entries.get(2)?.pending).toBe(0)
      expect(entries.get(3)?.pending).toBeGreaterThan(0) // still in flight, for contrast
    })

    it('reaching it skips it without an error, and Play after a restart does not ask for it again', async () => {
      const { engine, sink, tts, skipped } = await failedTwo()
      sink.triggerEnded()
      sink.triggerEnded() // reaches the failed sentence
      await flush()
      expect(skipped).toEqual([2])
      expect(engine.snapshot().phase).not.toBe('error')
      const n = tts.calls.length
      engine.setVoice('v2') // restart from the current sentence
      expect(tts.calls.slice(n).map((c) => c.text)).not.toContain(S[2])
    })

    it('a seek past it and back requests it again instead of raising', async () => {
      const { engine, tts } = await failedTwo()
      engine.setIndex(5)
      const n = tts.calls.length
      engine.setIndex(2)
      expect(tts.calls.slice(n).map((c) => c.text)).toContain(S[2])
      expect(engine.snapshot().phase).not.toBe('error')
    })

    it('a seek straight onto it requests it again instead of raising', async () => {
      const { engine, tts } = await failedTwo()
      const n = tts.calls.length
      engine.setIndex(2)
      expect(tts.calls.slice(n).map((c) => c.text)).toContain(S[2])
      expect(engine.snapshot().phase).not.toBe('error')
    })
  })

  it('a restart of the voice engine resumes the current sentence when ready', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(engine.snapshot().index).toBe(1)
    const n = tts.calls.length
    tts.state = 'restarting'
    tts.calls[n - 1].reject(new Error('worker died'))
    tts.emitStatus('restarting')
    await flush()
    expect(engine.snapshot().phase).not.toBe('error')
    tts.emitStatus('ready')
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual(S.slice(1, 5))
    fresh[0].resolve(audio(1))
    await flush()
    expect(engine.snapshot().phase).toBe('playing')
    expect(sink.sources).toHaveLength(3)
  })
  describe('progressive first clips', () => {
    const wordsOf = (t: string): number => t.split(/\s+/).filter(Boolean).length
    const long40 =
      'When the morning light finally reached the valley the farmers began to gather near the old well and talk about the harvest, the weather, the price of grain, and the long road to the market town beyond.'

    /**
     * Virtual-time run: one serial worker at the given RTF, clip audio = words x 0.35 s, real-time
     * playback. Returns the first-audio time and every silent gap between consecutive clips.
     */
    async function simulate(
      texts: string[],
      rtf: number,
      act: (e: PlayerEngine) => void
    ): Promise<{ first: number; gaps: number[]; pieces: string[] }> {
      const sink = new FakeSink()
      const tts = new FakeTts()
      const durs = new Map<string, number>()
      let n = 0
      const engine = new PlayerEngine(
        {
          sink,
          tts,
          makeUrl: (wav) => {
            const u = `blob:${++n}`
            durs.set(u, (wav.byteLength - 44) / 2 / 24000)
            return u
          },
          revokeUrl: () => undefined,
          prefetch: NARROW
        },
        'v1',
        1
      )
      engine.setSentences(texts, 0)
      let now = 0
      let workerFree = 0
      let served = 0
      let playEnd: number | null = null // when the playing clip ends
      let lastEnd = 0 // when the previous clip ended
      let first = -1
      const gaps: number[] = []
      const setSource = sink.setSource.bind(sink)
      sink.setSource = (u: string): void => {
        setSource(u)
        if (first < 0) first = now
        else gaps.push(now - lastEnd)
        playEnd = now + (durs.get(u) ?? 0)
      }
      const pieceCount = progressiveClips(texts[texts.indexOf(long40)], { growth: 1 }).length
      act(engine)
      // the live pieces of the long sentence, in request order
      const pieces = tts.calls
        .filter((c) => !tts.cancels.includes(c.gen) && long40.includes(c.text.trim()))
        .map((c) => c.text)
        .slice(0, pieceCount)
      for (let guard = 0; guard < 200 && sink.sources.length < pieceCount; guard++) {
        while (served < tts.calls.length && tts.cancels.includes(tts.calls[served].gen)) served += 1
        const call = tts.calls[served]
        const synthDone = call
          ? Math.max(workerFree, now) + wordsOf(call.text) * 0.35 * rtf
          : Infinity
        const endAt = playEnd ?? Infinity
        if (synthDone <= endAt) {
          now = synthDone
          workerFree = synthDone
          const sec = wordsOf(call.text) * 0.35
          call.resolve({
            pcm: new Float32Array(Math.round(sec * 24000)),
            sampleRate: 24000,
            synthMs: sec * rtf * 1000,
            chunks: 1
          })
          served += 1
        } else {
          now = endAt
          lastEnd = endAt
          playEnd = null
          sink.triggerEnded()
        }
        await flush()
      }
      return { first, gaps, pieces }
    }

    it('no silent gap over 1 s after Play on a 40-word sentence at RTF 1.0', async () => {
      const { first, gaps, pieces } = await simulate([long40, ...S], 1.0, (e) => e.play())
      expect(pieces.length).toBeGreaterThan(2)
      expect(pieces.join('')).toBe(long40)
      expect(wordsOf(pieces[0])).toBeLessThanOrEqual(8)
      expect(first).toBeLessThan(4) // first clip is short
      expect(gaps.length).toBe(pieces.length - 1)
      for (const g of gaps) expect(g).toBeLessThanOrEqual(1)
    })

    it('the same after a seek outside the prefetch window (a real progressive split)', async () => {
      const texts = [...S, ...S, 'One more short one.']
      texts[7] = long40
      const { gaps, pieces } = await simulate(texts, 1.0, (e) => {
        e.play()
        e.setIndex(7) // beyond index 0 + 3 ahead: the gens of 0..3 are cancelled, 7 is requested afresh
      })
      expect(pieces.length).toBeGreaterThan(2)
      expect(pieces.join('')).toBe(long40)
      expect(gaps.length).toBe(pieces.length - 1)
      for (const g of gaps) expect(g).toBeLessThanOrEqual(1)
    })

    it('clip bookkeeping spans n clips: offset sums finished clips, skip lands in the sentence', async () => {
      const { engine, sink, tts } = setup([long40, 'Second one here.'])
      engine.play()
      const np = progressiveClips(long40, { growth: 1 }).length
      expect(np).toBeGreaterThan(2)
      for (let k = 0; k < np; k++) tts.calls[k].resolve(audio(2))
      await flush()
      sink.currentTime = 0
      sink.triggerEnded()
      sink.currentTime = 0.5
      expect(engine.offsetSec()).toBeCloseTo(2.5, 5)
      sink.triggerEnded()
      sink.currentTime = 0
      expect(engine.offsetSec()).toBeCloseTo(4, 5)
      expect(engine.snapshot().index).toBe(0)
    })

    it('a failed clip of a prefetched progressive sentence is skipped only on reaching it; a failed later clip of the playing one skips the rest of it (R37, RS-3)', async () => {
      const np = progressiveClips(long40, { growth: 1 }).length
      expect(np).toBeGreaterThan(2)
      // half 1: sentence 1 (prefetched) has a failing later piece
      {
        const { engine, sink, tts, skipped } = setup(['Short first one here.', long40])
        engine.play()
        const second = tts.calls.filter((c) => long40.includes(c.text.trim()))
        expect(second.length).toBeGreaterThan(0)
        const n = tts.calls.length
        tts.calls[1].reject(new Error('boom'))
        await flush()
        tts.calls[n].reject(new Error('boom')) // the retry fails too
        await flush()
        expect(engine.snapshot().phase).not.toBe('error') // the current sentence keeps going
        tts.calls[0].resolve(audio(1))
        await flush()
        expect(engine.snapshot().phase).toBe('playing')
        sink.triggerEnded() // reaching the failed sentence: skipped, and it was the last
        expect(skipped).toEqual([1])
        expect(engine.snapshot().phase).toBe('finished')
      }
      // half 2: a later piece of the PLAYING progressive sentence fails
      {
        const { engine, sink, tts, skipped } = setup([long40, 'Second one here.'])
        engine.play()
        expect(tts.calls.length).toBeGreaterThan(np)
        tts.calls[0].resolve(audio(1))
        await flush()
        expect(sink.sources).toHaveLength(1)
        const n = tts.calls.length
        tts.calls[1].reject(new Error('boom')) // piece 1 of the playing sentence
        await flush()
        tts.calls[n].reject(new Error('boom')) // its retry fails too
        await flush()
        expect(skipped).toEqual([]) // the first clip is still playing
        sink.triggerEnded() // its end reaches the failed piece: the rest is skipped
        await flush()
        expect(skipped).toEqual([0])
        expect(engine.snapshot().index).toBe(1)
      }
    })

    it('a restart after measured fast synthesis uses larger growth (fewer pieces)', async () => {
      const { engine, tts } = setup([long40])
      engine.play()
      const flat = tts.calls.length // cold start: rtf = 1, pieces do not grow
      expect(flat).toBe(progressiveClips(long40, { growth: 1 }).length)
      for (let k = 0; k < flat; k++) {
        tts.calls[k].resolve({ ...audio(2), synthMs: 1000 }) // RTF 0.5
        await flush()
      }
      const n = tts.calls.length
      engine.refreshAudio() // restart: the measured RTF now allows growth
      const fresh = tts.calls.slice(n)
      expect(fresh.length).toBeLessThan(flat)
      expect(fresh.map((c) => c.text).join('')).toBe(long40)
    })
  })
})

describe('PlayerEngine time-based prefetch', () => {
  const sentence = (n: number, ch: number): string => `S${n} ` + 'x'.repeat(ch - 4) + '.'
  const inFlight = (e: PlayerEngine): number =>
    [...(e as unknown as { entries: Map<number, { pending: number }> }).entries.values()].filter(
      (x) => x.pending > 0
    ).length

  it('asks for sentences until about 30 s of audio is covered ahead', () => {
    // 300 chars is about 21 s each at 1x: the current one plus two more cover 30 s
    const texts = Array.from({ length: 10 }, (_, k) => sentence(k, 300))
    const { engine, tts } = setup(texts, 0, {})
    engine.play()
    expect(tts.calls.length).toBe(3)
  })

  it('a faster playback rate needs more sentences ahead for the same listening time', () => {
    const texts = Array.from({ length: 12 }, (_, k) => sentence(k, 150)) // about 10.6 s each at 1x
    const a = setup(texts, 0, {})
    a.engine.play()
    const at1x = a.tts.calls.length
    const b = setup(texts, 0, {})
    b.engine.setSpeed(2)
    b.engine.play()
    expect(b.tts.calls.length).toBeGreaterThan(at1x)
    expect(at1x).toBeGreaterThanOrEqual(4) // the current one and 3 ahead (about 32 s)
    expect(b.tts.calls.length).toBeGreaterThanOrEqual(7) // 5.3 s each: 6 ahead
  })

  it('never has more than 8 entries in flight, however short the sentences', async () => {
    const texts = Array.from({ length: 40 }, (_, k) => `Short ${k}.`)
    const { engine, tts, sink } = setup(texts, 0, {})
    engine.play()
    expect(inFlight(engine)).toBe(8)
    for (let k = 0; k < 6; k++) {
      tts.calls[k].resolve(audio(1))
      await flush()
      expect(inFlight(engine)).toBeLessThanOrEqual(8)
    }
    expect(sink.sources.length).toBe(1)
  })

  it('uses the real length of audio that arrived: long made audio covers the window', async () => {
    const texts = Array.from({ length: 10 }, (_, k) => sentence(k, 60)) // about 4.4 s each est.
    const { engine, tts, sink } = setup(texts, 0, {})
    engine.play()
    const n0 = tts.calls.length
    expect(n0).toBe(8) // 7 ahead is about 31 s, capped at 8 in flight anyway
    for (const c of tts.calls) c.resolve(audio(40)) // far longer than estimated
    await flush()
    sink.triggerEnded() // moves to sentence 1; 40 s of made audio is already ahead
    expect(tts.calls.length).toBe(n0 + 0)
  })

  it('after a voice change the next sentences are requested in playback order, next first piece in front', async () => {
    const texts = [
      sentence(0, 120),
      LONG,
      ...Array.from({ length: 8 }, (_, k) => sentence(k + 2, 80))
    ]
    const { engine, tts } = setup(texts, 0, {})
    engine.play()
    tts.calls[0].resolve(audio(8))
    await flush()
    const n = tts.calls.length
    engine.setVoice('v2')
    const fresh = tts.calls.slice(n)
    // the next sentence's pieces first (in order, the first the short one), then each later sentence
    expect(fresh[0].text).toBe(LONG_PIECES[0])
    let k = 0
    let joined = ''
    while (joined.length < LONG.length) joined += fresh[k++].text
    expect(joined).toBe(LONG)
    expect(fresh.slice(k).map((c) => c.text)).toEqual(texts.slice(2, 2 + fresh.length - k))
    expect(fresh.length - k).toBeGreaterThanOrEqual(3)
  })

  /** One serial worker at a constant synthesis speed, a sink that plays each clip for its length. */
  async function simulate(
    texts: string[],
    rtfOf: (i: number) => number
  ): Promise<{ stalls: number; longest: number }> {
    const sink = new FakeSink()
    const tts = new FakeTts()
    const durs = new Map<string, number>()
    let n = 0
    const engine = new PlayerEngine(
      {
        sink,
        tts,
        makeUrl: (wav) => {
          const u = `blob:${++n}`
          durs.set(u, (wav.byteLength - 44) / 2 / 24000)
          return u
        },
        revokeUrl: () => undefined
      },
      'v1',
      1
    )
    engine.setSentences(texts, 0)
    let now = 0
    let workerFree = 0
    let served = 0
    const askedAt = new Map<Call, number>()
    let playEnd: number | null = null
    let lastEnd = 0
    let started = false
    const gaps: number[] = []
    const setSource = sink.setSource.bind(sink)
    sink.setSource = (u: string): void => {
      setSource(u)
      if (started) gaps.push(now - lastEnd)
      started = true
      playEnd = now + (durs.get(u) ?? 0)
    }
    const secOf = (t: string): number => t.length / 14.5
    const sentenceOf = (t: string): number => texts.findIndex((x) => x.includes(t.trim()))
    engine.play()
    for (let guard = 0; guard < 2000 && engine.snapshot().phase !== 'finished'; guard++) {
      // the worker takes the lowest-numbered live call not cancelled, front ones first
      while (served < tts.calls.length && tts.cancels.includes(tts.calls[served].gen)) served += 1
      const pending = tts.calls.slice(served)
      for (const c of pending) if (!askedAt.has(c)) askedAt.set(c, now)
      const call = pending.find((c) => c.front) ?? pending[0]
      const synthDone = call
        ? Math.max(workerFree, askedAt.get(call) ?? now) +
          secOf(call.text) * rtfOf(sentenceOf(call.text))
        : Infinity
      const endAt = playEnd ?? Infinity
      if (synthDone === Infinity && endAt === Infinity) break
      if (synthDone <= endAt) {
        now = synthDone
        workerFree = synthDone
        const sec = secOf(call.text)
        tts.calls.splice(tts.calls.indexOf(call), 1)
        call.resolve({
          pcm: new Float32Array(Math.round(sec * 24000)),
          sampleRate: 24000,
          synthMs: sec * rtfOf(sentenceOf(call.text)) * 1000,
          chunks: 1
        })
      } else {
        now = endAt
        lastEnd = endAt
        playEnd = null
        sink.triggerEnded()
      }
      await flush()
    }
    const stalls = gaps.filter((g) => g > 0.05)
    return { stalls: stalls.length, longest: Math.max(0, ...gaps) }
  }

  it('slow sentences in a run (RTF about 1 on average) do not stall once playing', async () => {
    // 20 sentences of about 3.4 s; a run of two slow ones (RTF 2.5) after fast ones (0.4)
    const texts = Array.from({ length: 20 }, (_, k) => sentence(k, 50))
    const r = await simulate(texts, (i) => (i >= 8 && i < 10 ? 2.5 : 0.4))
    expect(r.stalls).toBe(0)
  })
})
