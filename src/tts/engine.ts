// Kokoro setup shared by the TTS worker and scripts/voice-samples.ts. Imports nothing heavy at load
// time: transformers is loaded lazily, after the caller has had the chance to call blockNetwork().
import { splitForSpeech } from './split'
import { countTokens } from './tokens'

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

/** Replaces `fetch` so any hidden download fails loudly instead of silently reaching out. */
export function blockNetwork(): void {
  globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    throw new Error(`network access attempted: ${url}`)
  }
}

/** Points transformers at the bundled model dir, with remote models and every cache turned off. */
export async function configureOffline(modelDir: string): Promise<void> {
  // Use transformers' own env (kokoro-js's `env` only exposes wasmPaths).
  const { env } = await import('@huggingface/transformers')
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = modelDir
  // Read straight from the bundled model dir; never consult or write a cache.
  env.useFSCache = false
  env.useBrowserCache = false
}

/**
 * The chunks to synthesize for `text`: Kokoro truncates silently past ~510 tokens, so text is split
 * into chunks of at most 400, trimmed, with empty chunks dropped.
 */
export async function speechChunks(text: string): Promise<string[]> {
  return (await splitForSpeech(text, countTokens)).map((c) => c.trim()).filter((c) => c.length > 0)
}
