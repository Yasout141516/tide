import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  AddReadingInput,
  CourseId,
  LibrarySnapshot,
  PdfRef,
  PickResult,
  ReadPdfResult,
  Reading,
  ReadingId,
  ReadingPatch,
  RelinkResult
} from '../../shared/library/types'
import { SPEEDS, VOICE_IDS } from '../../shared/voices'
import { pathExists } from '../fs-util'
import { fingerprint } from './fingerprint'
import { LibraryStore } from './store'

const MAX_PENDING_PICKS = 20
const MAX_TITLE = 200
const MAX_COURSE_NAME = 40

/** `position`: the change touched nothing but a reading's position (a high-rate autosave). */
export type ChangeKind = 'position' | 'other'

interface PendingPick {
  path: string
  fingerprint: string
}

interface LibraryOptions {
  now?: () => number
  newId?: () => string
  debounceMs?: number
}

/** Main-process library service. Stores references to the student's PDFs, never copies. No Electron imports. */
export class Library {
  private readonly picks = new Map<string, PendingPick>()
  private readonly listeners = new Set<(kind: ChangeKind) => void>()
  private missing = new Set<ReadingId>()

  private constructor(
    private readonly store: LibraryStore,
    private readonly now: () => number,
    private readonly newId: () => string
  ) {}

  static async open(dir: string, opts: LibraryOptions = {}): Promise<Library> {
    const store = await LibraryStore.open(dir, { debounceMs: opts.debounceMs })
    return new Library(store, opts.now ?? Date.now, opts.newId ?? randomUUID)
  }

  snapshot(): LibrarySnapshot {
    const d = this.store.data()
    return {
      courses: d.courses.map((c) => ({ ...c })),
      readings: d.readings.map((r) => {
        const view: Partial<Reading> = { ...r }
        delete view.path
        delete view.fingerprint
        return {
          ...(view as Omit<Reading, 'path' | 'fingerprint'>),
          fileName: basename(r.path),
          missing: this.missing.has(r.id)
        }
      }),
      settings: {
        reading: { ...d.settings.reading },
        zoom: d.settings.zoom,
        voice: d.settings.voice,
        speed: d.settings.speed
      },
      ui: { collapsed: [...d.ui.collapsed], tipsSeen: [...d.ui.tipsSeen] }
    }
  }

  onChange(cb: (kind: ChangeKind) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private emit(kind: ChangeKind = 'other'): void {
    for (const cb of [...this.listeners]) cb(kind)
  }

  private find(id: ReadingId): Reading | undefined {
    return this.store.data().readings.find((r) => r.id === id)
  }

  private registerPick(path: string, fp: string): string {
    const pickId = this.newId()
    this.picks.set(pickId, { path, fingerprint: fp })
    while (this.picks.size > MAX_PENDING_PICKS) {
      const oldest = this.picks.keys().next().value as string
      this.picks.delete(oldest)
    }
    return pickId
  }

  async pick(path: string): Promise<Exclude<PickResult, { kind: 'cancelled' }>> {
    const fp = await fingerprint(path)
    const existing = this.store.data().readings.find((r) => r.fingerprint === fp)
    if (existing) {
      this.store.update(
        () => {
          existing.path = path
        },
        { urgent: true }
      )
      this.missing.delete(existing.id)
      this.emit()
      return { kind: 'existing', readingId: existing.id }
    }
    return { kind: 'new', pickId: this.registerPick(path, fp), fileName: basename(path) }
  }

  async read(ref: PdfRef): Promise<ReadPdfResult> {
    let path: string
    let readingId: ReadingId | null = null
    if ('readingId' in ref) {
      const reading = this.find(ref.readingId)
      if (!reading) return { ok: false, reason: 'unreadable' }
      path = reading.path
      readingId = reading.id
    } else {
      const pick = this.picks.get(ref.pickId)
      if (!pick) return { ok: false, reason: 'unreadable' }
      path = pick.path
    }
    try {
      const buf = await readFile(path)
      if (readingId && this.missing.delete(readingId)) this.emit()
      return { ok: true, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        if (readingId && !this.missing.has(readingId)) {
          this.missing.add(readingId)
          this.emit()
        }
        return { ok: false, reason: 'missing' }
      }
      return { ok: false, reason: 'unreadable' }
    }
  }

  add(input: AddReadingInput): ReadingId {
    const pick = this.picks.get(input.pickId)
    if (!pick) throw new Error('unknown pick')
    // The same file picked twice before either add: heal the reading that already has it.
    const dupe = this.store.data().readings.find((r) => r.fingerprint === pick.fingerprint)
    if (dupe) {
      this.store.update(
        () => {
          dupe.path = pick.path
        },
        { urgent: true }
      )
      this.picks.delete(input.pickId)
      this.missing.delete(dupe.id)
      this.emit()
      return dupe.id
    }
    const id = this.newId()
    const title = this.cleanTitle(input.title) ?? basename(pick.path).replace(/\.pdf$/i, '')
    this.store.update(
      (d) => {
        let courseId: CourseId | null = null
        if (input.course && 'id' in input.course) {
          const wanted = input.course.id
          if (!d.courses.some((c) => c.id === wanted)) throw new Error('unknown course')
          courseId = wanted
        } else if (input.course) {
          const name = input.course.newName.trim()
          if (name.length < 1 || name.length > MAX_COURSE_NAME)
            throw new Error('invalid course name')
          const match = d.courses.find((c) => c.name.toLowerCase() === name.toLowerCase())
          if (match) courseId = match.id
          else {
            courseId = this.newId()
            d.courses.push({ id: courseId, name })
          }
        }
        d.readings.push({
          id,
          title,
          courseId,
          path: pick.path,
          fingerprint: pick.fingerprint,
          pageCount: input.pageCount,
          position: null,
          addedAt: this.now(),
          lastOpenedAt: null,
          finished: false,
          readEverything: false,
          finishIn: null
        })
      },
      { urgent: true }
    )
    this.picks.delete(input.pickId)
    this.emit()
    return id
  }

  private cleanTitle(raw: string): string | null {
    const t = raw.trim()
    return t.length === 0 || t.length > MAX_TITLE ? null : t
  }

  update(id: ReadingId, patch: ReadingPatch): void {
    const reading = this.find(id)
    if (!reading) return
    const title = patch.title === undefined ? null : this.cleanTitle(patch.title)
    const changes =
      title !== null ||
      patch.position !== undefined ||
      patch.readEverything !== undefined ||
      patch.finishIn !== undefined ||
      patch.opened !== undefined ||
      patch.pageCount !== undefined ||
      patch.finished !== undefined
    if (!changes) return
    const urgent =
      title !== null ||
      patch.readEverything !== undefined ||
      patch.finishIn !== undefined ||
      patch.opened !== undefined ||
      patch.pageCount !== undefined ||
      patch.finished !== undefined
    this.store.update(
      () => {
        if (title !== null) reading.title = title
        if (patch.position) reading.position = { ...patch.position }
        if (patch.readEverything !== undefined) reading.readEverything = patch.readEverything
        if (patch.finishIn !== undefined) reading.finishIn = patch.finishIn
        if (patch.opened) reading.lastOpenedAt = this.now()
        if (patch.pageCount !== undefined) reading.pageCount = patch.pageCount
        if (patch.finished !== undefined) reading.finished = patch.finished
      },
      { urgent }
    )
    this.emit(patch.position !== undefined && !urgent ? 'position' : 'other')
  }

  remove(id: ReadingId): void {
    const reading = this.find(id)
    if (!reading) return
    this.store.update(
      (d) => {
        d.readings = d.readings.filter((r) => r.id !== id)
        const courseId = reading.courseId
        if (courseId && !d.readings.some((r) => r.courseId === courseId)) {
          d.courses = d.courses.filter((c) => c.id !== courseId)
          d.ui.collapsed = d.ui.collapsed.filter((k) => k !== courseId)
        }
      },
      { urgent: true }
    )
    this.missing.delete(id)
    this.emit()
  }

  async relink(id: ReadingId, path: string): Promise<Exclude<RelinkResult, { kind: 'cancelled' }>> {
    if (!this.find(id)) throw new Error('unknown reading')
    const fp = await fingerprint(path)
    // Re-find after the await: the reading may have been removed meanwhile.
    const reading = this.find(id)
    if (!reading) throw new Error('unknown reading')
    if (fp === reading.fingerprint) {
      this.store.update(
        () => {
          reading.path = path
        },
        { urgent: true }
      )
      this.missing.delete(id)
      this.emit()
      return { kind: 'relinked' }
    }
    return { kind: 'different', pickId: this.registerPick(path, fp), fileName: basename(path) }
  }

  useDifferentFile(id: ReadingId, pickId: string): void {
    const pick = this.picks.get(pickId)
    if (!pick) throw new Error('unknown pick')
    const reading = this.find(id)
    if (!reading) return
    // Never create a second reading for a file another reading already owns, and never reset that one.
    if (this.store.data().readings.some((r) => r.id !== id && r.fingerprint === pick.fingerprint)) {
      throw new Error('file already on shelf')
    }
    this.store.update(
      () => {
        reading.path = pick.path
        reading.fingerprint = pick.fingerprint
        reading.position = null
        reading.finished = false
        reading.pageCount = null
      },
      { urgent: true }
    )
    this.picks.delete(pickId)
    this.missing.delete(id)
    this.emit()
  }

  setCollapsed(key: string, collapsed: boolean): void {
    this.store.update(
      (d) => {
        const rest = d.ui.collapsed.filter((k) => k !== key)
        d.ui.collapsed = collapsed ? [...rest, key] : rest
      },
      { urgent: true }
    )
    this.emit()
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom)) return
    const clamped = Math.min(2, Math.max(0.8, zoom))
    this.store.update(
      (d) => {
        d.settings.zoom = clamped
      },
      { urgent: true }
    )
    this.emit()
  }

  setVoice(voice: string, speed: number): void {
    if (!VOICE_IDS.has(voice) || !(SPEEDS as readonly number[]).includes(speed)) return
    this.store.update(
      (d) => {
        d.settings.voice = voice
        d.settings.speed = speed
      },
      { urgent: true }
    )
    this.emit()
  }

  tipSeen(key: string): void {
    if (this.store.data().ui.tipsSeen.includes(key)) return
    this.store.update(
      (d) => {
        d.ui.tipsSeen.push(key)
      },
      { urgent: true }
    )
    this.emit()
  }

  async checkMissing(): Promise<void> {
    const readings = [...this.store.data().readings]
    const results = await Promise.all(readings.map(async (r) => !(await pathExists(r.path))))
    const next = new Set<ReadingId>()
    readings.forEach((r, i) => {
      if (results[i]) next.add(r.id)
    })
    const same = next.size === this.missing.size && [...next].every((id) => this.missing.has(id))
    this.missing = next
    if (!same) this.emit()
  }

  /** Resolves false when data could not be written; never rejects. */
  flush(): Promise<boolean> {
    return this.store.flush()
  }
}
