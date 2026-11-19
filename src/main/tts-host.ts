import { utilityProcess, type ForkOptions } from 'electron'
import type { SynthesizeOptions, TtsAudio, TtsLoadResult, TtsStatus } from '../shared/ipc-types'
import { DEFAULT_VOICE } from '../shared/voices'
import type { Priority, TtsRequest, TtsResponse } from '../tts/protocol'

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

export interface TtsHostOptions {
  workerPath: string
  modelDir: string
  dtype?: 'q8' | 'fp32'
  /** Overrides both the 30 s load and the per-job synthesis timeouts. */
  timeoutMs?: number
  fork?: ForkFn
}

export interface TtsSynthesizeOptions extends Omit<SynthesizeOptions, 'priority' | 'gen'> {
  /** Defaults to 'live'. */
  priority?: Priority
  /** Cancellation group; defaults to 'default'. */
  gen?: string
}

const LOAD_TIMEOUT_MS = 30_000

/** How long a synthesis may run once the worker has started it. */
export function jobTimeoutMs(text: string): number {
  return 30_000 + 150 * text.length
}

interface Pending {
  resolve: (res: TtsResponse) => void
  reject: (err: Error) => void
  /** For synthesis it only starts when the worker reports 'started'. */
  timer: ReturnType<typeof setTimeout> | null
  /** Starts the timer (synthesis jobs only). */
  arm: (() => void) | null
}

interface RequestTiming {
  timeoutMs: number
  message: (ms: number) => string
  /** true: start the timer on 'started' instead of on post. */
  fromStart: boolean
  /** Called right after the job's own rejection when the timer fires. */
  onTimeout?: () => void
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
  private starting: Promise<TtsLoadResult> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private currentStatus: TtsStatus = 'loading'
  private readonly listeners = new Set<(s: TtsStatus) => void>()
  /** Consecutive worker failures since the last successful synthesis. */
  private failures = 0
  /** Set by dispose() and by giving up after a second failure; no further restarts. */
  private stopped = false

  constructor(opts: TtsHostOptions) {
    this.opts = opts
    this.fork =
      opts.fork ?? ((modulePath, args, options) => utilityProcess.fork(modulePath, args, options))
  }

  status(): TtsStatus {
    return this.currentStatus
  }

  /** Subscribe to status changes (never a repeat of the current value). Returns an unsubscribe. */
  onStatus(cb: (s: TtsStatus) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Fork the worker and load the model. Idempotent: concurrent/repeat calls share one load. */
  start(): Promise<TtsLoadResult> {
    if (!this.starting) {
      this.setStatus('loading')
      const p = this.load()
      this.starting = p
      // A failed load is not cached, so a later call can retry with a fresh process.
      p.catch(() => {
        if (this.starting === p) this.starting = null
      })
    }
    return this.starting
  }

  async synthesize(text: string, o: TtsSynthesizeOptions): Promise<TtsAudio> {
    if (this.stopped) throw new Error('voice engine stopped')
    await this.start()
    const res = await this.request(
      {
        type: 'synthesize',
        text,
        voice: o.voice,
        speed: o.speed,
        priority: o.priority ?? 'live',
        gen: o.gen ?? 'default'
      },
      {
        timeoutMs: this.opts.timeoutMs ?? jobTimeoutMs(text),
        message: (ms) => `voice engine did not answer within ${ms} ms`,
        fromStart: true,
        onTimeout: () => this.recycle()
      }
    )
    if (res.type !== 'audio') throw new Error(`unexpected voice engine reply: ${res.type}`)
    this.failures = 0
    return { pcm: res.pcm, sampleRate: res.sampleRate, synthMs: res.synthMs, chunks: res.chunks }
  }

  /** Abort a generation: its queued jobs and a running one reject with an AbortError. */
  cancel(gen: string): void {
    this.child?.postMessage({ id: this.nextId++, type: 'cancel', gen })
  }

  dispose(): void {
    this.stopped = true
    this.teardown()
  }

  private teardown(): void {
    const child = this.child
    this.child = null
    this.starting = null
    this.rejectAll(new Error('voice engine stopped'))
    child?.kill()
  }

  private setStatus(s: TtsStatus): void {
    if (this.currentStatus === s) return
    this.currentStatus = s
    for (const cb of [...this.listeners]) cb(s)
  }

  /** A hang, crash or failed restart: restart once; the second failure in a row gives up. */
  private recycle(): void {
    if (this.stopped) return
    this.failures++
    if (this.failures >= 2) {
      this.stopped = true
      this.setStatus('failed')
      this.teardown()
      return
    }
    this.setStatus('restarting')
    this.teardown()
    this.start().catch(() => this.recycle())
  }

  private async load(): Promise<TtsLoadResult> {
    this.spawn()
    try {
      const res = await this.request(
        {
          type: 'load',
          modelDir: this.opts.modelDir,
          dtype: this.opts.dtype ?? 'fp32',
          warmVoice: DEFAULT_VOICE
        },
        {
          timeoutMs: this.opts.timeoutMs ?? LOAD_TIMEOUT_MS,
          message: (ms) => `voice engine did not load within ${ms} ms`,
          fromStart: false
        }
      )
      if (res.type !== 'loaded') throw new Error(`unexpected voice engine reply: ${res.type}`)
      this.setStatus('ready')
      return { loadMs: res.loadMs }
    } catch (err) {
      // A worker that failed or hung while loading is useless; drop it so a retry starts clean.
      this.teardown()
      this.setStatus('failed')
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
      if (res.type === 'started') {
        p.arm?.()
        return
      }
      this.pending.delete(res.id)
      if (p.timer) clearTimeout(p.timer)
      if (res.type === 'error') p.reject(new Error(res.message))
      else if (res.type === 'cancelled') {
        p.reject(Object.assign(new Error('synthesis cancelled'), { name: 'AbortError' }))
      } else p.resolve(res)
    })
    // Must be handled: an 'error' with no listener would throw ERR_UNHANDLED_ERROR in main.
    // Only log here; the 'exit' that always follows does the cleanup.
    child.on('error', (type, location) => {
      console.error(`[tide] voice engine fatal error: ${type} at ${location}`)
    })
    child.on('exit', () => {
      if (this.child !== child) return
      const wasReady = this.currentStatus === 'ready'
      this.child = null
      this.starting = null
      this.rejectAll(new Error('voice engine stopped'))
      // A crash while loading surfaces through the load's own rejection instead.
      if (wasReady) this.recycle()
    })
  }

  private request(body: RequestBody, timing: RequestTiming): Promise<TtsResponse> {
    const child = this.child
    if (!child) return Promise.reject(new Error('voice engine stopped'))
    const id = this.nextId++
    return new Promise<TtsResponse>((resolve, reject) => {
      const pending: Pending = { resolve, reject, timer: null, arm: null }
      const arm = (): void => {
        pending.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(timing.message(timing.timeoutMs)))
          timing.onTimeout?.()
        }, timing.timeoutMs)
      }
      if (timing.fromStart) pending.arm = arm
      else arm()
      this.pending.set(id, pending)
      child.postMessage({ ...body, id } as TtsRequest)
    })
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}
