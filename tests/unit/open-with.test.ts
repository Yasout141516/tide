import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { filesFromArgv, OpenWithQueue } from '../../src/main/open-with'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'tide-ow-'))
}

describe('filesFromArgv', () => {
  it('keeps existing pdf paths only', () => {
    const dir = tmp()
    const a = join(dir, 'a.PDF')
    writeFileSync(a, '%PDF')
    writeFileSync(join(dir, 'notes.txt'), 'x')
    mkdirSync(join(dir, 'folder.pdf'))
    const argv = [
      join(dir, 'Tide.exe'),
      '--flag',
      join(dir, 'out', 'main', 'index.js'),
      a,
      join(dir, 'missing.pdf'),
      join(dir, 'notes.txt'),
      join(dir, 'folder.pdf')
    ]
    expect(filesFromArgv(argv, dir)).toEqual([a])
  })

  it('ignores flags even when they end in .pdf', () => {
    const dir = tmp()
    writeFileSync(join(dir, '--x.pdf'), '%PDF')
    expect(filesFromArgv(['Tide.exe', '--x.pdf'], dir)).toEqual([])
  })

  it('resolves relative paths against the second instance cwd', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'rel.pdf'), '%PDF')
    expect(filesFromArgv(['Tide.exe', 'rel.pdf'], dir)).toEqual([join(dir, 'rel.pdf')])
  })
})

describe('OpenWithQueue', () => {
  it('buffers paths until attached, then drains in order', async () => {
    const q = new OpenWithQueue()
    const seen: string[] = []
    q.push('a')
    q.push('b')
    const handle = vi.fn(async (p: string) => {
      await new Promise((r) => setTimeout(r, p === 'a' ? 10 : 0))
      seen.push(p)
    })
    q.attach(handle)
    q.push('c')
    await vi.waitFor(() => expect(seen).toEqual(['a', 'b', 'c']))
  })

  it('keeps draining after a handler rejects', async () => {
    const q = new OpenWithQueue()
    const seen: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    q.push('bad')
    q.push('ok')
    q.attach(async (p) => {
      if (p === 'bad') throw new Error('boom')
      seen.push(p)
    })
    await vi.waitFor(() => expect(seen).toEqual(['ok']))
    err.mockRestore()
  })
})
