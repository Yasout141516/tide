import { describe, it, expect } from 'vitest'
import { chunkLimit, LIVE_MAX_TOKENS, speechChunks } from '../../src/tts/engine'
import { JobQueue } from '../../src/tts/queue'
import type { Priority } from '../../src/tts/protocol'

type Job = { n: string; priority: Priority; gen: string }
const job = (n: string, priority: Priority, gen = 'g'): Job => ({ n, priority, gen })

describe('JobQueue', () => {
  it('orders live before preview before export, FIFO within a priority', () => {
    const q = new JobQueue<Job>()
    q.push(job('e1', 'export'))
    q.push(job('p1', 'preview'))
    q.push(job('l1', 'live'))
    q.push(job('p2', 'preview'))
    q.push(job('l2', 'live'))
    expect(q.size).toBe(5)
    const order: string[] = []
    for (let j = q.next(); j; j = q.next()) order.push(j.n)
    expect(order).toEqual(['l1', 'l2', 'p1', 'p2', 'e1'])
    expect(q.size).toBe(0)
  })

  it("cancel(gen) removes only that generation's queued jobs and returns them", () => {
    const q = new JobQueue<Job>()
    q.push(job('a1', 'live', 'a'))
    q.push(job('b1', 'live', 'b'))
    q.push(job('a2', 'export', 'a'))
    expect(q.cancel('a').map((j) => j.n)).toEqual(['a1', 'a2'])
    expect(q.size).toBe(1)
    expect(q.next()?.n).toBe('b1')
  })

  it('live jobs are split into chunks of at most LIVE_MAX_TOKENS so cancel lands within one chunk', async () => {
    expect(LIVE_MAX_TOKENS).toBe(120)
    expect(chunkLimit('live')).toBe(LIVE_MAX_TOKENS)
    expect(chunkLimit('export')).toBe(400)
    expect(chunkLimit('preview')).toBe(400)
    // tokens are counted as characters here; the sentence is ~270 characters of plain text
    const text =
      Array.from({ length: 9 }, (_, k) => `Clause number ${k} goes right here`).join(', ') + '.'
    const count = (s: string): Promise<number> => Promise.resolve(s.length)
    const live = await speechChunks(text, chunkLimit('live'), count)
    expect(live.length).toBeGreaterThan(1)
    for (const c of live) expect(c.length).toBeLessThanOrEqual(LIVE_MAX_TOKENS)
    expect(live.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '))
    expect(await speechChunks(text, chunkLimit('export'), count)).toEqual([text])
  })
})
