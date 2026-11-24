import { logError } from './log'

/** Opens the library; if the store cannot open, reports it plainly and returns null (nothing is written). */
export async function openLibraryOrReport<L>(
  open: () => Promise<L>,
  report: (title: string, body: string) => void
): Promise<L | null> {
  try {
    return await open()
  } catch (err) {
    logError('the library could not be opened', err)
    report(
      "Tide couldn't open your shelf",
      'Your readings file could not be read, so Tide has left it untouched. Close Tide and open it again. If this keeps happening, the file may need to be restored from its backup.'
    )
    return null
  }
}

/**
 * The before-quit handler: holds the quit until the shelf (reading positions included) is on disk.
 * A second instance that quits at once has no library loaded, so it passes straight through.
 */
export function createQuitHandler(o: {
  getLibrary: () => { flush(): Promise<boolean> } | null
  /** Runs alongside the flush (e.g. abort a running export and wait for its cleanup). Should not reject. */
  beforeQuit?: () => Promise<void>
  quit: () => void
  timeoutMs: number
}): (e: { preventDefault(): void }) => void {
  let flushed = false
  let flushing = false
  return (e) => {
    const library = o.getLibrary()
    if (flushed || !library) return
    e.preventDefault()
    if (flushing) return
    flushing = true
    // flush() never rejects; the timeout keeps a stuck disk from hanging the quit.
    let timer: NodeJS.Timeout
    const timeout = new Promise<false>((r) => {
      timer = setTimeout(() => r(false), o.timeoutMs)
    })
    // One shared bound covers both: a stuck disk or a stuck export cleanup cannot hang the quit.
    const work = Promise.all([
      library.flush(),
      (o.beforeQuit?.() ?? Promise.resolve()).catch(() => {})
    ]).then(([ok]) => ok)
    Promise.race([work, timeout])
      .then((ok) => {
        if (!ok) logError('quit', 'library.json could not be written before quitting')
      })
      .finally(() => {
        clearTimeout(timer)
        flushed = true
        o.quit()
      })
  }
}

interface Showable {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * Brings the window forward, making a new one if it was closed (macOS keeps the app running).
 * Does nothing until whenReady has made the first window: a second launch can arrive before `ready`
 * (a BrowserWindow would throw) or while the library is still opening (it would make a second window).
 */
export function createShowWindow(o: {
  isReady: () => boolean
  getWindow: () => Showable | null
  create: () => void
}): () => void {
  return () => {
    if (!o.isReady()) return
    const win = o.getWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    } else {
      o.create()
    }
  }
}

/**
 * Process-level error hook. Always logs. If it happens before any window exists (a failed start),
 * Tide would otherwise sit windowless holding the single-instance lock, so say so plainly and exit.
 */
export function createFatalHandler(d: {
  hasWindow: () => boolean
  showError: (title: string, body: string) => void
  exit: (code: number) => void
}): (scope: string, err: unknown) => void {
  let exiting = false
  return (scope, err) => {
    logError(scope, err)
    if (d.hasWindow() || exiting) return
    exiting = true
    try {
      d.showError(
        'Tide could not start',
        'Something went wrong while starting Tide. Please quit and open it again.'
      )
    } finally {
      d.exit(1)
    }
  }
}
