import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { extractPages } from '../../../src/shared/text/extract'
import { buildLines } from '../../../src/shared/text/lines'
import type { PageText, TextItem } from '../../../src/shared/text/types'

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'pdfs')
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)))

interface Sidecar {
  fixture: string
  pageCount: number
  pages: Array<{ page: number; lines: string[] }>
}

const sidecars = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Sidecar)

/** Builds a synthetic page; `w` defaults to 5pt per character. */
function page(
  items: Array<Partial<TextItem> & { str: string; x: number; y: number }>,
  width = 612,
  height = 792
): PageText {
  return {
    page: 1,
    width,
    height,
    items: items.map((i, index) => ({
      page: 1,
      index,
      fontSize: 10,
      width: i.str.length * 5,
      ...i
    }))
  }
}

describe('buildLines', () => {
  it('orders two-column text left column first', async () => {
    const lines = buildLines((await extractPages(read('two-column.pdf')))[0]).map((l) => l.text)
    expect(lines.indexOf('LEFT-END')).toBeLessThan(lines.indexOf('RIGHT-START')) // markers placed by the generator
  })

  it('covers every fixture', () => expect(sidecars.length).toBe(8))

  describe.each(sidecars.map((s) => [s.fixture, s] as const))('%s', (fixture, sidecar) => {
    it('produces the sidecar lines, in reading order, on every page', async () => {
      const pages = await extractPages(read(fixture))
      expect(pages).toHaveLength(sidecar.pageCount)
      expect(pages.map((p) => buildLines(p).map((l) => l.text))).toEqual(
        sidecar.pages.map((p) => p.lines)
      )
    })
  })

  it('puts a full-width title before both columns and keeps column lines out of each other', async () => {
    const lines = buildLines((await extractPages(read('two-column.pdf')))[0])
    expect(lines[0].text).toBe('Attention and Working Memory: A Review')
    expect(lines[1].text).toBe('Department of Psychology, Course Reader')
    const leftEnd = lines.findIndex((l) => l.text === 'LEFT-END')
    expect(lines.slice(2, leftEnd + 1).every((l) => l.x + l.width <= 306)).toBe(true)
    expect(lines.slice(leftEnd + 1).every((l) => l.x >= 306)).toBe(true)
  })

  it('gives each line its dominant font size, top-origin baseline and horizontal extent', async () => {
    const [p1] = await extractPages(read('single-column.pdf'))
    const lines = buildLines(p1)
    const withMarker = lines.find((l) => l.text.startsWith('Working memory capacity¹'))!
    expect(withMarker.fontSize).toBe(11)
    expect(withMarker.items.map((i) => i.str)).toEqual([
      'Working memory capacity',
      '¹',
      'is limited to a few items at once.'
    ])
    const body = lines.find((l) => l.text.startsWith('Most adults'))!
    expect(withMarker.y).toBeCloseTo(body.y - 15)
    expect(withMarker.x).toBe(72)
    const last = withMarker.items[2]
    expect(withMarker.x + withMarker.width).toBeCloseTo(last.x + last.width)
    expect(lines.find((l) => l.text.startsWith('¹ See Miller'))!.fontSize).toBe(7)
    expect(lines[0]).toMatchObject({ text: 'PSYC 201 — Week 4', fontSize: 9, y: 40, page: 1 })
  })

  it('returns no lines for a page without text', () => expect(buildLines(page([]))).toEqual([]))

  it('sorts items in a line by x and inserts a space only for real gaps', () => {
    const lines = buildLines(
      page([
        { str: 'world', x: 131, y: 100 }, // gap of 6pt after "hello " -> space
        { str: 'hello', x: 100, y: 100.3 },
        { str: 'ful', x: 157, y: 100 }, // gap of 1pt (< 0.15 x 10) -> no space
        { str: 'next line', x: 100, y: 114 }
      ])
    )
    expect(lines.map((l) => l.text)).toEqual(['hello worldful', 'next line'])
    expect(lines[0].items.map((i) => i.str)).toEqual(['hello', 'world', 'ful'])
  })

  it('normalizes line text but keeps item strings untouched', () => {
    const [line] = buildLines(page([{ str: 'the \uFB01gure', x: 100, y: 100 }]))
    expect(line.text).toBe('the figure')
    expect(line.items[0].str).toBe('the \uFB01gure')
  })

  it('ignores whitespace-only items, which pdf.js emits across column gutters', () => {
    const items: Array<Partial<TextItem> & { str: string; x: number; y: number }> = []
    for (let k = 0; k < 10; k++) {
      items.push({ str: `left ${k}`, x: 72, y: 100 + k * 13, width: 200 })
      items.push({ str: ' ', x: 272, y: 100 + k * 13, width: 52 })
      items.push({ str: `right ${k}`, x: 324, y: 100 + k * 13, width: 200 })
    }
    const lines = buildLines(page(items))
    expect(lines.map((l) => l.text)).toEqual(
      [...Array(10).keys()]
        .map((k) => `left ${k}`)
        .concat([...Array(10).keys()].map((k) => `right ${k}`))
    )
    expect(lines.every((l) => l.items.every((i) => i.str.trim() !== ''))).toBe(true)
  })

  it('detects two columns whose baselines are not aligned', () => {
    const items: Array<Partial<TextItem> & { str: string; x: number; y: number }> = []
    for (let k = 0; k < 12; k++) items.push({ str: `L${k}`, x: 72, y: 100 + k * 13, width: 200 })
    for (let k = 0; k < 11; k++) items.push({ str: `R${k}`, x: 324, y: 106 + k * 13, width: 200 })
    const text = buildLines(page(items)).map((l) => l.text)
    expect(text).toEqual(
      [...Array(12).keys()].map((k) => `L${k}`).concat([...Array(11).keys()].map((k) => `R${k}`))
    )
  })

  const col = (
    side: 'L' | 'R',
    n: number,
    top = 100
  ): Array<Partial<TextItem> & { str: string; x: number; y: number }> =>
    [...Array(n).keys()].map((k) => ({
      str: `${side}${k}`,
      x: side === 'L' ? 72 : 324,
      y: top + k * 13,
      width: 200
    }))
  const names = (side: 'L' | 'R', n: number): string[] =>
    [...Array(n).keys()].map((k) => `${side}${k}`)

  it('reads a short two-column page with a running header and page footer column by column', () => {
    // The columns cover 117pt of the 720pt from header to footer: coverage is measured over body text
    // only, so the header/footer in the top and bottom 8% of the page must not dilute it.
    const items = [
      { str: 'PSYC 201 — Week 4', x: 72, y: 40, width: 90, fontSize: 9 },
      { str: 'Page 3', x: 292, y: 760, width: 27, fontSize: 9 },
      ...col('L', 10),
      ...col('R', 10)
    ]
    expect(buildLines(page(items)).map((l) => l.text)).toEqual([
      'PSYC 201 — Week 4',
      ...names('L', 10),
      ...names('R', 10),
      'Page 3'
    ])
  })

  it('reads a short last page (balanced columns ending high on the page) column by column', () => {
    const items = [
      { str: 'Running head', x: 72, y: 40, width: 60, fontSize: 9 },
      ...col('L', 8),
      ...col('R', 7),
      { str: '12', x: 300, y: 760, width: 10, fontSize: 9 }
    ]
    expect(buildLines(page(items)).map((l) => l.text)).toEqual([
      'Running head',
      ...names('L', 8),
      ...names('R', 7),
      '12'
    ])
  })

  it('does not let full-width lines above the columns dilute the coverage', () => {
    // A long full-width abstract above short columns, as on the first page of a paper.
    const abstract = [...Array(12).keys()].map((k) => ({
      str: `Abstract ${k}`,
      x: 72,
      y: 80 + k * 13,
      width: 468
    }))
    const items = [...abstract, ...col('L', 8, 250), ...col('R', 8, 250)]
    expect(buildLines(page(items)).map((l) => l.text)).toEqual([
      ...abstract.map((a) => a.str),
      ...names('L', 8),
      ...names('R', 8)
    ])
  })

  it('places full-width lines before the first column that starts below them, and after both otherwise', () => {
    const items = [
      { str: 'Title', x: 150, y: 60, width: 300 },
      { str: 'Footer', x: 290, y: 760, width: 30 },
      ...col('L', 50),
      ...col('R', 50)
    ]
    expect(buildLines(page(items)).map((l) => l.text)).toEqual([
      'Title',
      ...names('L', 50),
      ...names('R', 50),
      'Footer'
    ])
  })

  it('still needs both sides over 70% of the body span', () => {
    // Right column only a third as tall as the left: not detected as two columns.
    const text = buildLines(page([...col('L', 12), ...col('R', 4)])).map((l) => l.text)
    expect(text[0]).toBe('L0 R0')
  })

  it('treats ordinary single-column text as one column', () => {
    const items = [...Array(20).keys()].map((k) => ({
      str: `line ${k} of a paragraph`,
      x: 72,
      y: 100 + k * 15,
      width: k % 5 === 4 ? 150 : 468
    }))
    expect(buildLines(page(items)).map((l) => l.text)).toEqual(items.map((i) => i.str))
  })
})
