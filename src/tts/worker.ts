// Runs inside an Electron utilityProcess. Loads Kokoro from the bundled model dir and
// answers TtsRequests from the main process. Never touches the network.
import type { KokoroTTS } from 'kokoro-js'
import { concatPcm, SAMPLE_RATE } from '../shared/pcm'
import {
  blockNetwork,
  chunkLimit,
  configureOffline,
  LIVE_MAX_TOKENS,
  MODEL_ID,
  speechChunks
} from './engine'
import { JobQueue } from './queue'
import { createPump } from './scheduler'
import type { TtsRequest, TtsResponse } from './protocol'

// Installed before kokoro-js / transformers are imported (they are loaded lazily below),
// so any hidden download fails loudly instead of silently reaching out.
if (process.env.TIDE_OFFLINE_GUARD === '1') blockNetwork()

type LoadJob = Extract<TtsRequest, { type: 'load' }>
type SynthJob = Extract<TtsRequest, { type: 'synthesize' }>

let tts: KokoroTTS | null = null

type Voice = NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']

/** Generations the main process cancelled; a running job of one stops between chunks. */
const cancelledGens = new Set<string>()
/** Gens are unique per request, so the set would only grow; the oldest are long finished. */
const MAX_CANCELLED = 512

function rememberCancelled(gen: string): void {
  cancelledGens.add(gen)
  for (const old of cancelledGens) {
    if (cancelledGens.size <= MAX_CANCELLED) break
    cancelledGens.delete(old)
  }
}

async function load(msg: LoadJob): Promise<TtsResponse> {
  const t0 = performance.now()
  await configureOffline(msg.modelDir)
  const { KokoroTTS } = await import('kokoro-js')
  tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: msg.dtype, device: 'cpu' })
  const loadMs = Math.round(performance.now() - t0)
  // Warm-up: the first inference pays one-off costs, so pay them now and drop the audio.
  const t1 = performance.now()
  await tts.generate('Ready.', { voice: msg.warmVoice as Voice, speed: 1 })
  // Counting tokens loads the phonemizer on first use (seconds); sentences with digits or acronyms need it.
  await speechChunks('Ready in 1984, OK.', LIVE_MAX_TOKENS)
  return { id: msg.id, type: 'loaded', loadMs, warmMs: Math.round(performance.now() - t1) }
}

/**
 * Inference keeps the thread busy, so a queued `cancel` message is only delivered if the loop gets
 * a turn. Taking one between chunks and between jobs is what lets a cancel land within one chunk.
 */
const yieldToMessages = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function reply(res: TtsResponse): void {
  process.parentPort.postMessage(res)
}

function replyError(id: number, err: unknown): void {
  reply({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
}

// One job at a time: ONNX inference is not re-entrant. Cancels bypass the queue.
const queue = new JobQueue<SynthJob>()
// Loads share the lane with synthesis so a load is never interleaved with a job.
let loading: Promise<void> = Promise.resolve()

const pump = createPump({
  queue,
  chunks: speechChunks,
  chunkLimit,
  generate: async (chunk, voice, speed) => {
    if (!tts) throw new Error('voice engine is not loaded')
    // kokoro-js validates the voice id itself and throws a readable error for unknown ones.
    return (await tts.generate(chunk, { voice: voice as Voice, speed })).audio
  },
  isLoaded: () => tts !== null,
  isCancelled: (gen) => cancelledGens.has(gen),
  reply,
  yieldToMessages,
  concat: concatPcm,
  sampleRate: SAMPLE_RATE,
  now: () => performance.now()
})

process.parentPort.on('message', (e) => {
  const msg = e.data as TtsRequest
  switch (msg?.type) {
    case 'load':
      loading = loading.then(async () => {
        try {
          reply(await load(msg))
        } catch (err) {
          replyError(msg.id, err)
        }
      })
      break
    case 'synthesize':
      // Generations are unique per play session: a cancelled gen is never reused.
      if (msg.front) queue.pushFront(msg)
      else queue.push(msg)
      void loading.then(pump)
      break
    case 'cancel':
      for (const job of queue.cancel(msg.gen)) reply({ id: job.id, type: 'cancelled' })
      rememberCancelled(msg.gen)
      break
    default:
      replyError((msg as { id?: number } | undefined)?.id ?? -1, new Error('unknown request'))
  }
})
