import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { OpenDialogOptions } from 'electron'
import {
  LIBRARY_ERROR_PREFIX,
  type AppCommand,
  type LibraryErrorCode
} from '../../shared/ipc-types'
import type {
  AddReadingInput,
  LibrarySnapshot,
  PdfRef,
  PickResult,
  ReadPdfResult,
  ReadingId,
  ReadingPatch,
  RelinkResult
} from '../../shared/library/types'
import type { Library } from './library'

const FOCUS_CHECK_MS = 5000
/** Errors Library throws on purpose; none carries a path, so their wording may pass through. */
const DOMAIN_ERRORS = new Set(['unknown pick', 'unknown reading', 'unknown course', 'invalid course name'])

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isInt = (v: unknown, min: number): v is number => Number.isInteger(v) && (v as number) >= min

/** Bad arguments from the renderer; the message names the channel and shape, never a path. */
class BadArgs extends Error {}

function bad(channel: string, shape: string): never {
  throw new BadArgs(`${channel} expects ${shape}`)
}

function libraryError(code: LibraryErrorCode): Error {
  return new Error(`${LIBRARY_ERROR_PREFIX}${code}`)
}

/** Turn anything Library or the file system throws into an error with no path in it. */
function clean(err: unknown): Error {
  if (err instanceof BadArgs) return err
  if (err instanceof Error) {
    if (err.message === 'file already on shelf') return libraryError('already-on-shelf')
    if (DOMAIN_ERRORS.has(err.message)) return err
    const code = (err as NodeJS.ErrnoException).code
    if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) return libraryError('file-unreadable')
  }
  console.error('[tide] library operation failed:', err)
  return libraryError('failed')
}

function guarded<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  return (...a) => {
    try {
      const r = fn(...a)
      if (r instanceof Promise) return r.catch((e) => Promise.reject(clean(e))) as R
      return r
    } catch (e) {
      throw clean(e)
    }
  }
}

function validPatch(p: unknown): p is ReadingPatch {
  if (!isObj(p)) return false
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case 'title':
        if (!isStr(v)) return false
        break
      case 'position':
        if (
          !isObj(v) ||
          Object.keys(v).length !== 3 ||
          !isInt(v.page, 1) ||
          !isInt(v.textItemIndex, 0) ||
          !isInt(v.charOffset, 0)
        )
          return false
        break
      case 'readEverything':
      case 'finished':
        if (typeof v !== 'boolean') return false
        break
      case 'opened':
        if (v !== true) return false
        break
      case 'pageCount':
        if (!isInt(v, 1)) return false
        break
      default:
        return false
    }
  }
  return true
}

function validAdd(i: unknown): i is AddReadingInput {
  if (!isObj(i) || !isStr(i.pickId) || !isStr(i.title)) return false
  if (i.pageCount !== null && !isInt(i.pageCount, 1)) return false
  const c = i.course
  if (c === null) return true
  if (!isObj(c) || Object.keys(c).length !== 1) return false
  return isStr(c.id) || isStr(c.newName)
}

function validRef(r: unknown): r is PdfRef {
  if (!isObj(r) || Object.keys(r).length !== 1) return false
  return isStr(r.readingId) || isStr(r.pickId)
}

/**
 * Registers the library IPC handlers and the app:ready / app:command plumbing.
 * `send` queues commands until the renderer has announced `app:ready`.
 */
export function registerLibraryIpc(
  lib: Library,
  o: { window: () => BrowserWindow | null; now?: () => number }
): { send(cmd: AppCommand): void } {
  const now = o.now ?? Date.now
  const toWindow = (channel: string, payload: unknown): void => {
    const win = o.window()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // `dialog` is read at call time so e2e can replace showOpenDialog from app.evaluate.
  async function pickPath(title: string): Promise<string | null> {
    const opts: OpenDialogOptions = {
      title,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    }
    const win = o.window()
    const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  }

  lib.onChange(() => toWindow('library:changed', lib.snapshot()))

  const handle = <A extends unknown[], R>(channel: string, fn: (...a: A) => R): void => {
    ipcMain.handle(channel, (_e, ...a) => guarded(fn)(...(a as A)))
  }

  handle('library:get', (): LibrarySnapshot => lib.snapshot())

  handle('library:pick', async (): Promise<PickResult> => {
    const path = await pickPath('Add a reading')
    return path === null ? { kind: 'cancelled' } : lib.pick(path)
  })

  handle('library:read', (ref: unknown): Promise<ReadPdfResult> => {
    if (!validRef(ref)) bad('library:read', '{ readingId: string } or { pickId: string }')
    return lib.read(ref)
  })

  handle('library:add', (input: unknown): ReadingId => {
    if (!validAdd(input))
      bad(
        'library:add',
        '{ pickId, title, pageCount: positive integer or null, course: null | { id } | { newName } }'
      )
    return lib.add(input)
  })

  handle('library:update', (id: unknown, patch: unknown): void => {
    if (!isStr(id) || !validPatch(patch))
      bad('library:update', '(id: string, patch of title, position, readEverything, opened, pageCount, finished)')
    lib.update(id, patch)
  })

  handle('library:remove', (id: unknown): void => {
    if (!isStr(id)) bad('library:remove', '(id: string)')
    lib.remove(id)
  })

  handle('library:find', async (id: unknown): Promise<RelinkResult> => {
    if (!isStr(id)) bad('library:find', '(id: string)')
    const reading = lib.snapshot().readings.find((r) => r.id === id)
    if (!reading) throw new Error('unknown reading')
    const path = await pickPath(`Find "${reading.title}"`)
    return path === null ? { kind: 'cancelled' } : lib.relink(id, path)
  })

  handle('library:use-different', (id: unknown, pickId: unknown): void => {
    if (!isStr(id) || !isStr(pickId)) bad('library:use-different', '(id: string, pickId: string)')
    lib.useDifferentFile(id, pickId)
  })

  handle('library:collapse', (key: unknown, collapsed: unknown): void => {
    if (!isStr(key) || typeof collapsed !== 'boolean')
      bad('library:collapse', '(key: string, collapsed: boolean)')
    lib.setCollapsed(key, collapsed)
  })

  handle('library:zoom', (zoom: unknown): void => {
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0.8 || zoom > 2)
      bad('library:zoom', '(zoom: a number from 0.8 to 2)')
    lib.setZoom(zoom)
  })

  // A file may reappear (or vanish) while Tide is in the background: look again on focus.
  let lastCheck = -Infinity
  app.on('browser-window-focus', () => {
    const t = now()
    if (t - lastCheck < FOCUS_CHECK_MS) return
    lastCheck = t
    lib.checkMissing().catch((err) => console.error('[tide] missing-file check failed:', err))
  })

  let ready = false
  const queue: AppCommand[] = []
  ipcMain.on('app:ready', () => {
    ready = true
    for (const cmd of queue.splice(0)) toWindow('app:command', cmd)
  })

  return {
    send(cmd) {
      if (ready) toWindow('app:command', cmd)
      else queue.push(cmd)
    }
  }
}
