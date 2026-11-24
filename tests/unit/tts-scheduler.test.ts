import { describe, expect, it } from 'vitest'
import { JobQueue } from '../../src/tts/queue'
import type { Priority, TtsResponse } from '../../src/tts/protocol'
import { createPump, type SynthJobLike } from '../../src/tts/scheduler'

type Job = SynthJobLike

let nextId = 1
const job = (text: string, priority: Priority, gen = `g${nextId}`): Job => ({
  id: nextId++,
  text,
  voice: 'v',
  speed: 1,
  priority,
  gen
})

/** Chunks are the '|'-separated parts of the text; each chunk's "audio" is one sample holding its number. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function rig(opts: { preempt?: boolean } = {}) {
  const queue = new JobQueue<Job>()
  const cancelled = new Set<string>()
  const replies: TtsResponse[] = []
  const generated: string[] = []
  let afterGenerate: (chunk: string) => void = () => {}
  const pump = createPump<Job>({
    queue,
    chunks: (text) => Promise.resolve(text.split('|')),
    chunkLimit: () => 400,
    generate: async (chunk) => {
      generated.push(chunk)
      afterGenerate(chunk) // a message arriving while inference runs
      await new Promise((r) => setImmediate(r))
      return Float32Array.of(Number(chunk.replace(/\D/g, '')))
    },
    isLoaded: () => true,
    isCancelled: (gen) => cancelled.has(gen),
    reply: (r) => replies.push(r),
    yieldToMessages: () => new Promise((r) => setImmediate(r)),
    concat: (parts) => Float32Array.from(parts.flatMap((p) => [...p])),
    sampleRate: 24000,
    now: () => 0,
    ...opts
  })
  return {
    queue,
    cancelled,
    replies,
    generated,
    pump,
    onGenerate: (fn: (chunk: string) => void) => (afterGenerate = fn),
    audioOf: (j: Job): number[] => {
      const r = replies.find((x) => x.id === j.id && x.type === 'audio')
      return r && r.type === 'audio' ? [...r.pcm] : []
    },
    typeOf: (j: Job): string[] => replies.filter((x) => x.id === j.id).map((x) => x.type),
    order: (): string[] =>
      replies.filter((x) => x.type === 'audio' || x.type === 'cancelled').map((x) => String(x.id))
  }
}

describe('worker scheduler: priority between chunks (R35)', () => {
  it('a live job that arrives mid-export runs before the export’s remaining chunks, which then resume in order', async () => {
    const r = rig()
    const exp = job('e1|e2|e3', 'export')
    const live = job('l1', 'live')
    r.queue.push(exp)
    r.onGenerate((c) => {
      if (c === 'e1') r.queue.push(live) // arrives while the first export chunk is generating
    })
    await r.pump()
    expect(r.generated).toEqual(['e1', 'l1', 'e2', 'e3'])
    expect(r.audioOf(live)).toEqual([1])
    expect(r.audioOf(exp)).toEqual([1, 2, 3]) // in order, complete
    expect(r.order()).toEqual([String(live.id), String(exp.id)]) // live answered first
    expect(r.typeOf(exp)).toEqual(['started', 'audio'])
  })

  it('without the fix the live job waits for every export chunk (control)', async () => {
    const r = rig({ preempt: false })
    const exp = job('e1|e2|e3', 'export')
    const live = job('l1', 'live')
    r.queue.push(exp)
    r.onGenerate((c) => c === 'e1' && r.queue.push(live))
    await r.pump()
    expect(r.generated).toEqual(['e1', 'e2', 'e3', 'l1'])
  })

  it('preview goes ahead of export, and live ahead of a running preview', async () => {
    const r = rig()
    const exp = job('e1|e2', 'export')
    const prev = job('p1|p2', 'preview')
    const live = job('l1', 'live')
    r.queue.push(exp)
    r.onGenerate((c) => {
      if (c === 'e1') r.queue.push(prev)
      if (c === 'p1') r.queue.push(live)
    })
    await r.pump()
    expect(r.generated).toEqual(['e1', 'p1', 'l1', 'p2', 'e2'])
    expect(r.audioOf(prev)).toEqual([1, 2])
    expect(r.audioOf(exp)).toEqual([1, 2])
  })

  it('an export never goes ahead of live, and equal priorities do not interleave', async () => {
    const r = rig()
    const live1 = job('a1|a2', 'live')
    const live2 = job('b1', 'live')
    const exp = job('e1', 'export')
    r.queue.push(live1)
    r.onGenerate((c) => {
      if (c === 'a1') {
        r.queue.push(exp)
        r.queue.push(live2)
      }
    })
    await r.pump()
    expect(r.generated).toEqual(['a1', 'a2', 'b1', 'e1'])
  })

  it('cancelling the export while a live job runs ends the export and still finishes the live job', async () => {
    const r = rig()
    const exp = job('e1|e2|e3', 'export', 'gexp')
    const live = job('l1|l2', 'live')
    r.queue.push(exp)
    r.onGenerate((c) => {
      if (c === 'e1') r.queue.push(live)
      if (c === 'l1') r.cancelled.add('gexp')
    })
    await r.pump()
    expect(r.generated).toEqual(['e1', 'l1', 'l2'])
    expect(r.audioOf(live)).toEqual([1, 2])
    expect(r.typeOf(exp)).toEqual(['started', 'cancelled'])
  })

  it('cancelling the live job that stepped in leaves the export resuming and completing', async () => {
    const r = rig()
    const exp = job('e1|e2', 'export')
    const live = job('l1|l2', 'live', 'glive')
    r.queue.push(exp)
    r.onGenerate((c) => {
      if (c === 'e1') r.queue.push(live)
      if (c === 'l1') r.cancelled.add('glive')
    })
    await r.pump()
    expect(r.generated).toEqual(['e1', 'l1', 'e2'])
    expect(r.typeOf(live)).toEqual(['started', 'cancelled'])
    expect(r.audioOf(exp)).toEqual([1, 2])
  })

  it('a stepped-in job that was already cancelled while queued is skipped without running', async () => {
    const r = rig()
    const exp = job('e1|e2', 'export')
    const live = job('l1', 'live', 'glive')
    r.queue.push(exp)
    r.onGenerate((c) => {
      if (c === 'e1') {
        r.queue.push(live)
        r.cancelled.add('glive')
      }
    })
    await r.pump()
    expect(r.generated).toEqual(['e1', 'e2'])
    expect(r.typeOf(live)).toEqual(['cancelled'])
  })

  it('a failing live job answers with an error and the export carries on', async () => {
    const r = rig()
    const exp = job('e1|e2', 'export')
    const live = job('boom', 'live')
    r.queue.push(exp)
    r.onGenerate((c) => {
      if (c === 'e1') r.queue.push(live)
      if (c === 'boom') throw new Error('bad voice')
    })
    await r.pump()
    expect(r.typeOf(live)).toEqual(['started', 'error'])
    expect(r.audioOf(exp)).toEqual([1, 2])
  })
})
