import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPages } from '../../../src/shared/text/extract'
import { normalizeText } from '../../../src/shared/text/normalize'

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'pdfs')
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)))

describe('normalizeText', () => {
  it('normalizes ligatures', () =>
    expect(normalizeText('\uFB01gure bene\uFB01t o\u00ADther')).toBe('figure benefit other'))

  it('expands every ligature, maps no-break and thin spaces, and collapses runs of spaces', () => {
    expect(normalizeText('\uFB02at E\uFB00ects o\uFB03ce ba\uFB04ing')).toBe(
      'flat Effects office baffling'
    )
    expect(normalizeText('450\u00A0ms  and\u2009 more')).toBe('450 ms and more')
  })

  it('leaves ordinary text alone', () =>
    expect(normalizeText('PSYC 201 — Week 4 ¹ [3–5]')).toBe('PSYC 201 — Week 4 ¹ [3–5]'))
})

describe('extractPages', () => {
  it('extracts items with top-origin y and page numbers', async () => {
    const pages = await extractPages(read('single-column.pdf'))
    expect(pages).toHaveLength(4)
    expect(pages[0].items[0].page).toBe(1)
    const header = pages[0].items.find((i) => i.str.includes('PSYC 201'))!
    expect(header.y).toBeLessThan(pages[0].height * 0.1)
  })

  it('reports page size, page numbers and item geometry in PDF points', async () => {
    const pages = await extractPages(read('single-column.pdf'))
    pages.forEach((p, i) => {
      expect(p).toMatchObject({ page: i + 1, width: 612, height: 792 })
      for (const item of p.items) expect(item.page).toBe(i + 1)
    })
    const header = pages[0].items.find((i) => i.str === 'PSYC 201 — Week 4')!
    expect(header).toMatchObject({ x: 72, y: 40, fontSize: 9 })
    expect(header.width).toBeGreaterThan(50)
    const footer = pages[3].items.find((i) => i.str === 'Page 4')!
    expect(footer.y).toBeCloseTo(760)
    expect(footer.y).toBeGreaterThan(pages[3].height * 0.9)
  })

  it('skips empty items but keeps each item index pointing at its pdf.js text item', async () => {
    const data = read('single-column.pdf')
    const pages = await extractPages(data)
    const doc = await getDocument({ data: data.slice(), verbosity: 0 }).promise
    try {
      const raw = await (await doc.getPage(1)).getTextContent({ disableNormalization: true })
      const rawStrs = raw.items.map((i) => ('str' in i ? i.str : ''))
      expect(rawStrs).toContain('') // pdf.js does emit empty end-of-line items for this page
      const items = pages[0].items
      expect(items.every((i) => i.str !== '')).toBe(true)
      expect(items.length).toBe(rawStrs.filter((s) => s !== '').length)
      for (const item of items) expect(rawStrs[item.index]).toBe(item.str)
      for (let k = 1; k < items.length; k++)
        expect(items[k].index).toBeGreaterThan(items[k - 1].index)
    } finally {
      await doc.destroy()
    }
  })

  it('keeps original typographic characters in item str', async () => {
    const [page] = await extractPages(read('ligatures.pdf'))
    const text = page.items.map((i) => i.str).join(' ')
    expect(text).toContain('\uFB01gure')
    expect(text).toContain('bene\uFB01t')
    for (const lig of ['\uFB00', '\uFB02', '\uFB03', '\uFB04']) expect(text).toContain(lig)
    // pdf.js drops U+00AD from text content, so the soft-hyphenated word arrives whole.
    expect(text).toContain('other')
  })

  it('returns pages with no items for a PDF without a text layer', async () => {
    const pages = await extractPages(read('no-text.pdf'))
    expect(pages.map((p) => p.items.length)).toEqual([0, 0])
    expect(pages.map((p) => p.page)).toEqual([1, 2])
  })

  it('rejects data that is not a PDF', async () => {
    await expect(extractPages(new TextEncoder().encode('not a pdf'))).rejects.toThrow()
  })

  it('does not detach or modify the caller’s buffer', async () => {
    const data = read('citations.pdf')
    const copy = data.slice()
    await extractPages(data)
    expect(data.byteLength).toBe(copy.byteLength)
    expect(Buffer.compare(data, copy)).toBe(0)
  })
})
