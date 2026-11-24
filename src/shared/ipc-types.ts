// Shapes that cross the main ↔ renderer IPC bridge. Types only: the renderer's d.ts imports them.
import type { PickResult } from './library/types'

export interface SynthesizeOptions {
  voice: string
  speed: number
  /** 'live' (default) or 'preview'; export never comes from the renderer. */
  priority?: 'live' | 'preview'
  /** Cancellation group (at most 64 characters). */
  gen?: string
  /** Queue ahead of jobs already waiting in the same priority (a seek target). */
  front?: boolean
}

export interface TtsAudio {
  pcm: Float32Array
  /** Always SAMPLE_RATE (src/shared/pcm.ts); spelled out so the renderer types need no Node types. */
  sampleRate: 24000
  synthMs: number
  chunks: number
}

/** State of the voice engine as the host reports it. */
export type TtsStatus = 'loading' | 'ready' | 'restarting' | 'failed'

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

/** One "Save as audio" request. Main cleans `baseName` into a safe file name. */
export interface ExportSpec {
  readingId: string
  format: 'mp3' | 'm4b'
  /** No extension; main cleans it. */
  baseName: string
  /** Tag title: reading title plus range. */
  title: string
  sentences: { text: string; page: number }[]
  voice: string
  speed: number
}

export type ExportFailure = 'disk-full' | 'no-permission' | 'folder-missing' | 'failed'

export type ExportEvent =
  | { jobId: string; kind: 'progress'; done: number; total: number }
  | { jobId: string; kind: 'saved'; fileName: string }
  | { jobId: string; kind: 'failed'; reason: ExportFailure }
  | { jobId: string; kind: 'cancelled' }

/** Reply to `export.start`. */
export type ExportStartResult = { jobId: string } | { busy: true } | { cancelled: true }

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
