import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { normalizeText } from '../../../src/shared/text/normalize'
import { SpokenText } from '../../../src/shared/text/spoken'
import type { Line, Span } from '../../../src/shared/text/types'
import { FIXTURES, line, lineOf, linesOf } from './helpers'

/** The original characters a list of spans covers, normalized and joined. */
function spanText(lines: Line[], spans: Span[]): string {
  const items = lines.flatMap((l) => l.items)
  return spans
    .map((s) => {
      const item = items.find((i) => i.page === s.page && i.index === s.itemIndex)!
      return normalizeText(item.str.slice(s.start, s.end))
    })
    .join('')
}

const noSpace = (s: string): string => s.replace(/\s+/g, '')

describe('SpokenText', () => {
  it('de-hyphenates across lines and maps back to both items', () => {
    const s = new SpokenText()
    s.appendLine(line('keep atten-', 1, 0))
    s.appendLine(line('tion here.', 1, 1))
    const [b] = s.blocks()
    expect(b.text).toBe('keep attention here.')
    expect(b.map(5, 14).map((x) => x.itemIndex)).toEqual([0, 1])
    // The dropped hyphen (offset 10 of item 0) is not part of any span.
    expect(b.map(5, 14)).toEqual([
      { page: 1, itemIndex: 0, start: 5, end: 10 },
      { page: 1, itemIndex: 1, start: 0, end: 4 }
    ])
  })

  it('joins lines with a space that maps to nothing', () => {
    const s = new SpokenText()
    s.appendLine(line('first line', 2, 4))
    s.appendLine(line('second line', 2, 5))
    const [b] = s.blocks()
    expect(b.text).toBe('first line second line')
    expect(b.map(10, 11)).toEqual([])
    expect(b.map(6, 17)).toEqual([
      { page: 2, itemIndex: 4, start: 6, end: 10 },
      { page: 2, itemIndex: 5, start: 0, end: 6 }
    ])
  })

  it('only de-hyphenates a letter + "-" followed by a lowercase letter', () => {
    const joined = (a: string, b: string): string => {
      const s = new SpokenText()
      s.appendLine(line(a, 1, 0))
      s.appendLine(line(b, 1, 1))
      return s.blocks()[0].text
    }
    expect(joined('a well-', 'Known fact')).toBe('a well- Known fact')
    expect(joined('pages 12-', 'to 14')).toBe('pages 12- to 14')
    expect(joined('a dash -', 'then more')).toBe('a dash - then more')
    expect(joined('self-', 'report')).toBe('selfreport')
  })

  it('remove keeps mapping consistent', () => {
    // 0         1         2         3
    // 0123456789012345678901234567890123456
    // Memory fades (Smith, 2019) Then it returns.
    const s = new SpokenText()
    s.appendLine(line('Memory fades (Smith, 2019) Then it returns.', 1, 7))
    s.remove(/\(Smith, 2019\) ?/)
    const [b] = s.blocks()
    expect(b.text).toBe('Memory fades Then it returns.')
    const then = b.text.indexOf('Then')
    expect(b.map(then, then + 4)).toEqual([{ page: 1, itemIndex: 7, start: 27, end: 31 }])
    // A range across the removed citation skips it.
    expect(b.map(7, then + 4)).toEqual([
      { page: 1, itemIndex: 7, start: 7, end: 13 },
      { page: 1, itemIndex: 7, start: 27, end: 31 }
    ])
  })

  it('removes every match (with or without the g flag) across items and lines', () => {
    const s = new SpokenText()
    s.appendLine(
      lineOf([
        { str: 'Decay [12]', x: 72, y: 100, index: 0 },
        { str: 'explains [3–5] little.', x: 130, y: 100, index: 1 }
      ])
    )
    s.appendLine(line('Interference [7] does.', 1, 2, 114))
    s.remove(/ ?\[\d+(–\d+)?\]/)
    const [b] = s.blocks()
    expect(b.text).toBe('Decay explains little. Interference does.')
    const little = b.text.indexOf('little')
    expect(b.map(little, little + 6)).toEqual([{ page: 1, itemIndex: 1, start: 15, end: 21 }])
    const does = b.text.indexOf('does')
    expect(b.map(does, does + 4)).toEqual([{ page: 1, itemIndex: 2, start: 17, end: 21 }])
  })

  it('remove survives zero-length matches', () => {
    const s = new SpokenText()
    s.appendLine(line('axxb', 1, 0))
    s.remove(/x*/g)
    const [b] = s.blocks()
    expect(b.text).toBe('ab')
    expect(b.map(0, 2)).toEqual([
      { page: 1, itemIndex: 0, start: 0, end: 1 },
      { page: 1, itemIndex: 0, start: 3, end: 4 }
    ])
  })

  it('maps normalized ligature text back to the single original character', () => {
    const s = new SpokenText()
    s.appendLine(line('the ﬁgure oﬃce', 1, 3))
    const [b] = s.blocks()
    expect(b.text).toBe('the figure office')
    const fi = b.map(4, 6) // "fi"
    expect(fi).toEqual([{ page: 1, itemIndex: 3, start: 4, end: 5 }])
    expect(fi[0].end - fi[0].start).toBe(1)
    expect(b.map(5, 6)).toEqual([{ page: 1, itemIndex: 3, start: 4, end: 5 }]) // just "i"
    expect(b.map(4, 10)).toEqual([{ page: 1, itemIndex: 3, start: 4, end: 9 }]) // "figure"
    // "office": the item's offsets after a length-changing ligature are still right.
    expect(b.map(11, 17)).toEqual([{ page: 1, itemIndex: 3, start: 10, end: 14 }])
  })

  it('maps text whose source has soft hyphens, no-break spaces and collapsed spaces', () => {
    const s = new SpokenText()
    s.appendLine(line('o­ther  450 ms', 1, 0))
    const [b] = s.blocks()
    expect(b.text).toBe('other 450 ms')
    expect(b.map(0, 5)).toEqual([{ page: 1, itemIndex: 0, start: 0, end: 6 }])
    expect(b.map(10, 12)).toEqual([{ page: 1, itemIndex: 0, start: 12, end: 14 }])
  })

  it('skips whitespace the line trimmed from its items, tabs included', () => {
    const s = new SpokenText()
    s.appendLine(line('	  edge words 	', 1, 0))
    const [b] = s.blocks()
    expect(b.text).toBe('edge words')
    expect(b.map(0, 10)).toEqual([{ page: 1, itemIndex: 0, start: 3, end: 13 }])
  })

  it('gives the space inserted between items of a line no span', () => {
    const l = lineOf([
      { str: 'hello', x: 100, y: 100, index: 0 },
      { str: 'world', x: 131, y: 100, index: 1 },
      { str: 'ful', x: 157, y: 100, index: 2 } // touching: no space
    ])
    const s = new SpokenText()
    s.appendLine(l)
    const [b] = s.blocks()
    expect(b.text).toBe('hello worldful')
    expect(b.map(5, 6)).toEqual([])
    expect(b.map(0, 14)).toEqual([
      { page: 1, itemIndex: 0, start: 0, end: 5 },
      { page: 1, itemIndex: 1, start: 0, end: 5 },
      { page: 1, itemIndex: 2, start: 0, end: 3 }
    ])
  })

  it('splits blocks at hard breaks, never joining or de-hyphenating across one', () => {
    const s = new SpokenText()
    s.hardBreak() // a break before anything is a no-op
    s.appendLine(line('Heading-', 1, 0))
    s.hardBreak()
    s.hardBreak() // consecutive breaks do not make empty blocks
    s.appendLine(line('body text', 1, 1, 120))
    const blocks = s.blocks()
    expect(blocks.map((b) => b.text)).toEqual(['Heading-', 'body text'])
    expect(blocks[1].map(0, 4)).toEqual([{ page: 1, itemIndex: 1, start: 0, end: 4 }])
    expect(blocks[0].map(0, 8)).toEqual([{ page: 1, itemIndex: 0, start: 0, end: 8 }])
  })

  it('trims blocks left with edge whitespace by remove, and drops blocks left empty', () => {
    const s = new SpokenText()
    s.appendLine(line('[4] Hello there [5]', 1, 0))
    s.hardBreak()
    s.appendLine(line('[6]', 1, 1, 120))
    s.hardBreak()
    s.appendLine(line('Next', 1, 2, 140))
    s.remove(/\[\d\]/g)
    const blocks = s.blocks()
    expect(blocks.map((b) => b.text)).toEqual(['Hello there', 'Next'])
    expect(blocks[0].map(0, 5)).toEqual([{ page: 1, itemIndex: 0, start: 4, end: 9 }])
    expect(blocks[0].map(0, 11)).toEqual([{ page: 1, itemIndex: 0, start: 4, end: 15 }])
  })

  it('clamps out-of-range and empty ranges', () => {
    const s = new SpokenText()
    s.appendLine(line('abc', 1, 0))
    const [b] = s.blocks()
    expect(b.map(2, 2)).toEqual([])
    expect(b.map(3, 1)).toEqual([])
    expect(b.map(-5, 99)).toEqual([{ page: 1, itemIndex: 0, start: 0, end: 3 }])
  })

  it('returns no blocks when nothing was appended', () =>
    expect(new SpokenText().blocks()).toEqual([]))

  it('drops a hyphen that is a text item of its own', () => {
    const s = new SpokenText()
    s.appendLine(
      lineOf([
        { str: 'selective atten', x: 72, y: 100, index: 0 },
        { str: '-', x: 147, y: 100, index: 1 } // touching: no space
      ])
    )
    s.appendLine(line('tion matters', 1, 2, 114))
    const [b] = s.blocks()
    expect(b.text).toBe('selective attention matters')
    expect(b.map(0, b.text.length)).toEqual([
      { page: 1, itemIndex: 0, start: 0, end: 15 },
      { page: 1, itemIndex: 2, start: 0, end: 12 }
    ])
  })

  it('returns blocks that later edits do not change', () => {
    const s = new SpokenText()
    s.appendLine(line('a well-', 1, 0))
    const [before] = s.blocks()
    s.appendLine(line('known fact', 1, 1, 114))
    s.remove(/well/)
    expect(before.text).toBe('a well-')
    expect(before.map(0, 7)).toEqual([{ page: 1, itemIndex: 0, start: 0, end: 7 }])
    expect(s.blocks()[0].text).toBe('a known fact')
  })

  it('still speaks a line whose text does not match its items, without spans for the mismatch', () => {
    const l = { ...line('alpha beta', 1, 0), text: 'alpha gamma' }
    const s = new SpokenText()
    s.appendLine(l)
    const [b] = s.blocks()
    expect(b.text).toBe('alpha gamma')
    expect(b.map(0, 5)).toEqual([{ page: 1, itemIndex: 0, start: 0, end: 5 }])
    expect(b.map(6, 11)).toEqual([])
  })

  it('keeps spans in reading order across pages', () => {
    const s = new SpokenText()
    s.appendLine(line('end of page one', 1, 9))
    s.appendLine(line('start of page two', 2, 0))
    const [b] = s.blocks()
    expect(b.map(0, b.text.length).map((x) => [x.page, x.itemIndex])).toEqual([
      [1, 9],
      [2, 0]
    ])
  })

  interface Sidecar {
    fixture: string
    pages: Array<{ page: number; spokenReadEverything: string }>
  }
  const sidecars = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Sidecar)

  describe.each(sidecars.map((s) => [s.fixture, s] as const))('%s', (fixture, sidecar) => {
    it('speaks every line as the sidecar says (read everything) and maps every word back', async () => {
      const { lines } = await linesOf(fixture)
      lines.forEach((pageLines, p) => {
        const s = new SpokenText()
        for (const l of pageLines) s.appendLine(l)
        const blocks = s.blocks()
        expect(blocks.map((b) => b.text).join(' ')).toBe(sidecar.pages[p].spokenReadEverything)
        for (const b of blocks) {
          expect(noSpace(spanText(pageLines, b.map(0, b.text.length)))).toBe(noSpace(b.text))
          for (const m of b.text.matchAll(/\S+/g)) {
            const spans = b.map(m.index, m.index + m[0].length)
            expect(spanText(pageLines, spans)).toBe(m[0])
          }
        }
      })
    })
  })
})
