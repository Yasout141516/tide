import { describe, expect, it } from 'vitest'
import { extractPages } from '../../../src/shared/text/extract'
import { sentenceAt, spanRects, type Rect } from '../../../src/shared/text/highlight'
import { buildSentences } from '../../../src/shared/text/pipeline'
import type { Span, TextItem } from '../../../src/shared/text/types'
import { readFixture } from './helpers'

const FIXTURES = ['single-column', 'two-column', 'captions-tables', 'cover-refs', 'citations']

describe('highlight rects', () => {
  for (const f of FIXTURES)
    it(`every ${f} sentence has rects inside its page on the lines holding its characters`, async () => {
      const pages = await extractPages(readFixture(`${f}.pdf`))
      const item = (p: number, i: number): TextItem | undefined =>
        pages[p - 1].items.find((t) => t.index === i)
      const size = (p: number): { width: number; height: number } => pages[p - 1]
      const { sentences } = buildSentences(pages)
      expect(sentences.length).toBeGreaterThan(0)
      for (const s of sentences) {
        const rects = spanRects(s.spans, item, size)
        expect(rects.length, s.text).toBeGreaterThan(0)
        for (const r of rects) {
          const { width, height } = size(r.page)
          expect(r.x).toBeGreaterThanOrEqual(0)
          expect(r.x + r.w).toBeLessThanOrEqual(width + 1e-6)
          expect(r.y).toBeGreaterThanOrEqual(0)
          expect(r.y + r.h).toBeLessThanOrEqual(height + 1e-6)
        }
        for (const sp of s.spans) {
          const base = item(sp.page, sp.itemIndex)!.y
          expect(
            rects.some((r) => r.page === sp.page && r.y <= base && base <= r.y + r.h),
            s.text
          ).toBe(true)
        }
      }
    })

  const it1: TextItem = {
    page: 1,
    index: 0,
    str: 'abcdefghij',
    x: 100,
    y: 100,
    width: 100,
    fontSize: 10
  }
  const size = (): { width: number; height: number } => ({ width: 612, height: 792 })

  it('maps a span to the documented rectangle', () => {
    const [r] = spanRects([{ page: 1, itemIndex: 0, start: 2, end: 5 }], () => it1, size)
    expect(r).toEqual({ page: 1, x: 120, y: 91.5, w: 30, h: 11 })
  })

  it('merges neighbouring spans on a line but not across lines', () => {
    const lower = { ...it1, index: 1, y: 130 }
    const spans: Span[] = [
      { page: 1, itemIndex: 0, start: 0, end: 5 },
      { page: 1, itemIndex: 0, start: 5, end: 10 },
      { page: 1, itemIndex: 1, start: 0, end: 10 }
    ]
    const rects = spanRects(spans, (_p, i) => (i === 0 ? it1 : lower), size)
    expect(rects).toHaveLength(2)
    expect(rects[0]).toMatchObject({ x: 100, w: 100 })
  })

  it('clamps to the page box', () => {
    const edge = { ...it1, x: 600, y: 2 }
    const [r] = spanRects([{ page: 1, itemIndex: 0, start: 0, end: 10 }], () => edge, size)
    expect(r.x + r.w).toBeLessThanOrEqual(612)
    expect(r.y).toBe(0)
  })
})

describe('sentenceAt', () => {
  const rects: Rect[][] = [
    [{ page: 1, x: 50, y: 50, w: 100, h: 11 }],
    [{ page: 1, x: 50, y: 80, w: 100, h: 11 }]
  ]
  it('finds the sentence under a point and null far from text', () => {
    expect(sentenceAt(rects, 1, 60, 55)).toBe(0)
    expect(sentenceAt(rects, 1, 60, 85)).toBe(1)
    expect(sentenceAt(rects, 1, 60, 68)).toBe(0)
    expect(sentenceAt(rects, 1, 60, 400)).toBeNull()
    expect(sentenceAt(rects, 2, 60, 55)).toBeNull()
  })
})
