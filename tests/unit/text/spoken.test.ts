import { describe, it, expect } from 'vitest'
import { normalizeText } from '../../../src/shared/text/normalize'
import { documentWordsIn, SpokenText } from '../../../src/shared/text/spoken'
import type { Line, Span } from '../../../src/shared/text/types'
import { line, lineOf, linesOf, loadSidecars } from './helpers'

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
    expect(joined('cog-', 'nitive')).toBe('cognitive')
  })

  describe('compound hyphens at a line break', () => {
    const joined = (
      a: string,
      b: string,
      hyphenatedWords?: Set<string>,
      documentWords?: Set<string>
    ): string => {
      const s = new SpokenText({ hyphenatedWords, documentWords })
      s.appendLine(line(a, 1, 0))
      s.appendLine(line(b, 1, 1, 114))
      return s.blocks()[0].text
    }
    /** Joins "a" + "b" as `buildSentences` would, with `others` as the rest of the document. */
    const joinedIn = (others: string[], a: string, b: string): string => {
      const lines = [a, b, ...others].map((str, i) => line(str, 1, i, 100 + 14 * i))
      const s = new SpokenText({ documentWords: documentWordsIn(lines) })
      s.appendLine(lines[0])
      s.appendLine(lines[1])
      return s.blocks()[0].text
    }

    it('keeps the hyphen after a compound prefix when the right part is a word of the document', () => {
      // The right parts ("concept", "report"...) appear as words elsewhere in the document.
      const words = new Set(['concept', 'report', 'being', 'term', 'directive'])
      expect(joined('a stable self-', 'concept', undefined, words)).toBe('a stable self-concept')
      expect(joined('self-', 'report', undefined, words)).toBe('self-report')
      expect(joined('their Well-', 'being', undefined, words)).toBe('their Well-being')
      expect(joined('a long-', 'term goal', undefined, words)).toBe('a long-term goal')
      expect(joined('a non-', 'directive stance', undefined, words)).toBe('a non-directive stance')
    })

    it('drops the hyphen after a prefix when the right part is no word of the document', () => {
      const doc = ['Plain words fill the rest of this made-up page.']
      expect(joinedIn(doc, 'their ex-', 'perience of it')).toBe('their experience of it')
      expect(joinedIn(doc, 'an inter-', 'est in birds')).toBe('an interest in birds')
      expect(joinedIn(doc, 'a weekly semi-', 'nar on rocks')).toBe('a weekly seminar on rocks')
      expect(joinedIn(doc, 'multi-', 'ple tries')).toBe('multiple tries')
      expect(joinedIn(doc, 'the cross-', 'ing guard')).toBe('the crossing guard')
      expect(joinedIn(doc, 'high-', 'ly rated')).toBe('highly rated')
      expect(joinedIn(doc, 'a low-', 'er shelf')).toBe('a lower shelf')
      expect(joinedIn(doc, 'the mid-', 'dle lane')).toBe('the middle lane')
    })

    it('keeps a prefix compound whose right part the document uses as a word', () => {
      const doc = ['A clear concept helps here.']
      expect(joinedIn(doc, 'a stable self-', 'concept')).toBe('a stable self-concept')
    })

    it('drops the hyphen when the document writes the joined word unhyphenated', () => {
      // "pert" is a word of the document too, but "expert" written whole wins.
      const doc = ['An expert gave a pert reply.']
      expect(joinedIn(doc, 'the ex-', 'pert said')).toBe('the expert said')
      expect(joinedIn(['Her interest grew.', 'An est is odd.'], 'an inter-', 'est')).toBe(
        'an interest'
      )
    })

    it('does not count the halves of a word split by a line break as document words', () => {
      const words = documentWordsIn([line('their ex-', 1, 0), line('perience of Rain', 1, 1, 114)])
      expect([...words].sort()).toEqual(['of', 'rain', 'their'])
      // Split across a page, with a running header line in between.
      const across = documentWordsIn([
        line('a stable self-', 1, 0, 700),
        line('Chapter Three', 2, 0, 40),
        line('concept grows.', 2, 1, 100)
      ])
      expect(across.has('concept')).toBe(false)
      expect(across.has('chapter')).toBe(true)
    })

    it('still drops a hyphen that only splits a word', () => {
      expect(joined('selective atten-', 'tion')).toBe('selective attention')
      expect(joined('behav-', 'ioral change')).toBe('behavioral change')
      // "pre", "re" and "co" are not on the prefix list: they start too many unhyphenated words.
      expect(joined('to pre-', 'vent it')).toBe('to prevent it')
      expect(joined('to re-', 'call it')).toBe('to recall it')
      expect(joined('a co-', 'herent view')).toBe('a coherent view')
    })

    it('keeps the hyphen when the document writes the word with one elsewhere', () => {
      const words = new Set(['decision-making'])
      expect(joined('shared decision-', 'making', words)).toBe('shared decision-making')
      expect(joined('shared Decision-', 'making', words)).toBe('shared Decision-making')
      expect(joined('shared decision-', 'making')).toBe('shared decisionmaking')
    })

    it('maps a kept hyphen to the original hyphen character', () => {
      const s = new SpokenText({ documentWords: new Set(['concept']) })
      s.appendLine(line('a self-', 1, 0))
      s.appendLine(line('concept', 1, 1, 114))
      const [b] = s.blocks()
      expect(b.text).toBe('a self-concept')
      expect(b.map(2, 14)).toEqual([
        { page: 1, itemIndex: 0, start: 2, end: 7 },
        { page: 1, itemIndex: 1, start: 0, end: 7 }
      ])
      expect(b.map(6, 7)).toEqual([{ page: 1, itemIndex: 0, start: 6, end: 7 }])
    })
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
    s.appendLine(line('a dis-', 1, 0))
    const [before] = s.blocks()
    s.appendLine(line('tinct fact', 1, 1, 114))
    s.remove(/dis/)
    expect(before.text).toBe('a dis-')
    expect(before.map(0, 6)).toEqual([{ page: 1, itemIndex: 0, start: 0, end: 6 }])
    expect(s.blocks()[0].text).toBe('a tinct fact')
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

  const sidecars = loadSidecars()

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
