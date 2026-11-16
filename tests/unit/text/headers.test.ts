import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { dropHeadersFooters } from '../../../src/shared/text/filters'
import { buildLines } from '../../../src/shared/text/lines'
import { FIXTURES, linesOf, page, spokenOf, type ItemSpec } from './helpers'

const HEIGHT = 792
const body = (k: number): ItemSpec[] => [
  { str: `Body text of page ${k}.`, x: 72, y: 300 },
  { str: 'More body text.', x: 72, y: 314 }
]

/** Builds `n` synthetic pages; `extra(k)` adds items to page k (1-based). */
function doc(n: number, extra: (k: number) => ItemSpec[]): string[][] {
  const pagesLines = [...Array(n).keys()].map((i) =>
    buildLines(page([...extra(i + 1), ...body(i + 1)], i + 1))
  )
  return dropHeadersFooters(pagesLines, Array(n).fill(HEIGHT)).map((p) => p.map((l) => l.text))
}

const TOP = 40 // < 8% of 792 (63.4)
const BOTTOM = 760 // > 92% of 792 (728.6)

describe('dropHeadersFooters', () => {
  it('drops running header and "Page N" footer on single-column.pdf', async () => {
    const text = await spokenOf('single-column.pdf', { onlyHeadersFooters: true })
    expect(text).not.toMatch(/PSYC 201 — Week 4/)
    expect(text).not.toMatch(/Page \d/)
    // ...and nothing else: the footnote (Task 8) and the title stay.
    expect(text).toMatch(/^Week 4: Attention and Memory /)
    expect(text).toMatch(/selective attention to/)
    expect(text).toMatch(/¹ See Miller \(1956\)\./)
  })

  it('keeps a line that only repeats on 2 of 6 pages', () => {
    // 6 pages -> threshold min(3, ceil(3)) = 3.
    const out = doc(6, (k) => (k <= 2 ? [{ str: 'Draft copy', x: 72, y: TOP }] : []))
    expect(out[0][0]).toBe('Draft copy')
    expect(out[1][0]).toBe('Draft copy')
  })

  it('drops a header repeating on 3 pages even when its digits change', () => {
    const out = doc(6, (k) =>
      k <= 3 ? [{ str: `Chapter ${k + 1}: Memory   ${100 + k}`, x: 72, y: TOP }] : []
    )
    expect(out.flat().some((t) => t.startsWith('Chapter'))).toBe(false)
    expect(out[0]).toEqual(['Body text of page 1.', 'More body text.'])
  })

  it('needs only ceil(half the pages) on short documents', () => {
    // 4 pages -> threshold min(3, 2) = 2.
    const out = doc(4, (k) => (k <= 2 ? [{ str: 'Unit B notes', x: 72, y: BOTTOM }] : []))
    expect(out.flat()).not.toContain('Unit B notes')
  })

  it('keeps a top-zone title on a 1-page document but still drops its page number', () => {
    for (const num of ['Page 1', '3']) {
      const out = doc(1, () => [
        { str: 'One-Page Handout', x: 72, y: TOP },
        { str: num, x: 300, y: BOTTOM }
      ])
      expect(out[0]).toEqual(['One-Page Handout', 'Body text of page 1.', 'More body text.'])
    }
  })

  it('drops a header repeated on both pages of a 2-page document', () => {
    const out = doc(2, () => [{ str: 'Lab Manual', x: 72, y: TOP }])
    expect(out.flat()).not.toContain('Lab Manual')
  })

  it('keeps a top-zone line that appears on only one page of a 2-page document', () => {
    const out = doc(2, (k) => (k === 1 ? [{ str: 'Lab Manual', x: 72, y: TOP }] : []))
    expect(out[0][0]).toBe('Lab Manual')
  })

  it('counts top and bottom zones separately', () => {
    // Twice at the top and once at the bottom of a 6-page document: below the threshold in each zone.
    const out = doc(6, (k) =>
      k <= 2
        ? [{ str: 'Cognition', x: 72, y: TOP }]
        : k === 3
          ? [{ str: 'Cognition', x: 72, y: BOTTOM }]
          : []
    )
    expect(out.flat().filter((t) => t === 'Cognition')).toHaveLength(3)
  })

  it('does not drop repeated lines outside the zones', () => {
    const out = doc(6, () => [{ str: 'Key point', x: 72, y: 200 }])
    expect(out.flat().filter((t) => t === 'Key point')).toHaveLength(6)
  })

  it('drops lone page numbers in a zone even when they do not repeat', () => {
    const labels = ['12', 'Page 3', 'page 4 of 10', 'xiv', 'Page iv']
    const out = doc(6, (k) =>
      k <= labels.length ? [{ str: labels[k - 1], x: 300, y: BOTTOM }] : []
    )
    expect(out.flat().filter((t) => labels.includes(t))).toEqual([])
    const top = doc(6, (k) => (k === 1 ? [{ str: 'iii', x: 300, y: TOP }] : []))
    expect(top[0]).not.toContain('iii')
  })

  it('keeps zone lines that only look like numbers in part', () => {
    const labels = ['Page 3 notes', '12345', 'Chapter 4', 'see page 12']
    const out = doc(6, (k) =>
      k <= labels.length ? [{ str: labels[k - 1], x: 72, y: BOTTOM }] : []
    )
    expect(out.flat().filter((t) => labels.includes(t))).toEqual(labels)
  })

  it('keeps a lone number in the body', () => {
    const out = doc(6, (k) => (k === 1 ? [{ str: '42', x: 300, y: 400 }] : []))
    expect(out[0]).toContain('42')
  })

  it('uses each page’s own height for the zones', () => {
    // y = 90 is inside the top 8% of a 1200pt page but not of a 792pt one.
    const pagesLines = [1, 2, 3].map((k) =>
      buildLines(page([{ str: 'Shared head', x: 72, y: 90 }, ...body(k)], k))
    )
    const tall = dropHeadersFooters(pagesLines, [1200, 1200, 1200])
    expect(tall.flat().map((l) => l.text)).not.toContain('Shared head')
    const normal = dropHeadersFooters(pagesLines, [792, 792, 792])
    expect(normal.flat().filter((l) => l.text === 'Shared head')).toHaveLength(3)
  })

  it('returns the kept Line objects unchanged and in order, without mutating the input', () => {
    const pagesLines = [1, 2, 3].map((k) =>
      buildLines(page([{ str: 'Running head', x: 72, y: TOP }, ...body(k)], k))
    )
    const before = pagesLines.map((p) => [...p])
    const out = dropHeadersFooters(pagesLines, [792, 792, 792])
    expect(pagesLines).toEqual(before)
    out.forEach((p, i) => expect(p).toEqual(pagesLines[i].slice(1)))
    expect(out[0][0]).toBe(pagesLines[0][1])
  })

  it('handles an empty document and pages without lines', () => {
    expect(dropHeadersFooters([], [])).toEqual([])
    expect(dropHeadersFooters([[], []], [792, 792])).toEqual([[], []])
  })

  interface Sidecar {
    fixture: string
    pages: Array<{
      page: number
      lines: string[]
      skipped: Array<{ text: string; reason: string }>
    }>
  }
  const sidecars = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Sidecar)

  describe.each(sidecars.map((s) => [s.fixture, s] as const))('%s', (fixture, sidecar) => {
    it('drops exactly the header, footer and page-number lines the sidecar lists', async () => {
      const { pages, lines } = await linesOf(fixture)
      const kept = dropHeadersFooters(
        lines,
        pages.map((p) => p.height)
      )
      const expected = sidecar.pages.map((p) => {
        const dropped = p.skipped
          .filter((s) => /header|footer|page number/.test(s.reason))
          .map((s) => s.text)
        return p.lines.filter((t) => !dropped.includes(t))
      })
      expect(kept.map((p) => p.map((l) => l.text))).toEqual(expected)
    })
  })
})
