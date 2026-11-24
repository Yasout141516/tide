import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({ copyFile: 0, writeFile: 0, readFile: 0, writes: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const fail = (): Error => Object.assign(new Error('injected'), { code: 'EIO' })
  return {
    ...real,
    copyFile: (...a: Parameters<typeof real.copyFile>) =>
      faults.copyFile > 0 ? (faults.copyFile--, Promise.reject(fail())) : real.copyFile(...a),
    readFile: (...a: Parameters<typeof real.readFile>) =>
      faults.readFile > 0
        ? (faults.readFile--, Promise.reject(Object.assign(new Error('locked'), { code: 'EBUSY' })))
        : real.readFile(...a),
    writeFile: (...a: Parameters<typeof real.writeFile>) => {
      faults.writes++
      return faults.writeFile > 0
        ? (faults.writeFile--, Promise.reject(fail()))
        : real.writeFile(...a)
    }
  }
})
import { emptyLibrary, parseLibrary } from '../../../src/main/library/schema'
import { LibraryStore } from '../../../src/main/library/store'
import type { LibraryFile, Reading } from '../../../src/shared/library/types'

let dir: string
beforeEach(async () => {
  faults.copyFile = 0
  faults.writeFile = 0
  faults.readFile = 0
  faults.writes = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
  dir = await mkdtemp(join(tmpdir(), 'tide-store-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

const reading = (id: string): Reading => ({
  id,
  title: `Title ${id}`,
  courseId: null,
  path: `C:\\r\\${id}.pdf`,
  fingerprint: '1:ab',
  pageCount: 3,
  position: null,
  addedAt: 1,
  lastOpenedAt: null,
  finished: false,
  readEverything: false,
  finishIn: null
})
const libWith = (...ids: string[]): LibraryFile => ({
  ...emptyLibrary(),
  readings: ids.map(reading)
})
const jsonOf = (lib: unknown): string => JSON.stringify(lib)
const readJson = async (name: string): Promise<LibraryFile> =>
  JSON.parse(await readFile(join(dir, name), 'utf8'))
const open = (): Promise<LibraryStore> => LibraryStore.open(dir, { debounceMs: 30 })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const ids = (l: LibraryFile): string[] => l.readings.map((r) => r.id)

describe('LibraryStore', () => {
  it('starts empty and writes nothing until the first update', async () => {
    const store = await open()
    expect(store.loadedFrom).toBe('new')
    expect(store.data()).toEqual(emptyLibrary())
    await store.flush()
    expect(await readdir(dir)).toEqual([])
  })

  it('round-trips a library through disk', async () => {
    const a = await open()
    a.update((d) => d.readings.push(reading('r1')), { urgent: true })
    await a.flush()
    const b = await open()
    expect(b.loadedFrom).toBe('library')
    expect(b.data()).toEqual(a.data())
  })

  it('keeps the previous good file as library.backup.json', async () => {
    const store = await open()
    store.update((d) => d.readings.push(reading('r1')), { urgent: true })
    store.update((d) => d.readings.push(reading('r2')), { urgent: true })
    await store.flush()
    expect(ids(await readJson('library.json'))).toEqual(['r1', 'r2'])
    expect(ids(await readJson('library.backup.json'))).toEqual(['r1'])
  })

  it('falls back to the backup when library.json is corrupt, and keeps the corrupt file', async () => {
    await writeFile(join(dir, 'library.backup.json'), jsonOf(libWith('good')))
    await writeFile(join(dir, 'library.json'), '{"schemaVersion":1,"cour')
    const store = await open()
    expect(store.loadedFrom).toBe('backup')
    expect(ids(store.data())).toEqual(['good'])
    const corrupt = (await readdir(dir)).filter((f) => /^library\.corrupt-\d+\.json$/.test(f))
    expect(corrupt).toHaveLength(1)
    expect(await readFile(join(dir, corrupt[0]), 'utf8')).toBe('{"schemaVersion":1,"cour')
  })

  it('starts empty but deletes nothing when both files are unreadable', async () => {
    await writeFile(join(dir, 'library.backup.json'), 'garbage-backup')
    await writeFile(join(dir, 'library.json'), 'garbage-primary')
    const store = await open()
    expect(store.loadedFrom).toBe('new')
    expect(store.data()).toEqual(emptyLibrary())
    expect(await readFile(join(dir, 'library.backup.json'), 'utf8')).toBe('garbage-backup')
    const corrupt = (await readdir(dir)).find((f) => f.startsWith('library.corrupt-'))!
    expect(await readFile(join(dir, corrupt), 'utf8')).toBe('garbage-primary')
  })

  it('a rejected primary and a rejected backup never get an empty shelf copied over the backup', async () => {
    await writeFile(join(dir, 'library.backup.json'), 'garbage-backup')
    await writeFile(join(dir, 'library.json'), 'garbage-primary')
    const store = await open()
    store.update((d) => d.readings.push(reading('r1')), { urgent: true })
    store.update((d) => d.readings.push(reading('r2')), { urgent: true })
    await store.flush()
    expect(ids(await readJson('library.json'))).toEqual(['r1', 'r2'])
    expect(await readFile(join(dir, 'library.backup.json'), 'utf8')).toBe('garbage-backup')
  })

  it('never overwrites the backup after the primary was rejected as a newer version', async () => {
    await writeFile(join(dir, 'library.backup.json'), jsonOf(libWith('old')))
    await writeFile(join(dir, 'library.json'), jsonOf({ ...libWith('new'), schemaVersion: 2 }))
    const store = await open()
    expect(store.loadedFrom).toBe('backup')
    store.update((d) => d.readings.push(reading('x')), { urgent: true })
    store.update((d) => d.readings.push(reading('y')), { urgent: true })
    await store.flush()
    expect(ids(await readJson('library.backup.json'))).toEqual(['old'])
    const aside = (await readdir(dir)).filter((f) => /^library\.corrupt-\d+\.json$/.test(f))
    expect(aside).toHaveLength(1)
    expect(JSON.parse(await readFile(join(dir, aside[0]), 'utf8')).schemaVersion).toBe(2)
  })

  it('a valid primary refreshes the backup on each write', async () => {
    await writeFile(join(dir, 'library.backup.json'), jsonOf(libWith('stale')))
    await writeFile(join(dir, 'library.json'), jsonOf(libWith('a')))
    const store = await open()
    expect(store.loadedFrom).toBe('library')
    store.update((d) => d.readings.push(reading('b')), { urgent: true })
    await store.flush()
    expect(ids(await readJson('library.backup.json'))).toEqual(['a'])
    expect(ids(await readJson('library.json'))).toEqual(['a', 'b'])
  })

  it('recovers when reading library.json is briefly locked', async () => {
    await writeFile(join(dir, 'library.json'), jsonOf(libWith('a')))
    faults.readFile = 2
    const store = await open()
    expect(store.loadedFrom).toBe('library')
    expect(ids(store.data())).toEqual(['a'])
  })

  it('refuses to open, touching nothing, when library.json stays unreadable', async () => {
    const primary = jsonOf(libWith('new'))
    const backup = jsonOf(libWith('old'))
    await writeFile(join(dir, 'library.json'), primary)
    await writeFile(join(dir, 'library.backup.json'), backup)
    faults.readFile = 100
    await expect(open()).rejects.toThrow()
    faults.readFile = 0
    expect(await readFile(join(dir, 'library.json'), 'utf8')).toBe(primary)
    expect(await readFile(join(dir, 'library.backup.json'), 'utf8')).toBe(backup)
    expect(await readdir(dir)).toHaveLength(2)
  })

  it('refuses to open with no backup when library.json is unreadable, leaving it alone', async () => {
    const primary = jsonOf(libWith('new'))
    await writeFile(join(dir, 'library.json'), primary)
    faults.readFile = 100
    await expect(open()).rejects.toThrow()
    faults.readFile = 0
    expect(await readdir(dir)).toEqual(['library.json'])
    expect(await readFile(join(dir, 'library.json'), 'utf8')).toBe(primary)
  })

  it('still updates library.json when the backup copy fails', async () => {
    const store = await open()
    store.update((d) => d.readings.push(reading('r1')), { urgent: true })
    await store.flush()
    faults.copyFile = 100
    store.update((d) => d.readings.push(reading('r2')), { urgent: true })
    expect(await store.flush()).toBe(true)
    expect(ids(await readJson('library.json'))).toEqual(['r1', 'r2'])
  })

  it('flush resolves false when the write fails, and one retry later writes it', async () => {
    const store = await open()
    faults.writeFile = 1
    store.update((d) => d.readings.push(reading('r1')))
    expect(await store.flush()).toBe(false)
    expect(await readdir(dir)).toEqual([])
    await sleep(200)
    expect(ids(await readJson('library.json'))).toEqual(['r1'])
    expect(await store.flush()).toBe(true)
  })

  it('flush resolves true when nothing is pending', async () => {
    const store = await open()
    expect(await store.flush()).toBe(true)
  })

  it('fills defaults for fields missing in a v1 file', async () => {
    const r: Partial<Reading> = reading('r1')
    delete r.readEverything
    delete r.finished
    delete r.finishIn
    await writeFile(
      join(dir, 'library.json'),
      jsonOf({ schemaVersion: 1, courses: [], readings: [r] })
    )
    const store = await open()
    expect(store.loadedFrom).toBe('library')
    const d = store.data()
    expect(d.readings[0].readEverything).toBe(false)
    expect(d.readings[0].finished).toBe(false)
    expect(d.readings[0].finishIn).toBeNull()
    expect(d.settings).toEqual(emptyLibrary().settings)
    expect(d.ui).toEqual({ collapsed: [], tipsSeen: [] })
  })

  it('rejects a file written by a newer Tide', () => {
    expect(parseLibrary({ ...libWith('a'), schemaVersion: 2 })).toBeNull()
  })

  it('rejects wrongly typed fields', () => {
    expect(parseLibrary({ ...libWith('a'), courses: 'x' })).toBeNull()
    const bad = libWith('a') as unknown as { readings: Record<string, unknown>[] }
    bad.readings[0].addedAt = 'yesterday'
    expect(parseLibrary(bad)).toBeNull()
    expect(parseLibrary(null)).toBeNull()
  })

  it('an invalid finishIn falls back to null for that reading only; the rest of the library loads', () => {
    for (const bad of [15, 50, -1, '60', true, {}, NaN]) {
      const lib = libWith('a', 'b') as unknown as { readings: Record<string, unknown>[] }
      lib.readings[0].finishIn = 60
      lib.readings[1].finishIn = bad
      const parsed = parseLibrary(lib)
      expect(parsed, JSON.stringify(bad)).not.toBeNull()
      expect(parsed!.readings.map((r) => [r.id, r.finishIn])).toEqual([
        ['a', 60],
        ['b', null]
      ])
    }
  })

  it('debounces writes and flush() writes now', async () => {
    const store = await LibraryStore.open(dir, { debounceMs: 200 })
    for (let i = 0; i < 10; i++) store.update((d) => d.readings.push(reading(`r${i}`)))
    await sleep(40)
    expect(await readdir(dir)).toEqual([])
    await store.flush()
    expect(ids(await readJson('library.json'))).toHaveLength(10)
  })

  it('steady updates are written about every debounce interval, not starved', async () => {
    vi.useFakeTimers()
    try {
      const store = await LibraryStore.open(dir, { debounceMs: 3000 })
      for (let t = 0; t < 10; t++) {
        store.update((d) => d.readings.push(reading(`r${t}`)))
        await vi.advanceTimersByTimeAsync(1000)
      }
      // Disk writes at about 3 s, 6 s and 9 s (updates every 1 s for 10 s): never starved, never more often.
      vi.useRealTimers()
      // The queued writes drain on real I/O, which is slow under load: wait for the third, not a fixed delay.
      await vi.waitFor(() => expect(faults.writes).toBe(3), { timeout: 10_000 })
      // Nothing more is queued: the count stays at three once the disk work has settled.
      await sleep(100)
      expect(faults.writes).toBe(3)
      // Let any in-flight write finish before the temp directory is removed.
      await store.flush()
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes after the debounce delay on its own', async () => {
    const store = await open()
    store.update((d) => d.readings.push(reading('r1')))
    await sleep(300)
    expect(ids(await readJson('library.json'))).toEqual(['r1'])
  })

  it('urgent writes reach disk without flush', async () => {
    const store = await LibraryStore.open(dir, { debounceMs: 10_000 })
    store.update((d) => d.readings.push(reading('r1')), { urgent: true })
    for (let i = 0; i < 50 && !(await readdir(dir)).includes('library.json'); i++) await sleep(20)
    expect(ids(await readJson('library.json'))).toEqual(['r1'])
  })
})
