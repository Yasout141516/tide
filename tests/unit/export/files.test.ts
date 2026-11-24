import { describe, expect, it } from 'vitest'
import { exportDir, failureReason, safeFileName, uniquePath } from '../../../src/main/export/files'

describe('safeFileName', () => {
  it('replaces characters illegal on Windows or macOS and trims dots and spaces', () => {
    expect(safeFileName('Week 3: Memory / Attention?')).toBe('Week 3- Memory - Attention-')
    expect(safeFileName('a\\b*c"d<e>f|g')).toBe('a-b-c-d-e-f-g')
    expect(safeFileName('tab\there\u0000x')).toBe('tab-here-x')
    expect(safeFileName('  ..My   notes..  ')).toBe('My notes')
    expect(safeFileName('a    b')).toBe('a b')
  })

  it('caps at 120 characters and falls back when empty', () => {
    expect(safeFileName('x'.repeat(300))).toHaveLength(120)
    expect(safeFileName(' . . ')).toBe('Tide audio')
    expect(safeFileName('')).toBe('Tide audio')
  })
})

describe('exportDir', () => {
  it('is a Tide folder inside the music folder', () => {
    expect(exportDir('/home/a/Music').replace(/\\/g, '/')).toBe('/home/a/Music/Tide')
  })
})

describe('uniquePath', () => {
  it('adds (2), then (3)', async () => {
    const taken = new Set<string>()
    const exists = (p: string): Promise<boolean> => Promise.resolve(taken.has(p))
    const norm = (p: string): string => p.replace(/\\/g, '/')
    const first = await uniquePath('/d', 'Notes', 'mp3', exists)
    expect(norm(first)).toBe('/d/Notes.mp3')
    taken.add(first)
    const second = await uniquePath('/d', 'Notes', 'mp3', exists)
    expect(norm(second)).toBe('/d/Notes (2).mp3')
    taken.add(second)
    expect(norm(await uniquePath('/d', 'Notes', 'mp3', exists))).toBe('/d/Notes (3).mp3')
  })
})

describe('failureReason', () => {
  const err = (code: string): Error => Object.assign(new Error('x'), { code })
  it('maps ENOSPC, EACCES, EPERM, EROFS and ENOENT', () => {
    expect(failureReason(err('ENOSPC'))).toBe('disk-full')
    for (const c of ['EACCES', 'EPERM', 'EROFS'])
      expect(failureReason(err(c))).toBe('no-permission')
    expect(failureReason(err('ENOENT'))).toBe('folder-missing')
  })
  it('falls back to failed', () => {
    expect(failureReason(err('EIO'))).toBe('failed')
    expect(failureReason(new Error('boom'))).toBe('failed')
    expect(failureReason('nope')).toBe('failed')
  })
})
