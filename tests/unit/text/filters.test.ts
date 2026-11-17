import { describe, expect, it } from 'vitest'
import {
  bodyFontSize,
  coverPages,
  dropCaptionsAndTables,
  dropFootnotes,
  referencesStart
} from '../../../src/shared/text/filters'
import { SpokenText } from '../../../src/shared/text/spoken'
import type { Line } from '../../../src/shared/text/types'
import { lineOf, linesOf } from './helpers'

const spoken = (pages: Line[][]): string => {
  const s = new SpokenText()
  for (const l of pages.flat()) s.appendLine(l)
  return s
    .blocks()
    .map((b) => b.text)
    .join(' ')
}

describe('footnotes', () => {
  it('drops the footnote and its inline marker', async () => {
    const { pages, lines } = await linesOf('single-column.pdf')
    const body = bodyFontSize(lines)
    const out = dropFootnotes(
      lines,
      pages.map((p) => p.height),
      body
    )
    const text = spoken(out)
    expect(text).not.toContain('See Miller')
    expect(text).not.toContain('¹')
    expect(text).toContain(
      'Next week we turn to long-term memory and the ways it can be distorted.'
    )
    // inputs untouched
    expect(lines.flat().some((l) => l.text.includes('¹'))).toBe(true)
  })

  it('cuts only the footnote column, keeping the other column', () => {
    const leftTop = lineOf([{ str: 'Left column body text.', x: 72, y: 600 }])
    const note = lineOf([{ str: '* Corresponding author', x: 72, y: 700, fontSize: 8 }])
    const leftBelow = lineOf([{ str: 'Left lines below it.', x: 72, y: 720 }])
    const right1 = lineOf([{ str: 'Right column body one.', x: 320, y: 710 }])
    const right2 = lineOf([{ str: 'Right column body two.', x: 320, y: 740 }])
    const [out] = dropFootnotes([[leftTop, note, right1, leftBelow, right2]], [792], 10)
    expect(out.map((l) => l.text)).toEqual([
      'Left column body text.',
      'Right column body one.',
      'Right column body two.'
    ])
  })

  it('rebuilds the host line without the marker item', () => {
    const host = lineOf([
      { str: 'Recall', x: 72, y: 100 },
      { str: '¹', x: 102, y: 97, fontSize: 6 },
      { str: 'fades.', x: 108, y: 100 }
    ])
    const [[out]] = dropFootnotes([[host]], [792], 10)
    expect(out.items.map((i) => i.str)).toEqual(['Recall', 'fades.'])
    expect(out.text).not.toContain('¹')
  })
})

describe('captions and tables', () => {
  it('drops figure caption and table text', async () => {
    const { lines } = await linesOf('captions-tables.pdf')
    const text = spoken(dropCaptionsAndTables(lines, bodyFontSize(lines)))
    expect(text).not.toContain('Figure 1.')
    expect(text).not.toContain('Recall by list length')
    expect(text).not.toContain('4.8')
    expect(text).not.toContain('7.2')
    expect(text).not.toContain('8.4 8.0 7.1')
    expect(text).toContain('Longer lists also produced more intrusions')
    expect(text).toContain('As Figure 1 shows')
  })

  it('drops a captionless table', () => {
    const row = (y: number, a: string): Line =>
      lineOf([
        { str: a, x: 72, y },
        { str: '1.5', x: 200, y },
        { str: '2.5', x: 330, y },
        { str: '3.5', x: 460, y }
      ])
    const before = lineOf([{ str: 'Some body text before.', x: 72, y: 80 }])
    const out = dropCaptionsAndTables([[before, row(100, 'a'), row(112, 'b'), row(124, 'c')]], 10)
    expect(out[0].map((l) => l.text)).toEqual(['Some body text before.'])
    // two rows are not a table
    expect(dropCaptionsAndTables([[row(100, 'a'), row(112, 'b')]], 10)[0]).toHaveLength(2)
  })

  it('keeps a wrapped body line that starts with "Table 1 lists"', () => {
    const texts = [
      'The pattern held for every age group we tested and the results were',
      'Table 1 lists the mean number of words recalled in each condition and',
      'shows that longer lists produced lower recall in every group we tested',
      'for the whole sample of students in the study.'
    ]
    const lines = texts.map((t, i) => lineOf([{ str: t, x: 72, y: 100 + 12 * i }]))
    expect(dropCaptionsAndTables([lines], 10)[0]).toHaveLength(4)
  })

  it('drops a small-font caption with its continuation only', () => {
    const body1 = lineOf([{ str: 'Body before the figure.', x: 72, y: 100 }])
    const c1 = lineOf([{ str: 'Figure 3. Caption begins here and', x: 72, y: 112, fontSize: 8 }])
    const c2 = lineOf([{ str: 'continues on a second line', x: 72, y: 122, fontSize: 8 }])
    const body2 = lineOf([{ str: 'Body after the figure.', x: 72, y: 136 }])
    const out = dropCaptionsAndTables([[body1, c1, c2, body2]], 10)
    expect(out[0].map((l) => l.text)).toEqual(['Body before the figure.', 'Body after the figure.'])
  })

  it('drops only a one-line body-size caption ending in a sentence', () => {
    const cap = lineOf([{ str: 'Figure 2: Caption ends here.', x: 72, y: 100 }])
    const next = lineOf([{ str: 'Body text follows directly.', x: 72, y: 112 }])
    expect(dropCaptionsAndTables([[cap, next]], 10)[0].map((l) => l.text)).toEqual([
      'Body text follows directly.'
    ])
  })

  it('keeps body lines that start with a decimal figure or table reference', () => {
    const texts = [
      'The scores rose steadily over the term for every group (see',
      'Figure 6.4). In practice the effect was small for the youngest group and',
      'Table 1.1 shows the mean scores for each condition and every age group',
      'in the sample, with no exceptions at all.'
    ]
    const lines = texts.map((t, i) => lineOf([{ str: t, x: 72, y: 100 + 12 * i }]))
    expect(dropCaptionsAndTables([lines], 10)[0].map((l) => l.text)).toEqual(texts)
  })

  it('drops a decimal-numbered caption', () => {
    const body = lineOf([{ str: 'Body text before the figure.', x: 72, y: 100 }])
    const small = lineOf([
      { str: 'Figure 6.4 Model of the helping process', x: 72, y: 130, fontSize: 8 }
    ])
    const bodySize = lineOf([{ str: 'Table 2.3 Mean Scores by Group', x: 72, y: 160 }])
    const dotted = lineOf([{ str: 'Figure 1.2. Recall by list length.', x: 72, y: 190 }])
    const out = dropCaptionsAndTables([[body, small, bodySize, dotted]], 10)
    expect(out[0].map((l) => l.text)).toEqual(['Body text before the figure.'])
  })

  it('treats a ligature caption as a caption', () => {
    const cap = lineOf([{ str: 'ﬁgure 2. Sizes.', x: 72, y: 100 }])
    expect(dropCaptionsAndTables([[cap]], 10)).toEqual([[]])
  })
})

describe('cover pages and References', () => {
  it('skips the copyright cover page', async () => {
    expect(coverPages((await linesOf('cover-refs.pdf')).lines)).toEqual([1])
  })

  it('does not skip a reprint first page that carries a copyright line', () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ')
    const lines = [lineOf([{ str: '© 2024 Publisher. All rights reserved.', x: 72, y: 60 }])]
    for (let i = 0; i < 8; i++) lines.push(lineOf([{ str: `${words}.`, x: 72, y: 100 + 12 * i }]))
    expect(coverPages([lines])).toEqual([])
  })

  it('stops at the late References heading', async () => {
    const { lines } = await linesOf('cover-refs.pdf')
    expect(referencesStart(lines, bodyFontSize(lines))).toEqual({
      page: 6,
      lineIndex: expect.any(Number)
    })
  })

  it('ignores early references heading', async () => {
    const { lines } = await linesOf('cover-refs.pdf')
    const body = bodyFontSize(lines)
    const early = lines.map((l, i) => (i >= 3 ? [] : l)) // pages 1-3 only, plus empties
    expect(referencesStart(early, body)).toBeNull()
    expect(lines[1].some((l) => /References/.test(l.text))).toBe(true)
    expect(lines[2].some((l) => l.text === 'Notes')).toBe(true)
  })
})
