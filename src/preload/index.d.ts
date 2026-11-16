export interface TtsAudio {
  pcm: Float32Array
  sampleRate: 24000
  synthMs: number
  chunks: number
}

declare global {
  interface Window {
    tide: {
      tts: {
        synthesize(text: string, o: { voice: string; speed: number }): Promise<TtsAudio>
      }
    }
    /** Present only when the app runs with TIDE_E2E=1. */
    tideTest?: { ttsLoad(): Promise<{ loadMs: number }> }
  }
}
