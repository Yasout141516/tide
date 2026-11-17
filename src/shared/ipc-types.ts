// Shapes that cross the main ↔ renderer IPC bridge. Types only: the renderer's d.ts imports them.
import type { PickResult } from './library/types'

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

/** Menu and shortcut commands main sends to the renderer. */
export type AppCommand =
  | { type: 'add-reading' }
  | { type: 'zoom'; step: 1 | -1 }
  | { type: 'open-failed' }
  | { type: 'open-pick'; pick: Exclude<PickResult, { kind: 'cancelled' }> }

/**
 * Library failures the renderer can tell apart. They travel as an Error whose message is
 * `tide-error:<code>`; use `libraryErrorCode` to read one. Messages never contain a file path.
 */
export type LibraryErrorCode = 'file-unreadable' | 'already-on-shelf' | 'failed'

export const LIBRARY_ERROR_PREFIX = 'tide-error:'

export function libraryErrorCode(err: unknown): LibraryErrorCode | null {
  const m = err instanceof Error ? /tide-error:([a-z-]+)/.exec(err.message) : null
  return m ? (m[1] as LibraryErrorCode) : null
}
