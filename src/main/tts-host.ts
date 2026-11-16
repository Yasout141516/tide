import { utilityProcess, type ForkOptions } from 'electron'
import type { TtsRequest, TtsResponse, VoiceId } from '../tts/protocol'

/** The part of Electron's UtilityProcess the host uses (a fake implements it in unit tests). */
export interface TtsChild {
  postMessage(message: TtsRequest): void
  on(event: 'message', listener: (message: TtsResponse) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  /** Fatal V8 error in the child. Electron always follows it with 'exit'. */
  on(event: 'error', listener: (type: string, location: string, report: string) => void): this
  kill(): boolean
}

export type ForkFn = (modulePath: string, args?: string[], options?: ForkOptions) => TtsChild

export interface TtsAudio {
  pcm: Float32Array
  sampleRate: 24000
  synthMs: number
  chunks: number
}

export interface TtsHostOptions {
  workerPath: string
  modelDir: string
  dtype?: 'q8' | 'fp32'
  /** Overrides both the 30 s load and the 60 s per-synthesis timeouts. */
  timeoutMs?: number
  fork?: ForkFn
}

const LOAD_TIMEOUT_MS = 30_000
const SYNTH_TIMEOUT_MS = 60_000

interface Pending {
  resolve: (res: TtsResponse) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// Distributive Omit so each request variant keeps its own fields.
type RequestBody = TtsRequest extends infer R
  ? R extends TtsRequest
    ? Omit<R, 'id'>
    : never
  : never

/** Owns the TTS utilityProcess: request/response matching by id, timeouts, crash handling. */
export class TtsHost {
  private readonly opts: TtsHostOptions
  private readonly fork: ForkFn
  private child: TtsChild | null = null
  private starting: Promise<{ loadMs: number }> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(opts: TtsHostOptions) {
    this.opts = opts
    this.fork =
      opts.fork ?? ((modulePath, args, options) => utilityProcess.fork(modulePath, args, options))
  }

  /** Fork the worker and load the model. Idempotent: concurrent/repeat calls share one load. */
  start(): Promise<{ loadMs: number }> {
    if (!this.starting) {
      const p = this.load()
      this.starting = p
      // A failed load is not cached, so a later call can retry with a fresh process.
      p.catch(() => {
        if (this.starting === p) this.starting = null
      })
    }
    return this.starting
  }

  async synthesize(text: string, o: { voice: VoiceId; speed: number }): Promise<TtsAudio> {
    await this.start()
    const res = await this.request(
      { type: 'synthesize', text, voice: o.voice, speed: o.speed },
      this.opts.timeoutMs ?? SYNTH_TIMEOUT_MS,
      (ms) => `voice engine did not answer within ${ms} ms`
    )
    if (res.type !== 'audio') throw new Error(`unexpected voice engine reply: ${res.type}`)
    return { pcm: res.pcm, sampleRate: res.sampleRate, synthMs: res.synthMs, chunks: res.chunks }
  }

  dispose(): void {
    const child = this.child
    this.child = null
    this.starting = null
    this.rejectAll(new Error('voice engine stopped'))
    child?.kill()
  }

  private async load(): Promise<{ loadMs: number }> {
    this.spawn()
    try {
      const res = await this.request(
        { type: 'load', modelDir: this.opts.modelDir, dtype: this.opts.dtype ?? 'q8' },
        this.opts.timeoutMs ?? LOAD_TIMEOUT_MS,
        (ms) => `voice engine did not load within ${ms} ms`
      )
      if (res.type !== 'loaded') throw new Error(`unexpected voice engine reply: ${res.type}`)
      return { loadMs: res.loadMs }
    } catch (err) {
      // A worker that failed or hung while loading is useless; drop it so a retry starts clean.
      this.dispose()
      throw err
    }
  }

  private spawn(): void {
    const child = this.fork(this.opts.workerPath, [], {
      // Explicit env so TIDE_OFFLINE_GUARD etc. reach the worker.
      env: { ...process.env },
      serviceName: 'Tide Voice'
    })
    this.child = child
    child.on('message', (res) => {
      const p = this.pending.get(res.id)
      if (!p) return // late reply to a request that already timed out
      this.pending.delete(res.id)
      clearTimeout(p.timer)
      if (res.type === 'error') p.reject(new Error(res.message))
      else p.resolve(res)
    })
    // Must be handled: an 'error' with no listener would throw ERR_UNHANDLED_ERROR in main.
    // Only log here; the 'exit' that always follows does the cleanup.
    child.on('error', (type, location) => {
      console.error(`[tide] voice engine fatal error: ${type} at ${location}`)
    })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.starting = null
      this.rejectAll(new Error('voice engine stopped'))
    })
  }

  private request(
    body: RequestBody,
    timeoutMs: number,
    timeoutMessage: (ms: number) => string
  ): Promise<TtsResponse> {
    const child = this.child
    if (!child) return Promise.reject(new Error('voice engine stopped'))
    const id = this.nextId++
    return new Promise<TtsResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(timeoutMessage(timeoutMs)))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.postMessage({ ...body, id } as TtsRequest)
    })
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}
