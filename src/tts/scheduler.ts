// The worker's job scheduler, free of Electron and Kokoro so it can be tested and measured.
// One job runs at a time (ONNX inference is not re-entrant), but a running job of lower priority
// steps aside between its chunks for one waiting job of higher priority (live > preview > export),
// then advances a chunk and resumes in order, so a busy higher lane cannot starve it.
import { concatPcm, SAMPLE_RATE } from '../shared/pcm'
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
  now(): number
}

/** Returns `pump`: drains the queue; calling it while it runs does nothing (it will see new jobs). */
export function createPump<J extends SynthJobLike>(d: SchedulerDeps<J>): () => Promise<void> {
  async function synthesize(msg: J): Promise<TtsResponse> {
    if (!d.isLoaded()) throw new Error('voice engine is not loaded')
    const t0 = d.now()
    // Kokoro truncates silently past ~510 tokens, so synthesize short chunks and join (live: smaller, so a cancel lands sooner).
    const chunks = await d.chunks(msg.text, d.chunkLimit(msg.priority))
    const parts: Float32Array[] = []
    for (const chunk of chunks) {
      await d.yieldToMessages()
      // A waiting higher-priority job goes first; this job's remaining chunks resume after it.
      const stepped = await runHigher(msg.priority)
      if (d.isCancelled(msg.gen)) return { id: msg.id, type: 'cancelled' }
      // R36: resuming after nested jobs, so the host restarts this job's timeout.
      if (stepped) d.reply({ id: msg.id, type: 'started' })
      parts.push(await d.generate(chunk, msg.voice, msg.speed))
    }
    if (d.isCancelled(msg.gen)) return { id: msg.id, type: 'cancelled' }
    return {
      id: msg.id,
      type: 'audio',
      pcm: concatPcm(parts),
      sampleRate: SAMPLE_RATE,
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

  /**
   * Runs at most ONE waiting higher-priority job (R38b, fairness): the stepping-aside job then
   * advances a chunk before the next boundary, so a live job that is always pending cannot starve it.
   * True if it ran one.
   */
  async function runHigher(priority: Priority): Promise<boolean> {
    const h = d.queue.nextAbove(priority)
    if (!h) return false
    await runOne(h)
    return true
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
