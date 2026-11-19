import { EventEmitter } from 'events'
import { describe, it, expect, vi } from 'vitest'
import { TtsHost, jobTimeoutMs, type ForkFn, type TtsChild } from '../../src/main/tts-host'
import type { TtsRequest, TtsResponse } from '../../src/tts/protocol'
import type { TtsStatus } from '../../src/shared/ipc-types'

/** A stand-in for Electron's UtilityProcess: an EventEmitter with postMessage/kill. */
class FakeChild extends EventEmitter implements TtsChild {
  sent: TtsRequest[] = []
  killed = false
  constructor(private reply: (req: TtsRequest, child: FakeChild) => void) {
    super()
  }
  postMessage(msg: TtsRequest): void {
    this.sent.push(msg)
    this.reply(msg, this)
  }
  respond(res: TtsResponse): void {
    queueMicrotask(() => this.emit('message', res))
  }
  kill(): boolean {
    this.killed = true
    return true
  }
}

function hostWith(
  reply: (req: TtsRequest, child: FakeChild) => void,
  timeoutMs?: number
): { host: TtsHost; child: () => FakeChild; forks: () => number } {
  let child!: FakeChild
  let forks = 0
  const fork: ForkFn = () => {
    forks++
    return (child = new FakeChild(reply))
  }
  const host = new TtsHost({ workerPath: 'worker.js', modelDir: '/models', timeoutMs, fork })
  return { host, child: () => child, forks: () => forks }
}

const loads = (req: TtsRequest, c: FakeChild): void => {
  if (req.type === 'load') c.respond({ id: req.id, type: 'loaded', loadMs: 7, warmMs: 2 })
}

describe('TtsHost', () => {
  it('resolves synthesize by matching response id', async () => {
    const { host, child } = hostWith((req, c) => {
      loads(req, c)
      if (req.type === 'synthesize') {
        // A stale reply for an unknown id must be ignored, then the real one matched.
        c.respond({ id: req.id + 100, type: 'error', message: 'not mine' })
        c.respond({
          id: req.id,
          type: 'audio',
          pcm: new Float32Array(4),
          sampleRate: 24000,
          synthMs: 3,
          chunks: 1
        })
      }
    })
    expect(await host.start()).toEqual({ loadMs: 7 })
    const r = await host.synthesize('Hello.', { voice: 'af_heart', speed: 1 })
    expect(r.pcm).toBeInstanceOf(Float32Array)
    expect(r.pcm.length).toBe(4)
    expect(r).toMatchObject({ sampleRate: 24000, synthMs: 3, chunks: 1 })
    const ids = child().sent.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length) // ids are unique
    expect(child().sent[0]).toMatchObject({ type: 'load', modelDir: '/models', dtype: 'fp32' })
    host.dispose()
  })

  it('warms with the default voice', async () => {
    const { host, child } = hostWith(loads)
    await host.start()
    expect(child().sent[0]).toMatchObject({ type: 'load', warmVoice: 'bf_emma' })
    host.dispose()
  })

  it('rejects with the worker error message', async () => {
    const { host } = hostWith((req, c) => {
      loads(req, c)
      if (req.type === 'synthesize') c.respond({ id: req.id, type: 'error', message: 'boom' })
    })
    await expect(host.synthesize('Hello.', { voice: 'af_heart', speed: 1 })).rejects.toThrow('boom')
    host.dispose()
  })

  it('missing model rejects', async () => {
    const { host, child } = hostWith(() => {}, 50) // never answers 'load'
    await expect(host.start()).rejects.toThrow(/did not load within/)
    expect(child().killed).toBe(true)
  })

  it('rejects pending requests when the process exits', async () => {
    const { host, child } = hostWith(loads) // loads, but never answers 'synthesize'
    await host.start()
    const p = host.synthesize('Hello.', { voice: 'af_heart', speed: 1 })
    await vi.waitFor(() => expect(child().sent.some((m) => m.type === 'synthesize')).toBe(true))
    child().emit('exit', 1)
    await expect(p).rejects.toThrow(/voice engine stopped/)
  })

  it("survives a fatal 'error' event and rejects pending requests on the following exit", async () => {
    const { host, child } = hostWith(loads) // loads, but never answers 'synthesize'
    await host.start()
    const p = host.synthesize('Hello.', { voice: 'af_heart', speed: 1 })
    await vi.waitFor(() => expect(child().sent.some((m) => m.type === 'synthesize')).toBe(true))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Electron emits 'error' (type, location, report) on a fatal V8 error, then 'exit'.
    expect(() => child().emit('error', 'FatalError', 'onnx.cc:1', '{}')).not.toThrow()
    child().emit('exit', 134)
    await expect(p).rejects.toThrow(/voice engine stopped/)
    spy.mockRestore()
  })
})

const OPTS = { voice: 'af_heart', speed: 1 }
const audio = (id: number): TtsResponse => ({
  id,
  type: 'audio',
  pcm: new Float32Array(1),
  sampleRate: 24000,
  synthMs: 1,
  chunks: 1
})

/** A worker that loads, then answers 'started' for every synthesize and nothing else. */
const hangs = (req: TtsRequest, c: FakeChild): void => {
  loads(req, c)
  if (req.type === 'synthesize') c.respond({ id: req.id, type: 'started' })
}

describe('TtsHost v2', () => {
  it('job timeout grows with text length and is measured from job start', async () => {
    vi.useFakeTimers()
    try {
      expect(jobTimeoutMs('x'.repeat(1500))).toBe(255_000)
      const { host, child } = hostWith(loads)
      await host.start()
      const text = 'x'.repeat(1500)
      let settled = false
      const p = host.synthesize(text, OPTS).then(
        () => (settled = true),
        () => (settled = true)
      )
      await vi.advanceTimersByTimeAsync(100_000) // queued behind another job: no 'started' yet
      expect(settled).toBe(false)
      const synth = child().sent.find((m) => m.type === 'synthesize')!
      child().respond({ id: synth.id, type: 'started' })
      await vi.advanceTimersByTimeAsync(jobTimeoutMs(text) - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await p
      expect(settled).toBe(true)
      host.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a job that hangs after started kills and respawns the worker, rejects pending jobs and reports restarting then ready', async () => {
    vi.useFakeTimers()
    try {
      const { host, child, forks } = hostWith(hangs)
      await host.start()
      const first = child()
      const seen: TtsStatus[] = []
      host.onStatus((s) => seen.push(s))
      const r1 = expect(host.synthesize('Hi.', OPTS)).rejects.toThrow()
      const r2 = expect(host.synthesize('There.', OPTS)).rejects.toThrow(/voice engine stopped/)
      await vi.advanceTimersByTimeAsync(jobTimeoutMs('Hi.'))
      await r1
      await r2
      expect(first.killed).toBe(true)
      expect(forks()).toBe(2)
      expect(seen).toEqual(['restarting', 'loading', 'ready'])
      expect(host.status()).toBe('ready')
      host.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('two failures in a row report failed and stop restarting', async () => {
    vi.useFakeTimers()
    try {
      const { host, child, forks } = hostWith(hangs)
      await host.start()
      const seen: TtsStatus[] = []
      host.onStatus((s) => seen.push(s))
      for (let i = 0; i < 2; i++) {
        const r = expect(host.synthesize('Hi.', OPTS)).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(jobTimeoutMs('Hi.'))
        await r
      }
      expect(forks()).toBe(2)
      expect(seen).toEqual(['restarting', 'loading', 'ready', 'failed'])
      expect(host.status()).toBe('failed')
      expect(child().killed).toBe(true)
      await expect(host.synthesize('Hi.', OPTS)).rejects.toThrow('voice engine stopped')
      expect(forks()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a successful synthesis after a restart resets the failure count', async () => {
    vi.useFakeTimers()
    try {
      let mode: 'hang' | 'ok' = 'hang'
      const { host, forks } = hostWith((req, c) => {
        loads(req, c)
        if (req.type !== 'synthesize') return
        c.respond({ id: req.id, type: 'started' })
        if (mode === 'ok') c.respond(audio(req.id))
      })
      await host.start()
      const hang = async (): Promise<void> => {
        const r = expect(host.synthesize('Hi.', OPTS)).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(jobTimeoutMs('Hi.'))
        await r
      }
      await hang() // failure 1: restarts
      mode = 'ok'
      const ok = host.synthesize('Hi.', OPTS)
      await vi.advanceTimersByTimeAsync(0)
      await ok // resets the count
      mode = 'hang'
      await hang() // failure 1 again, not 2: restarts rather than failing
      expect(host.status()).toBe('ready')
      expect(forks()).toBe(3)
      host.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancel(gen) posts a cancel and the pending job rejects with AbortError when the worker replies cancelled', async () => {
    const { host, child } = hostWith(hangs)
    await host.start()
    const p = host.synthesize('Hi.', { ...OPTS, gen: 'g1', priority: 'preview' })
    await vi.waitFor(() => expect(child().sent.some((m) => m.type === 'synthesize')).toBe(true))
    const synth = child().sent.find((m) => m.type === 'synthesize')!
    expect(synth).toMatchObject({ priority: 'preview', gen: 'g1' })
    host.cancel('g1')
    expect(child().sent.at(-1)).toMatchObject({ type: 'cancel', gen: 'g1' })
    child().respond({ id: synth.id, type: 'cancelled' })
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    host.dispose()
  })

  it('an unexpected exit restarts the worker once, like a hang', async () => {
    const { host, child, forks } = hostWith(hangs)
    await host.start()
    const seen: TtsStatus[] = []
    host.onStatus((s) => seen.push(s))
    const first = child()
    const r = expect(host.synthesize('Hi.', OPTS)).rejects.toThrow(/voice engine stopped/)
    await vi.waitFor(() => expect(first.sent.some((m) => m.type === 'synthesize')).toBe(true))
    first.emit('exit', 1)
    await r
    await vi.waitFor(() => expect(host.status()).toBe('ready'))
    expect(forks()).toBe(2)
    expect(seen).toEqual(['restarting', 'loading'
, 'ready'])
    host.dispose()
  })
})
