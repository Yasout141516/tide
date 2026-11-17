// Runs inside an Electron utilityProcess. Loads Kokoro from the bundled model dir and
// answers TtsRequests from the main process. Never touches the network.
import type { KokoroTTS } from 'kokoro-js'
import { concatPcm, SAMPLE_RATE } from '../shared/pcm'
import { blockNetwork, configureOffline, MODEL_ID, speechChunks } from './engine'
import type { TtsRequest, TtsResponse } from './protocol'

// Installed before kokoro-js / transformers are imported (they are loaded lazily below),
// so any hidden download fails loudly instead of silently reaching out.
if (process.env.TIDE_OFFLINE_GUARD === '1') blockNetwork()

let tts: KokoroTTS | null = null

async function handle(msg: TtsRequest): Promise<TtsResponse> {
  switch (msg.type) {
    case 'load': {
      const t0 = performance.now()
      await configureOffline(msg.modelDir)
      const { KokoroTTS } = await import('kokoro-js')
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: msg.dtype, device: 'cpu' })
      return { id: msg.id, type: 'loaded', loadMs: Math.round(performance.now() - t0) }
    }
    case 'synthesize': {
      if (!tts) throw new Error('voice engine is not loaded')
      const t0 = performance.now()
      // Kokoro truncates silently past ~510 tokens, so synthesize chunks of at most 400 and join.
      // kokoro-js validates the voice id itself and throws a readable error for unknown ones.
      const voice = msg.voice as NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']
      const chunks = await speechChunks(msg.text)
      const parts: Float32Array[] = []
      for (const chunk of chunks) {
        const audio = await tts.generate(chunk, { voice, speed: msg.speed })
        parts.push(audio.audio)
      }
      return {
        id: msg.id,
        type: 'audio',
        pcm: concatPcm(parts),
        sampleRate: SAMPLE_RATE,
        synthMs: Math.round(performance.now() - t0),
        chunks: chunks.length
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
