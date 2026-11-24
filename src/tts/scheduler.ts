// The worker's job scheduler, free of Electron and Kokoro so it can be tested and measured.
// One job runs at a time (ONNX inference is not re-entrant), but a running job of lower priority
// steps aside between its chunks for any waiting job of higher priority (live > preview > export),
// then resumes with its remaining chunks in order.
import type { JobQueue } from './queue'
import type { Priority, TtsResponse } from './protocol'

export interface SynthJobLike {
  id: number
  text: string
  voice: string
  speed: number
  priority: Priority
  gen: string
}

export interface SchedulerDeps<J extends SynthJobLike> {
  queue: JobQueue<J>
  chunks(text: string, maxTokens: number): Promise<string[]>
  chunkLimit(priority: Priority): number
  generate(chunk: string, voice: string, speed: number): Promise<Float32Array>
  isLoaded(): boolean
  isCancelled(gen: string): boolean
  reply(res: TtsResponse): void
  /** A turn for the message loop, so a queued cancel or a new job can arrive. */
  yieldToMessages(): Promise<void>
  concat(parts: Float32Array[]): Float32Array
  sampleRate: 24000
  now(): number
  /** false: never step aside (the behaviour before R35; for measuring only). Default true. */
  preempt?: boolean
}

/** Returns `pump`: drains the queue; calling it while it runs does nothing (it will see new jobs). */
export function createPump<J extends SynthJobLike>(d: SchedulerDeps<J>): () => Promise<void> {
  const preempt = d.preempt ?? true

  async function synthesize(msg: J): Promise<TtsResponse> {
    if (!d.isLoaded()) throw new Error('voice engine is not loaded')
    const t0 = d.now()
    // Kokoro truncates silently past ~510 tokens, so synthesize short chunks and join (live: smaller, so a cancel lands sooner).
    const chunks = await d.chunks(msg.text, d.chunkLimit(msg.priority))
    const parts: Float32Array[] = []
    for (const chunk of chunks) {
      await d.yieldToMessages()
      // A waiting higher-priority job goes first; this job's remaining chunks resume after it.
      if (preempt) await runHigher(msg.priority)
      if (d.isCancelled(msg.gen)) return { id: msg.id, type: 'cancelled' }
      parts.push(await d.generate(chunk, msg.voice, msg.speed))
    }
    if (d.isCancelled(msg.gen)) return { id: msg.id, type: 'cancelled' }
    return {
      id: msg.id,
      type: 'audio',
      pcm: d.concat(parts),
      sampleRate: d.sampleRate,
      synthMs: Math.round(d.now() - t0),
      chunks: chunks.length
    }
  }

  async function runOne(job: J): Promise<void> {
    await d.yieldToMessages()
    if (d.isCancelled(job.gen)) {
      d.reply({ id: job.id, type: 'cancelled' })
      return
    }
    d.reply({ id: job.id, type: 'started' })
    try {
      d.reply(await synthesize(job))
    } catch (err) {
      d.reply({
        id: job.id,
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function runHigher(priority: Priority): Promise<void> {
    for (let h = d.queue.nextAbove(priority); h; h = d.queue.nextAbove(priority)) await runOne(h)
  }

  let running = false
  return async () => {
    if (running) return
    running = true
    try {
      for (let job = d.queue.next(); job; job = d.queue.next()) await runOne(job)
    } finally {
      running = false
    }
  }
}
