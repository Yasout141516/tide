import { normalizeText } from './normalize'
import type { Line, PageText, TextItem } from './types'

/** Tolerance (points) for "an item touches the gutter" comparisons. */
const EPS = 0.01
/** Two columns need items on both sides of the gutter over this share of the body text's vertical span. */
const MIN_COLUMN_COVERAGE = 0.7
/**
 * Share of the page height at the top and bottom where running headers, footers and page numbers sit
 * (the same zones the header/footer filter uses). Items there do not count towards column detection.
 */
export const EDGE_ZONE = 0.08

/**
 * Groups a page's items into lines in reading order.
 *
 * Items join a line when their baselines differ by less than half the font size (the larger of the
 * line's and the item's, so a small raised footnote marker joins its line). Within a line items run
 * left to right, with a space where the gap exceeds 0.15 x the line's font size.
 *
 * Two-column pages (see `findGutter`) are read as: full-width lines above the left column, the left
 * column top to bottom, full-width lines above the right column, the right column, then any remaining
 * full-width lines (e.g. a centered footer).
 *
 * Whitespace-only items are ignored: pdf.js emits them across column gutters and they carry no text.
 */
export function buildLines(page: PageText): Line[] {
  const items = page.items.filter((i) => i.str.trim() !== '')
  if (items.length === 0) return []
  const rows = groupRows(items)
  const gutter = findGutter(items, page)
  if (gutter === null) return rows.map((r) => lineFromItems(page.page, r))

  const left: Line[] = []
  const right: Line[] = []
  const full: Line[] = []
  for (const row of rows) {
    if (row.some((i) => crosses(i, gutter))) {
      full.push(lineFromItems(page.page, row))
      continue
    }
    const l = row.filter((i) => i.x + i.width <= gutter + EPS)
    const r = row.filter((i) => i.x + i.width > gutter + EPS)
    if (l.length) left.push(lineFromItems(page.page, l))
    if (r.length) right.push(lineFromItems(page.page, r))
  }
  return orderColumns(left, right, full)
}

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

/** Clusters items (any order) into rows of shared baseline, top to bottom. */
function groupRows(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: Array<{ items: TextItem[]; y: number; size: number }> = []
  for (const item of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(item.y - row.y) < 0.5 * Math.max(row.size, item.fontSize)) {
      row.items.push(item)
      // The row's reference baseline follows its largest text, not a superscript that started it.
      if (item.fontSize > row.size) {
        row.size = item.fontSize
        row.y = item.y
      }
    } else rows.push({ items: [item], y: item.y, size: item.fontSize })
  }
  return rows.map((r) => r.items)
}

/** The font size carrying the most characters; ties go to the larger size. */
function dominantSize(items: TextItem[]): number {
  const chars = new Map<number, number>()
  for (const i of items) chars.set(i.fontSize, (chars.get(i.fontSize) ?? 0) + i.str.length)
  let best = items[0].fontSize
  for (const [size, n] of chars) {
    const bestN = chars.get(best)!
    if (n > bestN || (n === bestN && size > best)) best = size
  }
  return best
}

/** Builds one Line (normalized text, geometry, dominant font size) from items of a single row; items may be in any order. */
export function lineFromItems(page: number, rowItems: TextItem[]): Line {
  const items = [...rowItems].sort((a, b) => a.x - b.x)
  const fontSize = dominantSize(items)
  const minGap = 0.15 * fontSize
  let raw = ''
  let prevEnd = -Infinity
  for (const item of items) {
    if (raw && item.x - prevEnd > minGap) raw += ' '
    raw += item.str
    prevEnd = Math.max(prevEnd, item.x + item.width)
  }
  const x = items[0].x
  const right = Math.max(...items.map((i) => i.x + i.width))
  return {
    page,
    items,
    text: normalizeText(raw).trim(),
    x,
    y: items.find((i) => i.fontSize === fontSize)!.y,
    width: right - x,
    fontSize
  }
}

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

function crosses(item: TextItem, x: number): boolean {
  return item.x < x - EPS && item.x + item.width > x + EPS
}

/**
 * Returns the gutter x of a two-column page, or null for a single-column page.
 *
 * Only body text takes part: items in the top and bottom 8% of the page (running headers, footers,
 * page numbers) are ignored. A candidate x in the middle third of the page qualifies when body items
 * lie wholly on both sides of it across >= 70% of the vertical span between the first and last body
 * line that does not cross x, and no item crosses x inside that two-sided region. Lines that cross x
 * outside the region (a title, an abstract or a footnote spanning both columns) neither block the
 * gutter nor dilute the span, so short columns under a full-width block still count. Sides are
 * measured as y-intervals of their items, merging gaps of up to 2.5 lines, so the two columns'
 * baselines need not line up. The gutter is the middle of the widest run of qualifying x.
 */
function findGutter(items: TextItem[], page: PageText): number | null {
  const top = page.height * EDGE_ZONE
  const bottom = page.height * (1 - EDGE_ZONE)
  const body = items.filter((i) => i.y >= top && i.y <= bottom).sort((a, b) => a.y - b.y)
  if (body.length < 2) return null
  const sizes = body.map((i) => i.fontSize).sort((a, b) => a - b)
  const maxGap = 2.5 * sizes[Math.floor(sizes.length / 2)]

  let bestStart = -1
  let bestLen = 0
  let runStart = -1
  const lo = Math.ceil(page.width * 0.33)
  const hi = Math.floor(page.width * 0.67)
  for (let x = lo; x <= hi + 1; x++) {
    const ok = x <= hi && twoSidedShare(body, x, maxGap) >= MIN_COLUMN_COVERAGE
    if (ok && runStart < 0) runStart = x
    if (!ok && runStart >= 0) {
      if (x - runStart > bestLen) {
        bestLen = x - runStart
        bestStart = runStart
      }
      runStart = -1
    }
  }
  return bestLen > 0 ? bestStart + (bestLen - 1) / 2 : null
}

/**
 * Share (0..1) of the vertical span of the y-sorted items not crossing `x` over which items lie on both
 * sides of `x`; 0 if an item crosses `x` inside that two-sided region.
 */
function twoSidedShare(byY: TextItem[], x: number, maxGap: number): number {
  const leftYs: number[] = []
  const rightYs: number[] = []
  const crossYs: number[] = []
  for (const i of byY) {
    if (i.x + i.width <= x + EPS) leftYs.push(i.y)
    else if (i.x >= x - EPS) rightYs.push(i.y)
    else crossYs.push(i.y)
  }
  if (leftYs.length === 0 || rightYs.length === 0) return 0
  const both = intersect(intervals(leftYs, maxGap), intervals(rightYs, maxGap))
  if (both.length === 0) return 0
  const regionTop = both[0][0]
  const regionBottom = both[both.length - 1][1]
  if (crossYs.some((y) => y >= regionTop && y <= regionBottom)) return 0
  const span =
    Math.max(leftYs[leftYs.length - 1], rightYs[rightYs.length - 1]) -
    Math.min(leftYs[0], rightYs[0])
  if (span <= 0) return 0
  return both.reduce((sum, [a, b]) => sum + (b - a), 0) / span
}

type Interval = [number, number]

/** Merges sorted ys into intervals, joining neighbours closer than `maxGap`. */
function intervals(ys: number[], maxGap: number): Interval[] {
  const out: Interval[] = []
  for (const y of ys) {
    const last = out[out.length - 1]
    if (last && y - last[1] <= maxGap) last[1] = y
    else out.push([y, y])
  }
  return out
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0])
    const hi = Math.min(a[i][1], b[j][1])
    if (lo <= hi) out.push([lo, hi])
    if (a[i][1] < b[j][1]) i++
    else j++
  }
  return out
}

function orderColumns(left: Line[], right: Line[], full: Line[]): Line[] {
  const leftTop = left[0]?.y ?? Infinity
  const rightTop = right[0]?.y ?? Infinity
  return [
    ...full.filter((l) => l.y < leftTop),
    ...left,
    ...full.filter((l) => l.y >= leftTop && l.y < rightTop),
    ...right,
    ...full.filter((l) => l.y >= leftTop && l.y >= rightTop)
  ]
}
