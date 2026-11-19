import { copyFile, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fingerprint } from '../../../src/main/library/fingerprint'
import { Library } from '../../../src/main/library/library'

const FIXTURE = join(__dirname, '../../fixtures/pdfs/single-column.pdf')
let root: string
let n = 0
let libs: Library[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tide-lib-'))
  n = 0
  libs = []
})
afterEach(async () => {
  await Promise.all(libs.map((l) => l.flush()))
  await rm(root, { recursive: true, force: true })
})

async function open(): Promise<Library> {
  const lib = await Library.open(join(root, 'data'), {
    newId: () => `id${++n}`,
    now: () => 1000,
    debounceMs: 20
  })
  libs.push(lib)
  return lib
}

async function pdf(name: string, dir = root): Promise<string> {
  await mkdir(dir, { recursive: true })
  const p = join(dir, name)
  await copyFile(FIXTURE, p)
  return p
}

/** A distinct PDF-like file (different bytes, so a different fingerprint). */
async function variant(name: string, tag: string): Promise<string> {
  const p = join(root, name)
  await writeFile(p, Buffer.concat([await readFile(FIXTURE), Buffer.from(tag)]))
  return p
}

type AddCourse = { id: string } | { newName: string } | null

async function addFrom(lib: Library, path: string, course: AddCourse = null): Promise<string> {
  const pick = await lib.pick(path)
  if (pick.kind !== 'new') throw new Error('expected new')
  return lib.add({ pickId: pick.pickId, title: 'T', pageCount: 3, course })
}

type Stored = { readings: { path: string; position: unknown }[] }
const stored = async (): Promise<Stored> =>
  JSON.parse(await readFile(join(root, 'data', 'library.json'), 'utf8')) as Stored

describe('Library', () => {
  it('fingerprint is size plus sha256 of the first 256 KB', async () => {
    const big = Buffer.alloc(300 * 1024, 7)
    await writeFile(join(root, 'a.bin'), big)
    const fp = await fingerprint(join(root, 'a.bin'))
    expect(fp).toMatch(/^\d+:[0-9a-f]{64}$/)
    const late = Buffer.from(big)
    late[280 * 1024] = 9
    await writeFile(join(root, 'b.bin'), late)
    expect(await fingerprint(join(root, 'b.bin'))).toBe(fp)
    const early = Buffer.from(big)
    early[100 * 1024] = 9
    await writeFile(join(root, 'c.bin'), early)
    expect(await fingerprint(join(root, 'c.bin'))).not.toBe(fp)
    await writeFile(join(root, 'd.bin'), Buffer.alloc(300 * 1024 + 1, 7))
    expect(await fingerprint(join(root, 'd.bin'))).not.toBe(fp)
  })

  it('pick of a new file returns a pick with its file name', async () => {
    const lib = await open()
    const r = await lib.pick(await pdf('Week1.pdf'))
    expect(r).toMatchObject({ kind: 'new', fileName: 'Week1.pdf' })
  })

  it('adding a file already on the shelf returns the existing reading and heals its path', async () => {
    const lib = await open()
    const A = await pdf('a.pdf')
    const id = await addFrom(lib, A)
    lib.update(id, { position: { page: 2, textItemIndex: 3, charOffset: 4 } })
    const B = join(root, 'moved', 'b.pdf')
    await mkdir(join(root, 'moved'))
    await copyFile(A, B)
    await unlink(A)
    expect(await lib.pick(B)).toEqual({ kind: 'existing', readingId: id })
    await lib.flush()
    const d = await stored()
    expect(d.readings).toHaveLength(1)
    expect(d.readings[0].path).toBe(B)
    expect(d.readings[0].position).toEqual({ page: 2, textItemIndex: 3, charOffset: 4 })
  })

  it('adds, reads and names a file whose path has spaces and non-ASCII characters', async () => {
    const lib = await open()
    const p = await pdf('Wéek 4 – Institutions (final).pdf', join(root, 'my readings ü'))
    const id = await addFrom(lib, p)
    expect(lib.snapshot().readings[0].fileName).toBe('Wéek 4 – Institutions (final).pdf')
    const res = await lib.read({ readingId: id })
    expect(res.ok).toBe(true)
    if (res.ok) expect(Buffer.from(res.data).equals(await readFile(FIXTURE))).toBe(true)
  })

  it('add creates a course from a new name, reuses one with the same name ignoring case, and null is Other', async () => {
    const lib = await open()
    await addFrom(lib, await pdf('a.pdf'), { newName: '  Politics 101 ' })
    await addFrom(lib, await variant('b.pdf', 'x'), { newName: 'politics 101' })
    await addFrom(lib, await variant('c.pdf', 'yy'), null)
    const s = lib.snapshot()
    expect(s.courses).toHaveLength(1)
    expect(s.courses[0].name).toBe('Politics 101')
    expect(s.readings.map((r) => r.courseId)).toEqual([s.courses[0].id, s.courses[0].id, null])
    expect(s.readings[0]).toMatchObject({
      addedAt: 1000,
      position: null,
      lastOpenedAt: null,
      finished: false,
      readEverything: false
    })
  })

  it('read of a file deleted after launch reports missing and marks the reading missing', async () => {
    const lib = await open()
    const p = await pdf('a.pdf')
    const id = await addFrom(lib, p)
    await unlink(p)
    const cb = vi.fn()
    lib.onChange(cb)
    expect(await lib.read({ readingId: id })).toEqual({ ok: false, reason: 'missing' })
    expect(lib.snapshot().readings[0].missing).toBe(true)
    expect(cb).toHaveBeenCalled()
  })

  it('read of a path that is not a readable file reports unreadable', async () => {
    const lib = await open()
    const p = await pdf('a.pdf')
    const id = await addFrom(lib, p)
    await unlink(p)
    await mkdir(p) // a directory now sits at the path: readFile fails with EISDIR
    expect(await lib.read({ readingId: id })).toEqual({ ok: false, reason: 'unreadable' })
    expect(lib.snapshot().readings[0].missing).toBe(false)
  })

  it('checkMissing marks moved files and clears ones that are back', async () => {
    const lib = await open()
    const p = await pdf('a.pdf')
    await addFrom(lib, p)
    const cb = vi.fn()
    lib.onChange(cb)
    await lib.checkMissing()
    expect(cb).not.toHaveBeenCalled()
    await rename(p, p + '.moved')
    await lib.checkMissing()
    expect(lib.snapshot().readings[0].missing).toBe(true)
    expect(cb).toHaveBeenCalledTimes(1)
    await lib.checkMissing()
    expect(cb).toHaveBeenCalledTimes(1)
    await rename(p + '.moved', p)
    await lib.checkMissing()
    expect(lib.snapshot().readings[0].missing).toBe(false)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('relink with the same file keeps the place; a different file needs useDifferentFile, which resets it', async () => {
    const lib = await open()
    const id = await addFrom(lib, await pdf('a.pdf'))
    lib.update(id, { position: { page: 2, textItemIndex: 1, charOffset: 0 }, finished: true })
    const same = await pdf('same.pdf', join(root, 'x'))
    expect(await lib.relink(id, same)).toEqual({ kind: 'relinked' })
    await lib.flush()
    expect((await stored()).readings[0].path).toBe(same)
    expect((await stored()).readings[0].position).not.toBeNull()

    const other = await variant('other.pdf', 'zz')
    const r = await lib.relink(id, other)
    expect(r).toMatchObject({ kind: 'different', fileName: 'other.pdf' })
    if (r.kind !== 'different') throw new Error('expected different')
    await lib.flush()
    expect((await stored()).readings[0].path).toBe(same)
    lib.useDifferentFile(id, r.pickId)
    await lib.flush()
    expect((await stored()).readings[0]).toMatchObject({
      path: other,
      position: null,
      finished: false,
      pageCount: null,
      fingerprint: await fingerprint(other)
    })
  })

  it('remove deletes the reading, and an emptied course disappears with its collapsed state', async () => {
    const lib = await open()
    const id = await addFrom(lib, await pdf('a.pdf'), { newName: 'Law' })
    const courseId = lib.snapshot().courses[0].id
    lib.setCollapsed(courseId, true)
    lib.setCollapsed('other', true)
    lib.remove(id)
    const s = lib.snapshot()
    expect(s.readings).toHaveLength(0)
    expect(s.courses).toHaveLength(0)
    expect(s.ui.collapsed).toEqual(['other'])
  })

  it('update: opened stamps lastOpenedAt, empty titles are ignored, unknown ids are a no-op', async () => {
    const lib = await open()
    const id = await addFrom(lib, await pdf('a.pdf'))
    lib.update(id, { opened: true })
    expect(lib.snapshot().readings[0].lastOpenedAt).toBe(1000)
    lib.update(id, { title: '   ' })
    lib.update(id, { title: 'x'.repeat(201) })
    expect(lib.snapshot().readings[0].title).toBe('T')
    lib.update(id, { title: '  New  ' })
    expect(lib.snapshot().readings[0].title).toBe('New')
    const before = JSON.stringify(lib.snapshot())
    lib.update('nope', { title: 'z', opened: true })
    expect(JSON.stringify(lib.snapshot())).toBe(before)
  })

  it('add with an unknown pick throws', async () => {
    const lib = await open()
    expect(() => lib.add({ pickId: 'zzz', title: 'x', pageCount: null, course: null })).toThrow(
      'unknown pick'
    )
  })

  it('keeps at most 20 pending picks, dropping the oldest', async () => {
    const lib = await open()
    const first = await lib.pick(await pdf('p0.pdf'))
    for (let i = 1; i <= 20; i++) await lib.pick(await variant(`p${i}.pdf`, String(i)))
    if (first.kind !== 'new') throw new Error('expected new')
    expect(() =>
      lib.add({ pickId: first.pickId, title: 'x', pageCount: null, course: null })
    ).toThrow('unknown pick')
  })

  it('two picks of the same new file, then two adds, give one reading', async () => {
    const lib = await open()
    const A = await pdf('a.pdf')
    const p1 = await lib.pick(A)
    const p2 = await lib.pick(A)
    if (p1.kind !== 'new' || p2.kind !== 'new') throw new Error('expected new')
    const id1 = lib.add({ pickId: p1.pickId, title: 'T', pageCount: 1, course: null })
    const id2 = lib.add({ pickId: p2.pickId, title: 'T', pageCount: 1, course: null })
    expect(id2).toBe(id1)
    expect(lib.snapshot().readings).toHaveLength(1)
  })

  it('relink onto another reading file never duplicates it or resets its place', async () => {
    const lib = await open()
    const a = await addFrom(lib, await pdf('a.pdf'))
    const bPath = await variant('b.pdf', 'q')
    const b = await addFrom(lib, bPath)
    lib.update(b, { position: { page: 3, textItemIndex: 1, charOffset: 2 }, finished: true })
    const r = await lib.relink(a, bPath)
    if (r.kind !== 'different') throw new Error('expected different')
    expect(() => lib.useDifferentFile(a, r.pickId)).toThrow('file already on shelf')
    const s = lib.snapshot()
    expect(s.readings).toHaveLength(2)
    expect(s.readings.find((x) => x.id === b)).toMatchObject({ finished: true })
    expect(s.readings.find((x) => x.id === a)?.fileName).toBe('a.pdf')
  })

  it('a successful read clears the missing flag; an update with nothing valid is a no-op', async () => {
    const lib = await open()
    const p = await pdf('a.pdf')
    const id = await addFrom(lib, p)
    await rename(p, p + '.moved')
    await lib.checkMissing()
    await rename(p + '.moved', p)
    const cb = vi.fn()
    lib.onChange(cb)
    expect((await lib.read({ readingId: id })).ok).toBe(true)
    expect(lib.snapshot().readings[0].missing).toBe(false)
    expect(cb).toHaveBeenCalledTimes(1)
    lib.update(id, { title: '  ' })
    lib.update(id, {})
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('settings.voice and speed default, validate and persist', async () => {
    const lib = await open()
    expect(lib.snapshot().settings).toMatchObject({ voice: 'bf_emma', speed: 1 })
    lib.setVoice('am_puck', 1.5)
    expect(lib.snapshot().settings).toMatchObject({ voice: 'am_puck', speed: 1.5 })
    lib.setVoice('nope', 2)
    lib.setVoice('bf_emma', 3)
    expect(lib.snapshot().settings).toMatchObject({ voice: 'am_puck', speed: 1.5 })
    await lib.flush()
    const file = join(root, 'data', 'library.json')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    expect(raw.settings).toMatchObject({ voice: 'am_puck', speed: 1.5 })
    const lib2 = await Library.open(join(root, 'data'), { debounceMs: 20 })
    libs.push(lib2)
    expect(lib2.snapshot().settings).toMatchObject({ voice: 'am_puck', speed: 1.5 })
    const bad = { ...raw, settings: { ...raw.settings, voice: 'x', speed: 9 } }
    await writeFile(file, JSON.stringify(bad))
    const lib3 = await Library.open(join(root, 'data'), { debounceMs: 20 })
    libs.push(lib3)
    expect(lib3.snapshot().settings).toMatchObject({ voice: 'bf_emma', speed: 1 })
  })

  it('tipsSeen defaults to empty and records a key once', async () => {
    const lib = await open()
    expect(lib.snapshot().ui.tipsSeen).toEqual([])
    const cb = vi.fn()
    lib.onChange(cb)
    lib.tipSeen('voice-tip')
    lib.tipSeen('voice-tip')
    lib.tipSeen('other')
    expect(lib.snapshot().ui.tipsSeen).toEqual(['voice-tip', 'other'])
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('tells listeners when a change touched only the position', async () => {
    const lib = await open()
    const id = await addFrom(lib, await pdf('a.pdf'))
    const kinds: string[] = []
    lib.onChange((k) => kinds.push(k))
    lib.update(id, { position: { page: 2, textItemIndex: 0, charOffset: 0 } })
    lib.update(id, { position: { page: 3, textItemIndex: 0, charOffset: 0 }, finished: true })
    lib.update(id, { readEverything: true })
    lib.setZoom(1.2)
    expect(kinds).toEqual(['position', 'other', 'other', 'other'])
  })
})
