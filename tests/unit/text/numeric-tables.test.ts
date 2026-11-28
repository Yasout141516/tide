import { describe, expect, it } from 'vitest'
import { anchorOf, resolveAnchor } from '../../../src/shared/text/anchor'
import { dropCaptionsAndTables } from '../../../src/shared/text/filters'
import { buildSentences } from '../../../src/shared/text/pipeline'
import { segmentSentences } from '../../../src/shared/text/sentences'
import { READ_EVERYTHING, type Line, type PageText } from '../../../src/shared/text/types'
import { lineOf, page, type ItemSpec } from './helpers'

const BODY = 10.91
const SMALL = 8.8

const prose = (y: number, str: string): ItemSpec => ({ str, x: 72, y, fontSize: BODY, width: 460 })

/** Page 1: single-column prose that ends mid-word ("mar-"). */
function page1(): PageText {
  const lines = [
    'Synthetic respondents described their households in several different ways,',
    'and the survey grouped these answers by the relatives who lived together,',
    'which included grandparents, cousins and neighbours sharing a courtyard.',
    'Older members of the sample sometimes mentioned that they had joined a',
    'family through a second union, and the notes record this as a plural mar-'
  ]
  return page(lines.map((str, i) => prose(100 + i * 13.5, str)))
}

/** A cell item: `w` is its drawn width, so the label-to-number gap is exact. */
const cell = (str: string, x: number, y: number, w: number): ItemSpec => ({
  str,
  x,
  y,
  width: w,
  fontSize: SMALL
})

/**
 * Page 2: a full-width synthetic table at the top. The label-to-number gap is 11 pt (under 2 x 8.8)
 * and the number column jitters by 5 pt (tolerance 4.4 pt), as measured on a real paper. Caption BELOW
 * the table, then body text that completes the hyphenated word.
 */
function page2(): PageText {
  const rows: Array<[string, number, number, string]> = [
    ['Age and political perception of the author', 100, 188, '372'],
    ['Regional origin of respondents', 95, 183, '396'],
    ['Educational background level', 99, 188, '372'],
    ['Mental health history noted', 90, 183, '110'],
    ['Total', 25, 188, '466']
  ]
  const items: ItemSpec[] = [
    cell('Category', 77, 80, 40),
    cell('Kept', 188, 80, 25)
  ]
  rows.forEach(([label, w, x, num], i) => {
    const y = 95 + i * 11
    items.push(cell(label, 77, y, w), cell(num, x, y, 15))
  })
  items.push(cell('Table 1: Synthetic annotation counts by category and source.', 77, 160, 456))
  const body = [
    'riages, and deserted women are counted separately in the later tables of this',
    'synthetic report, because the households they lead differ in size and income.'
  ]
  body.forEach((str, i) => items.push(prose(460 + i * 13.5, str)))
  return page(items, 2)
}

const join = (r: ReturnType<typeof buildSentences>): string =>
  r.sentences.map((s) => s.text).join(' | ')

describe('table text and the page-start join', () => {
  it('joins "mar-" with "riages" and speaks no table text', () => {
    const text = join(buildSentences([page1(), page2()]))
    expect(text).toContain('marriages, and deserted women')
    expect(text).not.toMatch(/Category|Kept|Rejected|\b372\b|\b396\b|\b466\b|Total|Table 1/)
  })

  it('still joins when a leftover small line sits at the top of the page', () => {
    const p2 = page2()
    const stray = { ...p2.items[0], str: '12 15 18 21 24', index: 99, y: 70 }
    p2.items = [stray, ...p2.items.filter((i) => i.fontSize === BODY)]
    const text = join(buildSentences([page1(), p2]))
    expect(text).toContain('marriages, and deserted women')
    expect(text).not.toMatch(/21/)
  })

  it('reads and joins a smaller-font block quote that continues across the page break', () => {
    const quote = (y: number, str: string): ItemSpec => ({
      str,
      x: 90,
      y,
      fontSize: 9.5,
      width: 420
    })
    const p2 = page(
      [
        quote(80, 'riages, and the elders who spoke at the gathering agreed that the custom'),
        quote(92, 'was older than any record the village kept, and it was not questioned.'),
        prose(120, 'The notes that follow describe how the later households were counted.')
      ],
      2
    )
    for (const f of [undefined, READ_EVERYTHING]) {
      const r = f ? buildSentences([page1(), p2], f) : buildSentences([page1(), p2])
      const text = join(r)
      expect(text).toContain('marriages, and the elders who spoke')
      expect(text).toContain('was older than any record the village kept')
    }
  })

  it('reads and joins a short capitalised quote opening at the top of the page', () => {
    const p2 = page(
      [
        { str: 'As Freud put it,', x: 90, y: 80, fontSize: 9.5, width: 80 },
        prose(120, 'riages are rarely what they seem to the observer.')
      ],
      2
    )
    for (const f of [undefined, READ_EVERYTHING]) {
      const r = f ? buildSentences([page1(), p2], f) : buildSentences([page1(), p2])
      const sentence = r.sentences.find((x) => x.text.includes('As Freud put it'))
      expect(sentence?.text).toContain('plural mar')
    }
  })

  it('skips leftover small labels that sit before a line of numbers, not just the numbers', () => {
    const small = (y: number, str: string): ItemSpec => ({ str, x: 77, y, fontSize: 8.8, width: 120 })
    const p2 = page(
      [
        small(70, 'Fleiss kappa Kept'),
        small(80, 'AC1 [95% CI]'),
        small(90, '372 396 372'),
        prose(300, 'riages, and deserted women are counted separately in the later tables.')
      ],
      2
    )
    const text = join(buildSentences([page1(), p2]))
    expect(text).toContain('marriages, and deserted women')
    expect(text).not.toMatch(/Fleiss|AC1|372/)
  })

  it('reads the table again under Read everything', () => {
    const text = join(buildSentences([page1(), page2()], READ_EVERYTHING))
    expect(text).toMatch(/466/)
  })
})

describe('numeric-density rule', () => {
  const row = (y: number, str: string, size = SMALL): Line =>
    lineOf([{ str, x: 72, y, fontSize: size, width: 300 }])
  const kept = (lines: Line[]): string[] =>
    dropCaptionsAndTables([lines], BODY)[0].map((l) => l.text)

  it('drops a run of lines of numbers, brackets and percentages', () => {
    const lines = [
      row(100, '0.654 [0.557, 0.748] 0.821 [0.753, 0.888]'),
      row(112, '0.612 [0.501, 0.700] 0.790 [0.710, 0.870]'),
      row(124, 'Total 466')
    ]
    expect(kept(lines)).toEqual([])
  })

  it('drops numeric rows with a short label', () => {
    const lines = [row(100, 'Mean 12.4 13.1 9.8 (4.2%)'), row(112, 'Median 11 12 9 (3.9%)')]
    expect(kept(lines)).toEqual([])
  })

  it('drops one small-font numeric line', () => {
    expect(kept([row(100, '0.351 0.360 80 89 80')])).toEqual([])
  })

  it('keeps prose that merely mentions numbers', () => {
    const lines = [
      row(100, 'In 1990 about 40% of the 2,000 villages had a school and a clinic.', BODY),
      row(113, 'The 12 teams met in 2004 and 2005 to compare the 3 plans they had.', BODY)
    ]
    expect(kept(lines)).toHaveLength(2)
  })
})

describe('label and column tolerance', () => {
  it('drops a table whose label gap is 11 pt and whose column jitters by 5 pt', () => {
    const r = (y: number, label: string, labelW: number, numX: number): Line =>
      lineOf([
        { str: label, x: 77, y, fontSize: SMALL, width: labelW },
        { str: 'alpha beta gamma', x: numX, y, fontSize: SMALL, width: 70 }
      ])
    const lines = [
      r(100, 'Age and political perception of the author', 100, 188),
      r(111, 'Regional origin of respondents', 95, 183),
      r(122, 'Educational background level', 99, 188),
      r(133, 'Mental health history noted', 90, 183)
    ]
    expect(dropCaptionsAndTables([lines], BODY)[0]).toHaveLength(0)
  })
})

describe('sentence cap', () => {
  const clauses = Array.from(
    { length: 12 },
    (_, i) => `the synthetic respondent number ${i + 1} described the household`
  )
  const long = `${clauses.join(', ')}.`

  it('splits a 600-char sentence into pieces of at most 300 chars that rejoin exactly', () => {
    expect(long.length).toBeGreaterThan(600)
    const ranges = segmentSentences(long)
    expect(ranges.length).toBeGreaterThanOrEqual(3)
    for (const r of ranges) expect(r.end - r.start).toBeLessThanOrEqual(300)
    expect(ranges.map((r) => long.slice(r.start, r.end)).join(' ')).toBe(long)
    // Clause boundaries, not mid-word: every piece but the last ends in a comma.
    for (const r of ranges.slice(0, -1)) expect(long[r.end - 1]).toBe(',')
  })

  it('leaves no tiny tail piece', () => {
    const text = `${'alpha beta gamma delta '.repeat(13).trim()} omega.`
    const ranges = segmentSentences(text)
    for (const r of ranges) expect(r.end - r.start).toBeGreaterThanOrEqual(60)
  })

  it('keeps the tail at 60 chars or more when the cut lands on a space', () => {
    for (let extra = 55; extra <= 65; extra++) {
      const text = `${'a'.repeat(299)} ${'b'.repeat(extra)} c.`
      const ranges = segmentSentences(text)
      for (const r of ranges) expect(r.end - r.start).toBeGreaterThanOrEqual(60)
    }
  })

  it('falls back to word boundaries without punctuation', () => {
    const words = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ')
    const text = `${words}.`
    const ranges = segmentSentences(text)
    for (const r of ranges) expect(r.end - r.start).toBeLessThanOrEqual(300)
    expect(ranges.map((r) => text.slice(r.start, r.end)).join(' ')).toBe(text)
  })

  it('leaves each piece anchored to exactly its own characters', () => {
    const cut = long.lastIndexOf(' ', 330) + 1
    const src = [long.slice(0, cut), long.slice(cut)]
    const items: ItemSpec[] = [prose(100, src[0]), prose(113.5, src[1])]
    const { sentences } = buildSentences([page(items)])
    expect(sentences.length).toBeGreaterThanOrEqual(3)
    for (const s of sentences) {
      expect(s.text.length).toBeLessThanOrEqual(300)
      const fromSpans = s.spans.map((sp) => src[sp.itemIndex].slice(sp.start, sp.end)).join('')
      expect(fromSpans.replace(/\s+/g, '')).toBe(s.text.replace(/\s+/g, ''))
      // The sentence's anchor resolves back to itself (R8: keep your place across a rebuild).
      expect(resolveAnchor(sentences, anchorOf(s))).toBe(s.id)
    }
  })
})
