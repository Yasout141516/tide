type ExportM4bResult = import('../shared/ipc-types').ExportM4bResult
type SynthesizeOptions = import('../shared/ipc-types').SynthesizeOptions
type TtsAudio = import('../shared/ipc-types').TtsAudio
type TtsLoadResult = import('../shared/ipc-types').TtsLoadResult

declare global {
  interface Window {
    tide: {
      tts: {
        synthesize(text: string, o: SynthesizeOptions): Promise<TtsAudio>
      }
    }
    /** Present only when the app runs with TIDE_E2E=1. */
    tideTest?: {
      ttsLoad(): Promise<TtsLoadResult>
      /** Speaks two short pages and saves a 2-chapter .m4b to the absolute `outPath`. */
      exportM4b(outPath: string): Promise<ExportM4bResult>
    }
  }
}

export {}
