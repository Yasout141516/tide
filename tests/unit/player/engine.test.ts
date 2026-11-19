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
    o: { voice: string; speed: number; priority: 'live'; gen: string }
  ): Promise<TtsAudio> {
    return new Promise<TtsAudio>((resolve, reject) => {
      this.calls.push({ text, gen: o.gen, voice: o.voice, speed: o.speed, resolve, reject })
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
    expect(new Set(tts.calls.map((c) => c.gen)).size).toBe(1)
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
    const gens = new Set(tts.calls.map((c) => c.gen))
    expect(gens.size).toBe(3)
    expect(tts.cancels).toHaveLength(2)
    for (const c of first) c.resolve(audio(1))
    await flush()
    expect(sink.sources).toHaveLength(0)
    expect(engine.snapshot().phase).toBe('buffering')
    expect(made.every((u) => revoked.includes(u))).toBe(true)
    expect(made.length).toBe(revoked.length)
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
    const oldGen = tts.calls[0].gen
    const n = tts.calls.length
    engine.setSpeed(1.5)
    expect(tts.cancels).toContain(oldGen)
    const fresh = tts.calls.slice(n)
    expect(fresh.map((c) => c.text)).toEqual(S.slice(1, 5))
    expect(fresh.every((c) => c.speed === 1.5 && c.gen !== oldGen)).toBe(true)
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
    engine.setIndex(2)
    engine.setSentences(S, 0)
    engine.play()
    const gens = [...new Set(tts.calls.map((c) => c.gen))]
    expect(gens).toHaveLength(4)
  })

  it('skip uses the timeline target and keeps playing', async () => {
    const { engine, sink, tts } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(2))
    await flush()
    // each sentence is 2s at 1x: +5s from 0 lands in sentence 2
    engine.skip(5)
    expect(engine.snapshot().index).toBe(2)
    expect(engine.snapshot().phase).toBe('buffering')
    const last = tts.calls[tts.calls.length - 4]
    expect(last.text).toBe(S[2])
    sink.currentTime = 0
    tts.calls[tts.calls.length - 4].resolve(audio(2))
    await flush()
    expect(engine.snapshot().phase).toBe('playing')
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

  it('every URL made is revoked after it plays or is discarded', async () => {
    const { engine, sink, tts, made, revoked } = setup(S)
    engine.play()
    for (const c of tts.calls) c.resolve(audio(1))
    await flush()
    sink.triggerEnded()
    expect(revoked).toHaveLength(1)
    engine.dispose()
    expect(made.length).toBeGreaterThan(1)
    expect([...revoked].sort()).toEqual([...made].sort())
    expect(new Set(revoked).size).toBe(revoked.length)
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
