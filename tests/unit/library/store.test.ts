import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({ copyFile: 0, writeFile: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const fail = (): Error => Object.assign(new Error('injected'), { code: 'EIO' })
  return {
    ...real,
    copyFile: (...a: Parameters<typeof real.copyFile>) =>
      faults.copyFile > 0 ? (faults.copyFile--, Promise.reject(fail())) : real.copyFile(...a),
    writeFile: (...a: Parameters<typeof real.writeFile>) =>
      faults.writeFile > 0 ? (faults.writeFile--, Promise.reject(fail())) : real.writeFile(...a)
  }
})
import { emptyLibrary, parseLibrary } from '../../../src/main/library/schema'
import { LibraryStore } from '../../../src/main/library/store'
import type { LibraryFile, Reading } from '../../../src/shared/library/types'

let dir: string
beforeEach(async () => {
  faults.copyFile = 0
  faults.writeFile = 0
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
  readEverything: false
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
    await writeFile(
      join(dir, 'library.json'),
      jsonOf({ schemaVersion: 1, courses: [], readings: [r] })
    )
    const store = await open()
    expect(store.loadedFrom).toBe('library')
    const d = store.data()
    expect(d.readings[0].readEverything).toBe(false)
    expect(d.readings[0].finished).toBe(false)
    expect(d.settings).toEqual(emptyLibrary().settings)
    expect(d.ui).toEqual({ collapsed: [] })
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

  it('debounces writes and flush() writes now', async () => {
    const store = await LibraryStore.open(dir, { debounceMs: 200 })
    for (let i = 0; i < 10; i++) store.update((d) => d.readings.push(reading(`r${i}`)))
    await sleep(40)
    expect(await readdir(dir)).toEqual([])
    await store.flush()
    expect(ids(await readJson('library.json'))).toHaveLength(10)
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
