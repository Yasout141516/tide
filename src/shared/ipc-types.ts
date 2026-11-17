// Shapes that cross the main ↔ renderer IPC bridge. Types only: the renderer's d.ts imports them.

export interface SynthesizeOptions {
  voice: string
  speed: number
}

export interface TtsAudio {
  pcm: Float32Array
  /** Always SAMPLE_RATE (src/shared/pcm.ts); spelled out so the renderer types need no Node types. */
  sampleRate: 24000
  synthMs: number
  chunks: number
}

export interface TtsLoadResult {
  loadMs: number
}

/** Result of the e2e-only `test:export-m4b` hook (spike M0d). */
export interface ExportM4bResult {
  audioSec: number
  chapters: number
  exportMs: number
  ffmpegHasMp3: boolean
}
