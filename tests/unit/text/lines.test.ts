import { describe, it, expect } from 'vitest'
import { extractPages } from '../../../src/shared/text/extract'
import { buildLines } from '../../../src/shared/text/lines'
import { loadSidecars, page, readFixture, type ItemSpec } from './helpers'

const sidecars = loadSidecars()

describe('buildLines', () => {
  it('orders two-column text left column first', async () => {
    const lines = buildLines((await extractPages(readFixture('two-column.pdf')))[0]).map(
      (l) => l.text
    )
    expect(lines.indexOf('LEFT-END')).toBeLessThan(lines.indexOf('RIGHT-START')) // markers placed by the generator
  })

  it('covers every fixture', () => expect(sidecars.length).toBe(9))

  describe.each(sidecars.map((s) => [s.fixture, s] as const))('%s', (fixture, sidecar) => {
    it('produces the sidecar lines, in reading order, on every page', async () => {
      const pages = await extractPages(readFixture(fixture))
      expect(pages).toHaveLength(sidecar.pageCount)
      expect(pages.map((p) => buildLines(p).map((l) => l.text))).toEqual(
        sidecar.pages.map((p) => p.lines)
      )
    })
  })

  it('puts a full-width title before both columns and keeps column lines out of each other', async () => {
    const lines = buildLines((await extractPages(readFixture('two-column.pdf')))[0])
    expect(lines[0].text).toBe('Attention and Working Memory: A Review')
    expect(lines[1].text).toBe('Department of Psychology, Course Reader')
    const leftEnd = lines.findIndex((l) => l.text === 'LEFT-END')
    expect(lines.slice(2, leftEnd + 1).every((l) => l.x + l.width <= 306)).toBe(true)
    expect(lines.slice(leftEnd + 1).every((l) => l.x >= 306)).toBe(true)
  })

  it('gives each line its dominant font size, top-origin baseline and horizontal extent', async () => {
    const [p1] = await extractPages(readFixture('single-column.pdf'))
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

  describe('bands around full-width lines', () => {
    it('reads band A left, band A right, the full-width line, then band B left and right', async () => {
      const lines = buildLines((await extractPages(readFixture('layout.pdf')))[0]).map(
        (l) => l.text
      )
      const at = (marker: string): number => lines.findIndex((t) => t.startsWith(marker))
      const order = [
        'A-LEFT-END',
        'A-RIGHT-START',
        'MID-FULL',
        'B-LEFT-START',
        'B-RIGHT-START'
      ].map(at)
      expect(order.every((i) => i >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      // Band A's left column runs in full before its right column starts.
      expect(lines.indexOf('Sleep research began with simple questions')).toBeLessThan(order[0])
      expect(lines.indexOf('Memory benefits from those cycles in different')).toBeGreaterThan(
        order[0]
      )
    })

    it('does not split a table band between full-width paragraphs into columns', () => {
      const full = (str: string, y: number): ItemSpec => ({ str, x: 72, y, width: 468 })
      const cell = (str: string, x: number, y: number): ItemSpec => ({ str, x, y, width: 60 })
      const items: ItemSpec[] = [full('A full-width paragraph line above the table.', 100)]
      for (let k = 0; k < 6; k++)
        items.push(cell(`left ${k}`, 72, 130 + k * 13), cell(`right ${k}`, 324, 130 + k * 13))
      items.push(full('A full-width paragraph line below the table.', 260))
      expect(buildLines(page(items)).map((l) => l.text)).toEqual([
        'A full-width paragraph line above the table.',
        ...[0, 1, 2, 3, 4, 5].map((k) => `left ${k} right ${k}`),
        'A full-width paragraph line below the table.'
      ])
    })
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
    const items: ItemSpec[] = []
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
    const items: ItemSpec[] = []
    for (let k = 0; k < 12; k++) items.push({ str: `L${k}`, x: 72, y: 100 + k * 13, width: 200 })
    for (let k = 0; k < 11; k++) items.push({ str: `R${k}`, x: 324, y: 106 + k * 13, width: 200 })
    const text = buildLines(page(items)).map((l) => l.text)
    expect(text).toEqual(
      [...Array(12).keys()].map((k) => `L${k}`).concat([...Array(11).keys()].map((k) => `R${k}`))
    )
  })

  const col = (side: 'L' | 'R', n: number, top = 100): ItemSpec[] =>
    [...Array(n).keys()].map((k) => ({
      str: `${side}${k}`,
      x: side === 'L' ? 72 : 324,
      y: top + k * 13,
      width: 200
    }))
  /** Columns of prose-like lines (5 words each): a band cut by a separator row only counts as columns then. */
  const pcol = (side: 'L' | 'R', n: number, top = 100): ItemSpec[] =>
    col(side, n, top).map((i) => ({ ...i, str: `${i.str} one two three four` }))
  const pnames = (side: 'L' | 'R', n: number): string[] =>
    names(side, n).map((t) => `${t} one two three four`)
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
    const items = [...abstract, ...pcol('L', 8, 250), ...pcol('R', 8, 250)]
    expect(buildLines(page(items)).map((l) => l.text)).toEqual([
      ...abstract.map((a) => a.str),
      ...pnames('L', 8),
      ...pnames('R', 8)
    ])
  })

  it('places full-width lines before the first column that starts below them, and after both otherwise', () => {
    const items = [
      { str: 'Title', x: 150, y: 60, width: 300 },
      { str: 'Footer', x: 290, y: 760, width: 30 },
      ...pcol('L', 50),
      ...pcol('R', 50)
    ]
    expect(buildLines(page(items)).map((l) => l.text)).toEqual([
      'Title',
      ...pnames('L', 50),
      ...pnames('R', 50),
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
