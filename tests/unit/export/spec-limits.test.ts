import { describe, expect, it, vi } from 'vitest'
import {
  buildExportSpec,
  clampText,
  exportSentences,
  splitLongText,
  tooLongForOneFile
} from '../../../src/renderer/src/save/spec'
import { MAX_NAME, MAX_SENTENCES, MAX_TEXT } from '../../../src/shared/export-limits'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {} },
  app: { getPath: () => '' },
  dialog: {},
  shell: {}
}))
const { parseSpec } = await import('../../../src/main/export/ipc')

const words = (n: number, w = 'word'): string =>
  Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ')

describe('clampText', () => {
  it('leaves short text alone and cuts long text at a word boundary', () => {
    expect(clampText('short', 200)).toBe('short')
    const out = clampText(words(100), 200)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(words(100).startsWith(out)).toBe(true)
    expect(out).toMatch(/word\d+$/)
    expect(words(100).charAt(out.length)).toBe(' ') // the cut fell between words
  })
  it('hard-cuts one huge word without splitting a surrogate pair', () => {
    const out = clampText('😀'.repeat(300), 201)
    expect(out.length).toBeLessThanOrEqual(201)
    expect(out.length % 2).toBe(0)
  })
})

describe('splitLongText', () => {
  it('splits at word boundaries into pieces of at most 5000 and keeps every word in order', () => {
    const text = words(1500) + '.'
    expect(text.length).toBeGreaterThan(6000)
    const pieces = splitLongText(text)
    expect(pieces.length).toBeGreaterThanOrEqual(2)
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(MAX_TEXT)
    expect(pieces.join(' ')).toBe(text)
  })
  it('splits a spaceless run hard', () => {
    const pieces = splitLongText('x'.repeat(12_000))
    expect(pieces.map((p) => p.length)).toEqual([5000, 5000, 2000])
  })
})

describe('exportSentences and the one-file limit', () => {
  it('splits long sentences on the same page and drops blanks', () => {
    const out = exportSentences([
      { text: words(1500), page: 4 },
      { text: '  ', page: 4 },
      { text: 'Short.', page: 5 }
    ])
    expect(out.slice(0, -1).every((s) => s.page === 4)).toBe(true)
    expect(out.at(-1)).toEqual({ text: 'Short.', page: 5 })
    expect(tooLongForOneFile({ length: MAX_SENTENCES })).toBe(false)
    expect(tooLongForOneFile({ length: MAX_SENTENCES + 1 })).toBe(true)
  })
})

describe('the spec the renderer builds passes main’s real parseSpec', () => {
  const base = {
    readingId: 'r1',
    format: 'm4b' as const,
    voice: 'bf_emma',
    speed: 1
  }
  it('a long title, a long file name and a 6000-character sentence', () => {
    const spec = buildExportSpec({
      ...base,
      baseName: words(80, 'name'),
      title: words(80, 'title'),
      sentences: exportSentences([
        { text: words(1100, 'term') + '.', page: 1 },
        { text: 'Fine.', page: 2 }
      ])
    })
    expect(spec.baseName.length).toBeLessThanOrEqual(MAX_NAME)
    const parsed = parseSpec(spec)
    expect(parsed.sentences.length).toBeGreaterThan(2)
  })
  it('and a spec at exactly the sentence limit', () => {
    const sentences = Array.from({ length: MAX_SENTENCES }, () => ({ text: 'a', page: 1 }))
    expect(() =>
      parseSpec(buildExportSpec({ ...base, baseName: 'x', title: 'x', sentences }))
    ).not.toThrow()
  })
  it('without the renderer’s cuts main rejects the same input (the seam the stub hid)', () => {
    expect(() =>
      parseSpec({
        ...base,
        baseName: words(80, 'name'),
        title: 't',
        sentences: [{ text: 'a', page: 1 }]
      })
    ).toThrow(/export:start expects/)
  })
})
