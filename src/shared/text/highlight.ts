import type { Span, TextItem } from './types'

/** PDF points, top-left origin. */
export interface Rect {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export type ItemLookup = (page: number, itemIndex: number) => TextItem | undefined

const NEAR = 12

interface Boxed extends Rect {
  fontSize: number
}

function mergeInto(out: Boxed[], r: Boxed): void {
  for (const o of out) {
    if (o.page !== r.page) continue
    const overlap = Math.min(o.y + o.h, r.y + r.h) - Math.max(o.y, r.y)
    if (overlap <= 0.5 * Math.min(o.h, r.h)) continue
    const gap = Math.max(o.x, r.x) - Math.min(o.x + o.w, r.x + r.w)
    if (gap >= 0.5 * Math.max(o.fontSize, r.fontSize)) continue
    const x = Math.min(o.x, r.x)
    const y = Math.min(o.y, r.y)
    const right = Math.max(o.x + o.w, r.x + r.w)
    const bottom = Math.max(o.y + o.h, r.y + r.h)
    Object.assign(o, {
      x,
      y,
      w: right - x,
      h: bottom - y,
      fontSize: Math.max(o.fontSize, r.fontSize)
    })
    return
  }
  out.push(r)
}

const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max)

/** Highlight rectangles for a sentence's spans: one per line, clamped to the page. */
export function spanRects(
  spans: Span[],
  item: ItemLookup,
  pageSize: (page: number) => { width: number; height: number }
): Rect[] {
  const out: Boxed[] = []
  for (const s of spans) {
    const it = item(s.page, s.itemIndex)
    if (!it || it.str.length === 0) continue
    const { width, height } = pageSize(s.page)
    const x0 = clamp(it.x + (it.width * s.start) / it.str.length, width)
    const x1 = clamp(it.x + (it.width * s.end) / it.str.length, width)
    const y0 = it.y - 0.85 * it.fontSize
    const y1 = y0 + 1.1 * it.fontSize
    const cy0 = clamp(y0, height)
    const cy1 = clamp(y1, height)
    mergeInto(out, { page: s.page, x: x0, y: cy0, w: x1 - x0, h: cy1 - cy0, fontSize: it.fontSize })
  }
  return out.map(({ page, x, y, w, h }) => ({ page, x, y, w, h }))
}

/** The sentence whose rect holds the point, else the nearest within one line height; else null. */
export function sentenceAt(
  rectsBySentence: Rect[][],
  page: number,
  x: number,
  y: number
): number | null {
  let best: number | null = null
  let bestDist = Infinity
  rectsBySentence.forEach((rects, i) => {
    for (const r of rects) {
      if (r.page !== page) continue
      const dx = Math.max(r.x - x, 0, x - (r.x + r.w))
      const dy = Math.max(r.y - y, 0, y - (r.y + r.h))
      const d = Math.hypot(dx, dy)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
  })
  return bestDist <= NEAR ? best : null
}
