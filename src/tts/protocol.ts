// Messages between the main process (TtsHost) and the TTS utilityProcess (worker.ts).
import type { SAMPLE_RATE } from '../shared/pcm'

export type VoiceId = string // e.g. 'af_heart'

export type TtsRequest =
  | { id: number; type: 'load'; modelDir: string; dtype: 'q8' | 'fp32' }
  | { id: number; type: 'synthesize'; text: string; voice: VoiceId; speed: number }

export type TtsResponse =
  | { id: number; type: 'loaded'; loadMs: number }
  | {
      id: number
      type: 'audio'
      pcm: Float32Array
      sampleRate: typeof SAMPLE_RATE
      synthMs: number
      chunks: number
    }
  | { id: number; type: 'error'; message: string }
