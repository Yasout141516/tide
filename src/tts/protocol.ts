// Messages between the main process (TtsHost) and the TTS utilityProcess (worker.ts).
import type { SAMPLE_RATE } from '../shared/pcm'

export type VoiceId = string // e.g. 'af_heart'

export type Priority = 'live' | 'preview' | 'export'

export type TtsRequest =
  | { id: number; type: 'load'; modelDir: string; dtype: 'q8' | 'fp32'; warmVoice: VoiceId }
  | {
      id: number
      type: 'synthesize'
      text: string
      voice: VoiceId
      speed: number
      priority: Priority
      gen: string
      /** Run before the jobs already queued at the same priority. */
      front?: boolean
    }
  | { id: number; type: 'cancel'; gen: string }

export type TtsResponse =
  | { id: number; type: 'loaded'; loadMs: number; warmMs: number }
  | { id: number; type: 'started' }
  /** One chunk of a synthesis job is done: the job is alive, so the host re-arms its timeout. */
  | { id: number; type: 'progress' }
  | {
      id: number
      type: 'audio'
      pcm: Float32Array
      sampleRate: typeof SAMPLE_RATE
      synthMs: number
      chunks: number
    }
  | { id: number; type: 'cancelled' }
  | { id: number; type: 'error'; message: string }
