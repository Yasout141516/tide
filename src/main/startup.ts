/** Opens the library; if the store cannot open, reports it plainly and returns null (nothing is written). */
export async function openLibraryOrReport<L>(
  open: () => Promise<L>,
  report: (title: string, body: string) => void
): Promise<L | null> {
  try {
    return await open()
  } catch (err) {
    console.error('[tide] the library could not be opened:', err)
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
    Promise.race([library.flush(), timeout])
      .then((ok) => {
        if (!ok) console.error('[tide] library.json could not be written before quitting')
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
