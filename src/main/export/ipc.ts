// IPC for "Save as audio": validates the request, runs one export job at a time and reports events.
import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { basename } from 'path'
import { app, ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { pickFolder } from '../folder-dialog'
import type { ExportEvent, ExportSpec, ExportStartResult } from '../../shared/ipc-types'
import { SPEEDS, VOICE_IDS, voiceName } from '../../shared/voices'
import { pathExists } from '../fs-util'
import { logError } from '../log'
import { boundedId, isStr } from '../validate'
import { runExport, type ExportDeps } from './job'
import { exportDir, failureReason, safeFileName, uniquePath } from './files'
import { MAX_NAME, MAX_SENTENCES, MAX_TEXT } from '../../shared/export-limits'
import { createM4bWriter, createMp3Writer, type AudioWriter } from './writers'

const PROGRESS_MS = 100
/** Saved paths kept for `reveal`: a reveal comes right after the saved event. */
const KEEP_SAVED = 20

const USAGE =
  'export:start expects { readingId, format: mp3 | m4b, baseName (up to 200 characters), title (up to 200 characters), sentences: 1 to 20000 of { text: up to 5000 characters, page: positive integer }, voice: one of the ten voices, speed: one of the speed steps }'

/** TIDE_MUSIC_DIR redirects the music folder for e2e runs only. */
export function resolveMusicDir(
  env: Record<string, string | undefined>,
  appMusicPath: () => string
): string {
  return (env.TIDE_E2E === '1' && env.TIDE_MUSIC_DIR) || appMusicPath()
}

/** Every sentence is { text up to MAX_TEXT, page a positive integer }, and at least one has text. */
function validSentences(sentences: unknown[]): boolean {
  let hasText = false
  for (const x of sentences) {
    const t = x as { text?: unknown; page?: unknown } | null
    if (
      typeof t !== 'object' ||
      t === null ||
      !isStr(t.text, MAX_TEXT) ||
      typeof t.page !== 'number' ||
      !Number.isInteger(t.page) ||
      t.page <= 0
    ) {
      return false
    }
    if (t.text.trim() !== '') hasText = true
  }
  return hasText
}

export function parseSpec(v: unknown): ExportSpec {
  const s = (v ?? {}) as Record<string, unknown>
  const sentences = s.sentences
  if (
    typeof v !== 'object' ||
    !isStr(s.readingId, 200) ||
    (s.format !== 'mp3' && s.format !== 'm4b') ||
    !isStr(s.baseName, MAX_NAME) ||
    !isStr(s.title, MAX_NAME) ||
    typeof s.voice !== 'string' ||
    !VOICE_IDS.has(s.voice) ||
    typeof s.speed !== 'number' ||
    !(SPEEDS as readonly number[]).includes(s.speed) ||
    !Array.isArray(sentences) ||
    sentences.length < 1 ||
    sentences.length > MAX_SENTENCES ||
    !validSentences(sentences)
  ) {
    throw new Error(USAGE)
  }
  return {
    readingId: s.readingId,
    format: s.format,
    baseName: s.baseName,
    title: s.title,
    sentences: (sentences as ExportSpec['sentences']).map(({ text, page }) => ({ text, page })),
    voice: s.voice,
    speed: s.speed
  }
}

export interface ExportController {
  /**
   * Quit / relaunch: abort the running export and resolve once the writer has removed its part and
   * temp files and ffmpeg is dead (the writer kills it hard, before any stdin EOF). Never rejects;
   * the caller bounds the wait.
   */
  abortAndWait(): Promise<void>
}

interface RunningJob {
  jobId: string
  abort: AbortController
  /** Set once run() has started: only then is there writer cleanup to wait for. */
  done: Promise<void> | null
  /** The writer, once made: aborting it is what kills ffmpeg and removes the part and temp files. */
  writer: AudioWriter | null
}

export function registerExportIpc(o: {
  host: Pick<ExportDeps, 'synthesize' | 'cancel'>
  window: () => BrowserWindow | null
  /** The reading's course name, or null when it has none (album falls back to "Tide"). */
  albumFor?: (readingId: string) => string | null
  /** The default folder she chose in Settings (used as-is), or null for Music/Tide. Read at each start. */
  defaultFolder?: () => string | null
  env?: Record<string, string | undefined>
}): ExportController {
  const env = o.env ?? process.env
  let running: RunningJob | null = null
  const savedPaths = new Map<string, string>()

  const send = (e: ExportEvent): void => {
    const win = o.window()
    if (win && !win.isDestroyed()) win.webContents.send('export:event', e)
  }

  const chooseFolder = (): Promise<string | null> =>
    pickFolder(o.window(), 'Choose a folder for the audio')

  async function run(
    spec: ExportSpec,
    jobId: string,
    folder: string,
    mustExist: boolean,
    ac: AbortController,
    job: RunningJob
  ): Promise<void> {
    try {
      // A default folder she chose must still be there: a deleted one fails loudly instead of
      // quietly reappearing (or the audio landing somewhere she did not pick).
      if (mustExist && !(await pathExists(folder))) {
        throw Object.assign(new Error('folder missing'), { code: 'ENOENT' })
      }
      await mkdir(folder, { recursive: true })
      const outPath = await uniquePath(folder, safeFileName(spec.baseName), spec.format, pathExists)
      const meta = {
        title: spec.title,
        album: o.albumFor?.(spec.readingId) ?? 'Tide',
        artist: `Tide · ${voiceName(spec.voice)}`
      }
      const make = spec.format === 'mp3' ? createMp3Writer : createM4bWriter
      const writer = make(outPath, meta, ac.signal)
      job.writer = writer
      let lastSent = 0
      let lastPct = -1
      await runExport(
        spec,
        {
          jobId,
          // Arrow wrappers: TtsHost's methods use `this`, so they cannot be passed detached.
          synthesize: (text, so) => o.host.synthesize(text, so),
          cancel: (gen) => o.host.cancel(gen),
          writer,
          onSkip: (i, err) => logError('export', `left out sentence ${i + 1}: ${String(err)}`)
        },
        (done, total) => {
          const now = Date.now()
          const pct = Math.round((done / total) * 100)
          if (done === total || (now - lastSent >= PROGRESS_MS && pct !== lastPct)) {
            lastSent = now
            lastPct = pct
            send({ jobId, kind: 'progress', done, total })
          }
        },
        ac.signal
      )
      savedPaths.set(jobId, outPath)
      if (savedPaths.size > KEEP_SAVED) savedPaths.delete(savedPaths.keys().next().value!)
      running = null
      send({ jobId, kind: 'saved', fileName: basename(outPath) })
    } catch (err) {
      running = null
      if (ac.signal.aborted) send({ jobId, kind: 'cancelled' })
      else send({ jobId, kind: 'failed', reason: failureReason(err) })
    }
  }

  async function start(spec: ExportSpec, opts: unknown): Promise<ExportStartResult> {
    if (running) return { busy: true }
    const jobId = randomUUID()
    const ac = new AbortController()
    const job: RunningJob = { jobId, abort: ac, done: null, writer: null }
    running = job // claimed before any await, so a second start sees busy
    const custom = o.defaultFolder?.() ?? null
    let folder = custom ?? exportDir(resolveMusicDir(env, () => app.getPath('music')))
    let mustExist = custom !== null
    if ((opts as { chooseFolder?: unknown } | null)?.chooseFolder === true) {
      let chosen: string | null = null
      try {
        chosen = await chooseFolder()
      } finally {
        if (!chosen) running = null
      }
      if (!chosen) return { cancelled: true }
      if (ac.signal.aborted) {
        running = null // quitting while the dialog was open: start nothing
        return { cancelled: true }
      }
      folder = chosen
      mustExist = false
    }
    job.done = run(spec, jobId, folder, mustExist, ac, job)
    return { jobId }
  }

  // Validation throws synchronously, so a bad request rejects before anything starts.
  ipcMain.handle('export:start', (_e, raw: unknown, opts: unknown) => start(parseSpec(raw), opts))

  const idArg = (name: string, v: unknown): string => boundedId(name, 'jobId', v)

  ipcMain.handle('export:cancel', (_e, jobId: unknown) => {
    const id = idArg('export:cancel', jobId)
    if (running?.jobId === id) running.abort.abort()
  })

  const abortAndWait = async (): Promise<void> => {
    const job = running
    if (!job) return
    job.abort.abort()
    // Not job.done: that also waits for the worker to answer the cancel, up to one chunk away. The
    // writer's own cleanup is what must finish. Before the writer exists, run() ends within a tick.
    if (job.writer) await job.writer.abort().catch(() => {})
    else await job.done?.catch(() => {})
  }

  ipcMain.handle('export:reveal', (_e, jobId: unknown) => {
    const p = savedPaths.get(idArg('export:reveal', jobId))
    if (p) shell.showItemInFolder(p)
  })

  return { abortAndWait }
}
