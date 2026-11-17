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
  return s.blocks().map((b) => b.text).join(' ')
}

describe('footnotes', () => {
  it('drops the footnote and its inline marker', async () => {
    const { pages, lines } = await linesOf('single-column.pdf')
    const body = bodyFontSize(lines)
    const out = dropFootnotes(lines, pages.map((p) => p.height), body)
    const text = spoken(out)
    expect(text).not.toContain('See Miller')
    expect(text).not.toContain('¹')
    expect(text.length).toBeGreaterThan(200)
    // inputs untouched
    expect(lines.flat().some((l) => l.text.includes('¹'))).toBe(true)
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
    expect(text.length).toBeGreaterThan(100)
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
