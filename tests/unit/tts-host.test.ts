import { EventEmitter } from 'events'
import { describe, it, expect, vi } from 'vitest'
import { TtsHost, type ForkFn, type TtsChild } from '../../src/main/tts-host'
import type { TtsRequest, TtsResponse } from '../../src/tts/protocol'

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
): { host: TtsHost; child: () => FakeChild } {
  let child!: FakeChild
  const fork: ForkFn = () => (child = new FakeChild(reply))
  const host = new TtsHost({ workerPath: 'worker.js', modelDir: '/models', timeoutMs, fork })
  return { host, child: () => child }
}

const loads = (req: TtsRequest, c: FakeChild): void => {
  if (req.type === 'load') c.respond({ id: req.id, type: 'loaded', loadMs: 7 })
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
    expect(child().sent[0]).toMatchObject({ type: 'load', modelDir: '/models', dtype: 'q8' })
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
})
