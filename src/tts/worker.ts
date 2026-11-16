// Runs inside an Electron utilityProcess. Loads Kokoro from the bundled model dir and
// answers TtsRequests from the main process. Never touches the network.
import type { KokoroTTS } from 'kokoro-js'
import type { TtsRequest, TtsResponse } from './protocol'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

// Installed before kokoro-js / transformers are imported (they are loaded lazily below),
// so any hidden download fails loudly instead of silently reaching out.
if (process.env.TIDE_OFFLINE_GUARD === '1') {
  globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    throw new Error(`network access attempted: ${url}`)
  }
}

let tts: KokoroTTS | null = null

async function handle(msg: TtsRequest): Promise<TtsResponse> {
  switch (msg.type) {
    case 'load': {
      const t0 = performance.now()
      // Use transformers' own env (kokoro-js's `env` only exposes wasmPaths).
      const { env } = await import('@huggingface/transformers')
      env.allowRemoteModels = false
      env.allowLocalModels = true
      env.localModelPath = msg.modelDir
      // Read straight from the bundled model dir; never consult or write a cache.
      env.useFSCache = false
      env.useBrowserCache = false
      const { KokoroTTS } = await import('kokoro-js')
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: msg.dtype, device: 'cpu' })
      return { id: msg.id, type: 'loaded', loadMs: Math.round(performance.now() - t0) }
    }
    case 'synthesize': {
      if (!tts) throw new Error('voice engine is not loaded')
      const t0 = performance.now()
      // Splitting into ≤400-token chunks is wired in by Task 4; for now one generate call.
      // kokoro-js validates the voice id itself and throws a readable error for unknown ones.
      const voice = msg.voice as NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']
      const audio = await tts.generate(msg.text, { voice, speed: msg.speed })
      return {
        id: msg.id,
        type: 'audio',
        pcm: audio.audio,
        sampleRate: 24000,
        synthMs: Math.round(performance.now() - t0),
        chunks: 1
      }
    }
  }
}

function reply(res: TtsResponse): void {
  process.parentPort.postMessage(res)
}

// One request at a time: ONNX inference is not re-entrant, and order is preserved.
let queue: Promise<void> = Promise.resolve()

process.parentPort.on('message', (e) => {
  const msg = e.data as TtsRequest
  queue = queue.then(async () => {
    try {
      reply(await handle(msg))
    } catch (err) {
      reply({
        id: msg?.id ?? -1,
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  })
})
