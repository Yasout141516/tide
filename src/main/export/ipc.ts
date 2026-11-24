// IPC for "Save as audio": validates the request, runs one export job at a time and reports events.
import { randomUUID } from 'crypto'
import { access, mkdir } from 'fs/promises'
import { basename } from 'path'
import { app, dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow, OpenDialogOptions } from 'electron'
import type { ExportEvent, ExportSpec, ExportStartResult } from '../../shared/ipc-types'
import { SPEEDS, VOICE_IDS, voiceName } from '../../shared/voices'
import { runExport, type ExportDeps } from './job'
import { exportDir, failureReason, safeFileName, uniquePath } from './files'
import { createM4bWriter, createMp3Writer, type AudioWriter } from './writers'

export const MAX_SENTENCES = 20_000
export const MAX_TEXT = 5_000
export const MAX_NAME = 200
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

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

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
    !sentences.some(
      (x) =>
        typeof (x as { text?: unknown })?.text === 'string' &&
        (x as { text: string }).text.trim() !== ''
    ) ||
    !sentences.every((x) => {
      const t = x as { text?: unknown; page?: unknown } | null
      return (
        typeof t === 'object' &&
        t !== null &&
        isStr(t.text, MAX_TEXT) &&
        typeof t.page === 'number' &&
        Number.isInteger(t.page) &&
        t.page > 0
      )
    })
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

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

export interface ExportController {
  /**
   * Quit / relaunch: abort the running export and resolve once the writer has removed its part and
   * temp files and ffmpeg is dead (the writer kills it hard, before any stdin EOF). Never rejects;
   * the caller bounds the wait.
   */
  abortAndWait(): Promise<void>
}

export function registerExportIpc(o: {
  host: Pick<ExportDeps, 'synthesize' | 'cancel'>
  window: () => BrowserWindow | null
  /** The reading's course name, or null when it has none (album falls back to "Tide"). */
  albumFor?: (readingId: string) => string | null
  env?: Record<string, string | undefined>
}): ExportController {
  const env = o.env ?? process.env
  let running: {
    jobId: string
    abort: AbortController
    /** Set once run() has started: only then is there writer cleanup to wait for. */
    done: Promise<void> | null
    /** The writer, once made: aborting it is what kills ffmpeg and removes the part and temp files. */
    writer: AudioWriter | null
  } | null = null
  const savedPaths = new Map<string, string>()

  const send = (e: ExportEvent): void => {
    const win = o.window()
    if (win && !win.isDestroyed()) win.webContents.send('export:event', e)
  }

  async function chooseFolder(): Promise<string | null> {
    const opts: OpenDialogOptions = {
      title: 'Choose a folder for the audio',
      properties: ['openDirectory', 'createDirectory']
    }
    const win = o.window()
    const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  }

  async function run(
    spec: ExportSpec,
    jobId: string,
    folder: string,
    ac: AbortController,
    job: { writer: AudioWriter | null }
  ): Promise<void> {
    try {
      await mkdir(folder, { recursive: true })
      const outPath = await uniquePath(folder, safeFileName(spec.baseName), spec.format, exists)
      const meta = {
        title: spec.title,
        album: o.albumFor?.(spec.readingId) ?? 'Tide',
        artist: `Tide · ${voiceName(spec.voice)}`
      }
      const make = spec.format === 'mp3' ? createMp3Writer : createM4bWriter
      const writer = make(outPath, meta, ac.signal)
      job.writer = writer
      let lastSent = 0
      await runExport(
        spec,
        {
          jobId,
          // Arrow wrappers: TtsHost's methods use `this`, so they cannot be passed detached.
          synthesize: (text, so) => o.host.synthesize(text, so),
          cancel: (gen) => o.host.cancel(gen),
          writer
        },
        (done, total) => {
          const now = Date.now()
          if (done === total || now - lastSent >= PROGRESS_MS) {
            lastSent = now
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
    const job = {
      jobId,
      abort: ac,
      done: null as Promise<void> | null,
      writer: null as AudioWriter | null
    }
    running = job // claimed before any await, so a second start sees busy
    let folder = exportDir(resolveMusicDir(env, () => app.getPath('music')))
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
    }
    job.done = run(spec, jobId, folder, ac, job)
    return { jobId }
  }

  // Validation throws synchronously, so a bad request rejects before anything starts.
  ipcMain.handle('export:start', (_e, raw: unknown, opts: unknown) => start(parseSpec(raw), opts))

  const idArg = (name: string, v: unknown): string => {
    if (typeof v !== 'string' || v.length > 64) {
      throw new Error(`${name} expects (jobId: string up to 64 characters)`)
    }
    return v
  }

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
