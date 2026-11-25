import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { LibrarySettings } from '../shared/library/types'
import { escapeRe } from '../shared/regex'

export interface Log {
  /** Never throws. Appends to the log file and also writes to console.error. */
  error(scope: string, err: unknown): void
  /** Plain text she can paste into a message: versions, settings (counts only), recent log lines. */
  diagnostics(info: Record<string, string>): Promise<string>
}

const DEFAULT_MAX_BYTES = 512 * 1024
const TAIL_LINES = 200

function describe(err: unknown): string {
  // A stack already starts with "Name: message", so it goes in alone.
  if (err instanceof Error) return err.stack ?? err.message
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
  // The folder is made once and the size tracked here, so an error costs no mkdir or stat.
  let size = 0
  let dirReady = false
  try {
    mkdirSync(dir, { recursive: true })
    dirReady = true
    size = statSync(file).size
  } catch {
    // no file yet (or no folder: the first write tries again)
  }
  return {
    error(scope, err) {
      consoleError(scope, err)
      try {
        const entry = scrub(`${new Date().toISOString()} [${scope}] ${describe(err)}\n`)
        if (!dirReady) {
          mkdirSync(dir, { recursive: true })
          dirReady = true
        }
        const add = Buffer.byteLength(entry)
        if (size > 0 && size + add > maxBytes) {
          rmSync(old, { force: true })
          renameSync(file, old)
          size = 0
        }
        appendFileSync(file, entry)
        size += add
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

// A path starts at an absolute-path prefix. If a quote character (' " `) comes right before it, it
// runs to the next occurrence of that same quote not followed by a word character (an apostrophe
// inside a name, `John's`, is part of it; no such quote means end of line); otherwise to a `)` that closes a stack frame
// (optionally followed by :line:col, then end of line), or to the end of the line. Spaces,
// parentheses and (when unquoted) quotes inside are part of the path (`D:\John's Notes\a.pdf`).
const QUOTE_BEFORE = String.raw`(?<=(['"\x60]))`
const NOT_QUOTE_BEFORE = String.raw`(?<!['"\x60])`
const QUOTED_RUN = String.raw`(?:(?!\1(?![\p{L}\p{N}_]))[^\r\n])*`
const OPEN_RUN = String.raw`(?:[^\r\n)]|\)(?!(?::\d+)*\r?$))*`
const withRun = (starts: string): string =>
  `(?:${QUOTE_BEFORE}(?:${starts})${QUOTED_RUN}|${NOT_QUOTE_BEFORE}(?:${starts})${OPEN_RUN})`

const DRIVE = String.raw`(?:file:///)?(?<!\w)[A-Za-z]:[\\/]`
const UNC = String.raw`\\{2,}[\w.$-]+\\+`
const FILE_HOST = String.raw`file://(?=[\w.-])`
const POSIX = String.raw`(?:file://(?=/)|(?<![\w.:/<\\]))/(?=[^\s/'"\x60])`
const PATHS = new RegExp(withRun(`${DRIVE}|${UNC}|${FILE_HOST}|${POSIX}`), 'gmu')

/** Every absolute path (drive, UNC, POSIX, file://, the home dir) becomes `<path>`, file name and all. */
function makeScrub(home: string): (s: string) => string {
  let homeRe: RegExp | null = null
  if (home) {
    const win = /^[A-Za-z]:/.test(home)
    const forms = new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')])
    const starts = `(?:${[...forms].map(escapeRe).join('|')})(?!\\w)`
    homeRe = new RegExp(withRun(starts), win ? 'gimu' : 'gmu')
  }
  // Text with no slash or backslash holds no path.
  return (s) =>
    /[\\/]/.test(s) ? (homeRe ? s.replace(homeRe, '<path>') : s).replace(PATHS, '<path>') : s
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
  // Times of the last `max` writes: a sliding window, so a burst straddling a boundary still caps.
  const times: number[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  // Every entry written, summaries included, counts against the budget.
  const allow = (): boolean => {
    const t = now()
    while (times.length > 0 && t - times[0] >= windowMs) times.shift()
    if (times.length >= max) return false
    times.push(t)
    return true
  }
  // A repeat summary that finds the budget spent is dropped (its count is not carried forward).
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (repeats > 0 && allow()) {
      log.error('renderer', `(previous message repeated ${repeats} times)`)
    }
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
      if (!allow()) return
      last = message
      log.error('renderer', message)
    }
  }
}

/** The `[tide]` console output; never throws. */
function consoleError(scope: string, err: unknown): void {
  try {
    console.error(`[tide] ${scope}:`, err)
  } catch {
    // nothing to do
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
  else consoleError(scope, err)
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
