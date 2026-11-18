import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryFile } from '../../shared/library/types'
import { emptyLibrary, parseLibrary } from './schema'

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_DELAY_MS = 50

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false
  )

async function readParsed(path: string): Promise<{ present: boolean; data: LibraryFile | null }> {
  let text = ''
  try {
    // Only "not there" means absent. Any other failure (a lock, permissions) is retried and then thrown,
    // so an unreadable shelf is never mistaken for a missing one.
    await withRetry(async () => {
      text = await readFile(path, 'utf8')
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { present: false, data: null }
    throw err
  }
  try {
    return { present: true, data: parseLibrary(JSON.parse(text)) }
  } catch {
    return { present: true, data: null }
  }
}

/** Runs a file operation, retrying the errors Windows antivirus and indexers cause. */
async function withRetry(op: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await op()
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= RENAME_ATTEMPTS || !code || !RETRY_CODES.has(code)) throw err
      await sleep(RENAME_DELAY_MS)
    }
  }
}

/**
 * Persistence for library.json. Never loses the shelf: atomic tmp+rename writes, a rolling backup, and a
 * rejected file is renamed aside, never deleted or overwritten with an empty shelf.
 */
export class LibraryStore {
  private readonly file: string
  private readonly tmp: string
  private readonly backup: string
  private chain: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  private retried = false

  private constructor(
    dir: string,
    private readonly debounceMs: number,
    private readonly current: LibraryFile,
    readonly loadedFrom: 'library' | 'backup' | 'new',
    /** The existing backup is overwritten only while the primary is known good (plan amendment). */
    private readonly backupAllowed: boolean
  ) {
    this.file = join(dir, 'library.json')
    this.tmp = join(dir, 'library.json.tmp')
    this.backup = join(dir, 'library.backup.json')
  }

  static async open(dir: string, opts: { debounceMs?: number } = {}): Promise<LibraryStore> {
    await mkdir(dir, { recursive: true })
    const debounceMs = opts.debounceMs ?? 3000
    const file = join(dir, 'library.json')
    const primary = await readParsed(file)
    if (primary.data) return new LibraryStore(dir, debounceMs, primary.data, 'library', true)
    if (primary.present)
      await withRetry(() => rename(file, join(dir, `library.corrupt-${Date.now()}.json`)))
    const fallback = await readParsed(join(dir, 'library.backup.json'))
    if (fallback.data) return new LibraryStore(dir, debounceMs, fallback.data, 'backup', false)
    // Nothing present at all is a fresh install, so the backup rolls normally from the first write.
    // Anything rejected leaves the backup alone.
    const fresh = !primary.present && !fallback.present
    return new LibraryStore(dir, debounceMs, emptyLibrary(), 'new', fresh)
  }

  data(): LibraryFile {
    return this.current
  }

  update(mutate: (d: LibraryFile) => void, opts: { urgent?: boolean } = {}): void {
    mutate(this.current)
    this.dirty = true
    if (opts.urgent) {
      this.enqueue()
      return
    }
    // The first change after a write starts the clock and later ones do not restart it, so steady updates
    // still reach disk every debounceMs (a trailing debounce would starve) and never more often.
    if (!this.timer) this.timer = setTimeout(() => this.enqueue(), this.debounceMs)
  }

  /** Writes any pending change now. Resolves true when everything is on disk, false when a write failed. */
  async flush(): Promise<boolean> {
    this.enqueue()
    await this.chain
    return !this.dirty
  }

  private enqueue(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return
    this.dirty = false
    const json = JSON.stringify(this.current, null, 2)
    this.chain = this.chain
      .then(async () => {
        await this.write(json)
        this.retried = false
      })
      .catch((err) => {
        this.dirty = true
        console.error('library.json write failed', err)
        // One retry after the debounce interval; a later update or flush starts over.
        if (!this.retried && !this.timer) {
          this.retried = true
          this.timer = setTimeout(() => this.enqueue(), this.debounceMs)
        }
      })
  }

  private async write(json: string): Promise<void> {
    await writeFile(this.tmp, json, { encoding: 'utf8', flush: true })
    if (this.backupAllowed && (await exists(this.file))) {
      // Best effort: a locked backup must not stop the primary from being updated.
      try {
        await withRetry(() => copyFile(this.file, this.backup))
      } catch (err) {
        console.error('library.backup.json copy failed', err)
      }
    }
    await withRetry(() => rename(this.tmp, this.file))
  }
}
