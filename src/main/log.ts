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
  const scrub = makeScrub(home)
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

// One path segment: no whitespace, separators, quotes, brackets or colons (so `file.js:1:2)` keeps its tail).
const SEG = '[^\\s\\\\/"\'<>|*?():]+'
// A separator, including JSON-escaped (doubled) backslashes.
const SEP = '(?:\\\\+|/)'
const DRIVE_PATH = new RegExp(`(?<!\\w)[A-Za-z]:${SEP}(?:${SEG}(?:${SEP}${SEG})*)?`, 'g')
const UNC_PATH = new RegExp(`\\\\\\\\+[\\w.$-]+(?:\\\\+${SEG})+`, 'g')
const POSIX_PATH = new RegExp(`(?<![\\w.:/<~\\\\])/${SEG}(?:/${SEG})+`, 'g')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Home dir becomes `~` (boundary-aware, case-insensitive for Windows paths, also in forward-slash
 * and JSON-escaped forms); then every other absolute path becomes `<path>`. A path containing a
 * space is cut at the space (the rest stays): the price of not eating whole sentences.
 */
function makeScrub(home: string): (s: string) => string {
  let homeRe: RegExp | null = null
  if (home) {
    const win = /^[A-Za-z]:/.test(home)
    const forms = new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')])
    homeRe = new RegExp(`(?:${[...forms].map(escapeRe).join('|')})(?!\\w)`, win ? 'gi' : 'g')
  }
  return (s) => {
    const t = homeRe ? s.replace(homeRe, '~') : s
    return t.replace(DRIVE_PATH, '<path>').replace(UNC_PATH, '<path>').replace(POSIX_PATH, '<path>')
  }
}

/**
 * Sits between the renderer's app:log and the log: identical consecutive messages are counted, not
 * rewritten, and at most `max` entries per window are kept (the rest dropped), so an error loop
 * cannot flood the file or push out useful history.
 */
export function createRendererGate(
  log: Pick<Log, 'error'>,
  o: { now?: () => number; max?: number; windowMs?: number } = {}
): { push(message: string): void; flush(): void } {
  const now = o.now ?? Date.now
  const max = o.max ?? 20
  const windowMs = o.windowMs ?? 60_000
  let last: string | null = null
  let repeats = 0
  let start = -Infinity
  let used = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (repeats > 0) log.error('renderer', `(previous message repeated ${repeats} times)`)
    repeats = 0
  }
  return {
    flush,
    push(message) {
      if (message === last) {
        repeats++
        if (!timer) {
          timer = setTimeout(flush, 2000)
          timer.unref?.()
        }
        return
      }
      flush()
      const t = now()
      if (t - start >= windowMs) {
        start = t
        used = 0
      }
      if (used >= max) return
      used++
      last = message
      log.error('renderer', message)
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
