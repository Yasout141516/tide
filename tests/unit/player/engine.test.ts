import { describe, expect, it } from 'vitest'
import type { TtsAudio, TtsStatus } from '../../../src/shared/ipc-types'
import {
  PlayerEngine,
  type AudioSink,
  type PlayerSnapshot,
  type TtsClient
} from '../../../src/renderer/src/player/engine'

class FakeSink implements AudioSink {
  sources: string[] = []
  currentTime = 0
  volume = 1
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
}

function setup(texts: string[], index: number | null = 0): Rig {
  const sink = new FakeSink()
  const tts = new FakeTts()
  let n = 0
  const made: string[] = []
  const revoked: string[] = []
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
      }
    },
    'v1',
    1
  )
  engine.setSentences(texts, index)
  const snaps: PlayerSnapshot[] = []
  engine.subscribe((s) => snaps.push(s))
  return { engine, sink, tts, made, revoked, snaps }
}

const S = ['One short.', 'Two short.', 'Three short.', 'Four short.', 'Five short.', 'Six short.']

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
    const long = 'Well then my friends, we shall go forth today.'
    const { engine, sink, tts } = setup([long, 'Second one here.'])
    engine.play()
    expect(tts.texts()).toEqual([
      'Well then my friends,',
      ' we shall go forth today.',
      'Second one here.'
    ])
    tts.calls[0].resolve(audio(1))
    tts.calls[1].resolve(audio(1))
    await flush()
    expect(sink.sources).toHaveLength(1)
    sink.currentTime = 1
    sink.triggerEnded()
    expect(sink.sources).toHaveLength(2) // second clip back to back
    expect(engine.snapshot().index).toBe(0)
    tts.calls[2].resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(sink.sources).toHaveLength(3)
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

  it('changing speed or voice cancels the old generation and re-synthesises from the current sentence', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(engine.snapshot().index).toBe(1)
    const inFlight = tts.calls[tts.calls.length - 1] // sentence 4, requested when 1 became current
    const n = tts.calls.length
    engine.setSpeed(1.5)
    expect(tts.cancels).toEqual([inFlight.gen]) // finished audio needs no cancel
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual(S.slice(1, 5))
    expect(fresh.every((c) => c.speed === 1.5 && c.gen !== inFlight.gen)).toBe(true)
    expect(engine.snapshot().speed).toBe(1.5)
    const m = tts.calls.length
    engine.setVoice('v2')
    expect(tts.calls.slice(m).map((c) => c.text)).toEqual(S.slice(1, 5))
    expect(tts.calls[m].voice).toBe('v2')
    expect(engine.snapshot().voice).toBe('v2')
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
    const long = 'Well then my friends, we shall go forth today.'
    const texts = [S[0], S[1], long, S[3], S[4], S[5], S[0], S[1]]
    const { engine, tts } = setup(texts, 6)
    engine.play()
    const n = tts.calls.length
    engine.setIndex(2)
    const fresh = tts.calls.slice(n)
    // clips are sent in natural order (clip 0 first), the queue keeps them together at the front
    expect(fresh.slice(0, 2).map((c) => c.text)).toEqual([
      'Well then my friends,',
      ' we shall go forth today.'
    ])
    expect(fresh.slice(0, 2).every((c) => c.front === true)).toBe(true)
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

  it('a voice change still discards the cache', async () => {
    const { engine, sink, tts, made, revoked } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    const n = tts.calls.length
    engine.setVoice('v2')
    expect(revoked).toHaveLength(made.length)
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual(S.slice(0, 4))
    expect(fresh.every((c) => c.voice === 'v2')).toBe(true)
    // the old voice's audio can never be served: a seek must ask again
    engine.setIndex(1)
    expect(sink.sources).toHaveLength(1)
    expect(engine.snapshot().phase).toBe('buffering')
  })

  it('the first sentence is cut into short clips after a seek, and a cached one needs no new request', async () => {
    const long = 'Well then my friends, we shall go forth today.'
    const { engine, tts } = setup([S[0], S[1], S[2], S[3], S[4], S[5], long, S[1]])
    engine.play()
    engine.setIndex(6)
    expect(tts.texts().slice(-3)).toEqual([
      'Well then my friends,',
      ' we shall go forth today.',
      S[1]
    ])
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    const n = tts.calls.length
    engine.setIndex(7)
    engine.setIndex(6) // cached: plays from the made clips
    expect(tts.calls).toHaveLength(n)
    expect(engine.snapshot()).toMatchObject({ index: 6, phase: 'playing' })
  })

  it('a synthesis failure with a ready engine is an error', async () => {
    const { engine, tts } = setup(S)
    engine.play()
    tts.calls[0].reject(new Error('boom'))
    await flush()
    expect(engine.snapshot().phase).toBe('error')
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
})
