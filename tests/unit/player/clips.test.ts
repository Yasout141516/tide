import { describe, expect, it } from 'vitest'
import { progressiveClips } from '../../../src/renderer/src/player/clips'

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length

const long40 =
  'When the morning light finally reached the valley the farmers began to gather near the old well and talk about the harvest, the weather, the price of grain, and the long road to the market town beyond the hills'

describe('progressiveClips', () => {
  it('rejoins exactly, starts at <= 8 words and grows by at most 2x', () => {
    const texts = [
      long40,
      long40 + ' ' + long40,
      'Students who study with their phones nearby check them often and each check breaks the flow of encoding',
      'a '.repeat(100).trim()
    ]
    for (const t of texts) {
      const parts = progressiveClips(t)
      expect(parts.join('')).toBe(t)
      expect(words(parts[0])).toBeLessThanOrEqual(8)
      expect(parts.length).toBeGreaterThan(1)
      for (let k = 1; k < parts.length - 1; k++) {
        expect(words(parts[k])).toBeLessThanOrEqual(2 * words(parts[k - 1]))
      }
      // the last piece is never a stub
      expect(words(parts[parts.length - 1])).toBeGreaterThanOrEqual(3)
    }
  })

  it('a growth of 1 keeps every piece at the first size (slow machine)', () => {
    const parts = progressiveClips(long40, { growth: 1 })
    expect(parts.join('')).toBe(long40)
    for (let k = 1; k < parts.length - 1; k++) {
      expect(words(parts[k])).toBeLessThanOrEqual(words(parts[k - 1]))
    }
  })

  it('cuts at a clause boundary when one is in reach, else at a word boundary', () => {
    const a =
      'When the morning light finally reached the valley, the farmers began to gather near the old well.'
    const parts = progressiveClips(a)
    expect(parts[0]).toBe('When the morning light finally reached the valley,')
    expect(parts.join('')).toBe(a)
    const t =
      'Students who study with their phones nearby check them often and each check breaks the flow of encoding'
    expect(progressiveClips(t)[0]).toBe('Students who study with their phones nearby check')
  })

  it('keeps short sentences whole', () => {
    for (const t of [
      'Well, that was fast and fun.',
      'The boats came back with crates of silver fish',
      'The boats came back with crates of silver'
    ]) {
      expect(progressiveClips(t)).toEqual([t])
    }
  })

  it('does not split inside numbers or times, and never leaves a stub', () => {
    const a = 'About 1,000 people came at 12:30 to see the old harbour lights tonight.'
    const pa = progressiveClips(a)
    expect(pa.join('')).toBe(a)
    for (const p of pa) expect(p.trim()).not.toMatch(/^,000|^30\b/)
    const b = 'We counted about 1,000 boats at 12:30 near the quiet old harbour wall today'
    expect(progressiveClips(b, { firstWords: 4 })[0]).toBe('We counted about 1,000')
    const c = 'We paid about 1,000 dollars, then walked to the old gate today and sat'
    expect(progressiveClips(c, { firstWords: 5 })[0]).toBe('We paid about 1,000 dollars,')
  })

  it('never cuts right before a closing quote or bracket', () => {
    const q = 'She read the old notice aloud twice before saying "stay away from the harbour wall"'
    const parts = progressiveClips(q)
    expect(parts.join('')).toBe(q)
    for (const p of parts.slice(1)) expect(p.trimStart()[0]).not.toBe('"')
  })

  it('holds the rules over many shapes of sentence', () => {
    let seed = 7
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let k = 0; k < 300; k++) {
      const n = 1 + Math.floor(rnd() * 70)
      const text = Array.from({ length: n }, (_, j) => {
        const r = rnd()
        return `w${j}${r < 0.12 ? ',' : r < 0.15 ? ';' : ''}`
      }).join(' ')
      const growth = 1 + rnd()
      const parts = progressiveClips(text, { growth })
      expect(parts.join('')).toBe(text)
      expect(words(parts[0])).toBeLessThanOrEqual(parts.length === 1 ? 10 : 8)
      for (let p = 1; p < parts.length; p++) {
        expect(words(parts[p])).toBeLessThanOrEqual(2 * words(parts[p - 1]))
      }
      if (parts.length > 1) expect(words(parts[parts.length - 1])).toBeGreaterThanOrEqual(3)
    }
  })
})
