import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { LibrarySettings } from '../shared/library/types'

export interface Log {
  /** Never throws. Appends to the log file and also writes to console.error. */
  error(scope: string, err: unknown): void
  /** Plain text she can paste into a message: versions, settings (counts only), recent log lines. */
  diagnostics(info: Record<string, string>): Promise<string>
}

const DEFAULT_MAX_BYTES = 512 * 1024
const TAIL_LINES = 200

function describe(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n${err.stack}` : err.message
  try {
    return typeof err === 'string' ? err : (JSON.stringify(err) ?? String(err))
  } catch {
    return String(err)
  }
}

function readOrEmpty(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * A two-file rotating log (tide.log + tide.1.log). Synchronous appends: logging is rare, and a sync
 * write survives a crash that follows straight after.
 */
export function createLog(dir: string, o: { maxBytes?: number; home?: string } = {}): Log {
  const maxBytes = o.maxBytes ?? DEFAULT_MAX_BYTES
  const home = o.home ?? homedir()
  const file = join(dir, 'tide.log')
  const old = join(dir, 'tide.1.log')
  const scrub = (s: string): string => {
    if (!home) return s
    return s.split(home).join('~').split(home.replace(/\\/g, '/')).join('~')
  }
  return {
    error(scope, err) {
      try {
        console.error(`[tide] ${scope}:`, err)
      } catch {
        // nothing to do
      }
      try {
        const entry = scrub(`${new Date().toISOString()} [${scope}] ${describe(err)}\n`)
        mkdirSync(dir, { recursive: true })
        let size = 0
        try {
          size = statSync(file).size
        } catch {
          // no file yet
        }
        if (size > 0 && size + Buffer.byteLength(entry) > maxBytes) {
          rmSync(old, { force: true })
          renameSync(file, old)
        }
        appendFileSync(file, entry)
      } catch {
        // The log must never be the thing that breaks Tide.
      }
    },
    async diagnostics(info) {
      const head = Object.entries(info).map(([k, v]) => `${k}: ${v}`)
      const lines = (readOrEmpty(old) + readOrEmpty(file)).split('\n').filter((l) => l !== '')
      const tail = lines.slice(-TAIL_LINES).join('\n')
      return scrub([...head, '', '--- Recent log ---', tail || '(empty)'].join('\n')) + '\n'
    }
  }
}

let current: Log | null = null

/** Installed once main knows userData. Until then (and in unit tests) errors go to the console only. */
export function setLog(log: Log | null): void {
  current = log
}

/** The one call every main-process error site uses. Keeps the `[tide]` console output. */
export function logError(scope: string, err: unknown): void {
  if (current) current.error(scope, err)
  else {
    try {
      console.error(`[tide] ${scope}:`, err)
    } catch {
      // ignore
    }
  }
}

/** The facts that go in the diagnostics header. Pronunciations are a count only; no paths, no titles. */
export function diagnosticInfo(p: {
  appVersion: string
  electron: string
  os: string
  osRelease: string
  arch: string
  voice: string
  /** null when the shelf could not be opened. */
  settings: LibrarySettings | null
}): Record<string, string> {
  const s = p.settings
  const settingsInfo: Record<string, string> = s
    ? {
        Theme: s.theme,
        'Dark pages': s.darkPages ? 'on' : 'off',
        'Reading filters': Object.entries(s.reading)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(', '),
        'Pronunciation fixes': String(s.pronunciations.length)
      }
    : { Settings: 'unavailable (the shelf could not be opened)' }
  return {
    Tide: p.appVersion,
    Electron: p.electron,
    OS: `${p.os} ${p.osRelease}`,
    Arch: p.arch,
    'Voice engine': p.voice,
    ...settingsInfo
  }
}
