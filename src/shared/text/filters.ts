import { EDGE_ZONE, lineFromItems } from './lines'
import type { Line } from './types'

/** "Page 3", "12", "xiv", "Page 4 of 10": a page number on its own. */
const PAGE_NUMBER = /^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s+of\s+\d{1,4})?$/i

type Zone = 'top' | 'bottom'

/** The digit-insensitive key that identifies a running header or footer across pages. */
const headerKey = (text: string): string =>
  text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()

function zoneOf(line: Line, pageHeight: number): Zone | null {
  if (line.y < pageHeight * EDGE_ZONE) return 'top'
  if (line.y > pageHeight * (1 - EDGE_ZONE)) return 'bottom'
  return null
}

/**
 * Drops running headers, footers and page numbers.
 *
 * Only lines in the top or bottom 8% of their page (by baseline) are candidates. A candidate goes if
 * its digit-normalized key appears in the same zone on at least max(2, min(3, ceil(pageCount / 2)))
 * pages, or if it is a page number on its own (see `PAGE_NUMBER`, any page count). Kept lines are
 * returned as-is, in order.
 *
 * @param pagesLines the lines of every page, in page order
 * @param pageHeights the height of each page, same order
 */
export function dropHeadersFooters(pagesLines: Line[][], pageHeights: number[]): Line[][] {
  // Floor of 2: a line seen on one page only never repeated, so it is not a running header.
  const threshold = Math.max(2, Math.min(3, Math.ceil(0.5 * pagesLines.length)))
  const zones = pagesLines.map((lines, p) => lines.map((l) => zoneOf(l, pageHeights[p])))

  // Number of pages on which each key appears, per zone.
  const pagesWith = new Map<string, number>()
  pagesLines.forEach((lines, p) => {
    const seen = new Set<string>()
    lines.forEach((l, i) => {
      const zone = zones[p][i]
      if (zone) seen.add(`${zone}\u0000${headerKey(l.text)}`)
    })
    for (const k of seen) pagesWith.set(k, (pagesWith.get(k) ?? 0) + 1)
  })

  return pagesLines.map((lines, p) =>
    lines.filter((l, i) => {
      const zone = zones[p][i]
      if (!zone) return true
      if (PAGE_NUMBER.test(l.text.trim())) return false
      return (pagesWith.get(`${zone}\u0000${headerKey(l.text)}`) ?? 0) < threshold
    })
  )
}

// ---------------------------------------------------------------------------------------------
// Body size, footnotes, captions and tables, cover pages, References
// ---------------------------------------------------------------------------------------------

/** The median item font size across all pages, weighted by `str.length`. 0 when there is no text. */
export function bodyFontSize(pagesLines: Line[][]): number {
  const chars = new Map<number, number>()
  for (const lines of pagesLines)
    for (const l of lines)
      for (const i of l.items) chars.set(i.fontSize, (chars.get(i.fontSize) ?? 0) + i.str.length)
  const sizes = [...chars.entries()].sort((a, b) => a[0] - b[0])
  const total = sizes.reduce((s, [, n]) => s + n, 0)
  let seen = 0
  for (const [size, n] of sizes) {
    seen += n
    if (seen * 2 >= total) return size
  }
  return 0
}

const FOOTNOTE_START = /^[\d*†¹²³⁴⁵⁶⁷⁸⁹⁰]/
const MARKER = /^[\d¹²³⁴⁵⁶⁷⁸⁹⁰*†]{1,3}$/

/**
 * Drops footnotes: in the bottom 35% of a page, the first line smaller than 0.85 x body that starts
 * with a digit, `*`, `†` or a superscript digit goes, with every line at or below it in the same column (x-ranges overlap). Separately,
 * inline markers (items under 0.75 x body matching `MARKER`, raised at least 0.2 x body above their
 * line's baseline) are removed and their line is rebuilt from the remaining items.
 */
export function dropFootnotes(pages: Line[][], heights: number[], body: number): Line[][] {
  return pages.map((lines, p) => {
    const cutoff = heights[p] * 0.65
    const start = lines.find(
      (l) => l.y > cutoff && l.fontSize < 0.85 * body && FOOTNOTE_START.test(l.text)
    )
    // Same column only: a line is cut when it sits at or below the footnote and overlaps its x-range
    // (full-width lines overlap every column). Lines in the other column stay.
    const inFootnote = (l: Line): boolean =>
      !!start && l.y >= start.y && l.x < start.x + start.width && l.x + l.width > start.x
    const kept = start ? lines.filter((l) => !inFootnote(l)) : lines
    const out: Line[] = []
    for (const l of kept) {
      const items = l.items.filter(
        (i) => !(i.fontSize < 0.75 * body && MARKER.test(i.str.trim()) && i.y <= l.y - 0.2 * body)
      )
      if (items.length === l.items.length) out.push(l)
      else if (items.length > 0) out.push(lineFromItems(l.page, items))
    }
    return out
  })
}

const CAPTION_LOOSE = /^(figure|fig\.|table|exhibit|chart)\s*\d+[.:]?/i
/** "Figure 2." / "Table 1.1:" - the whole (possibly decimal) number, then "." or ":" and a space. */
const CAPTION_STRICT = /^(figure|fig\.|table|exhibit|chart)\s*\d+(?:\.\d+)*[.:](?=\s|$)/i
const CAPTION_NUMBER_ONLY = /^(figure|fig\.|table|exhibit|chart)\s*\d+\s*$/i
/** "Figure 6.4 " - a decimal number then a space; a caption only when a capital letter follows. */
const CAPTION_DECIMAL = /^(figure|fig\.|table|exhibit|chart)\s*\d+\.\d+\s+/i
const SENTENCE_END = /[.!?]["')\]]*$/

/**
 * Punctuation after the number is required, unless the number is alone on the line, the line is
 * smaller than body text, or a decimal number is followed by a capitalised title ("Table 1.1 Mean
 * Scores"): a wrapped body line starting "Table 1 lists the mean...", "Table 1.1 shows..." or
 * "Figure 6.4). In..." is not a caption. (The capital is checked case-sensitively, outside the
 * case-insensitive regex.)
 */
function isCaption(l: Line, body: number): boolean {
  const decimal = CAPTION_DECIMAL.exec(l.text)
  return (
    CAPTION_STRICT.test(l.text) ||
    CAPTION_NUMBER_ONLY.test(l.text) ||
    (decimal !== null && /^[A-Z]/.test(l.text.slice(decimal[0].length))) ||
    (CAPTION_LOOSE.test(l.text) && l.fontSize < body)
  )
}

/** The median baseline distance between consecutive lines of a page (1.2 x body below 2 lines). */
export function lineHeight(lines: Line[], body: number): number {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].y - lines[i - 1].y
    if (g > 0) gaps.push(g)
  }
  if (lines.length < 2 || gaps.length === 0) return 1.2 * body
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/** A line of >= 3 cells (items split by x-gaps > 2 x fontSize), each of at most 4 words. */
function isTableRow(l: Line): boolean {
  const cells: string[] = []
  let prevEnd = -Infinity
  for (const i of l.items) {
    if (cells.length && i.x - prevEnd <= 2 * l.fontSize) cells[cells.length - 1] += ` ${i.str}`
    else cells.push(i.str)
    prevEnd = Math.max(prevEnd, i.x + i.width)
  }
  return cells.length >= 3 && cells.every((c) => c.trim().split(/\s+/).length <= 4)
}

/**
 * Drops figure/table captions (a line matching `CAPTION`, plus following lines of the same font size
 * until a gap over 1.5 x line height or a size change) and tables (runs of >= 3 consecutive
 * `isTableRow` lines).
 */
export function dropCaptionsAndTables(pages: Line[][], body: number): Line[][] {
  return pages.map((lines) => {
    const drop = new Set<number>()
    const lh = lineHeight(lines, body)
    for (let i = 0; i < lines.length; i++) {
      if (!isCaption(lines[i], body)) continue
      drop.add(i)
      // A body-size caption is one sentence: continuation stops at the first sentence end.
      const bodySize = lines[i].fontSize >= body - 0.5
      if (bodySize && SENTENCE_END.test(lines[i].text)) continue
      for (let j = i + 1; j < lines.length; j++) {
        const gap = lines[j].y - lines[j - 1].y
        if (Math.abs(lines[j].fontSize - lines[i].fontSize) > 0.5 || gap < 0 || gap > 1.5 * lh)
          break
        drop.add(j)
        if (bodySize && SENTENCE_END.test(lines[j].text)) break
      }
    }
    for (let i = 0; i < lines.length;) {
      let j = i
      while (j < lines.length && isTableRow(lines[j])) j++
      if (j - i >= 3) for (let k = i; k < j; k++) drop.add(k)
      i = Math.max(j, i + 1)
    }
    return lines.filter((_, i) => !drop.has(i))
  })
}

const STRONG_MARKERS = /©|copyright|all rights reserved|isbn/i
/** Phrases that also occur in running prose ("this course pack ..."), so they count only on a short line. */
const WEAK_MARKERS = /course\s*pack|reproduced (with|by) permission/i
const WEAK_MARKER_MAX_WORDS = 8
/** A reprinted article's first page carries a (c) line too; only short pages are copyright pages. */
const STRONG_MARKER_MAX_WORDS = 150

/** The 1-based pages among the first three that are cover/copyright pages and should be skipped. */
export function coverPages(pages: Line[][]): number[] {
  const out: number[] = []
  pages.slice(0, 3).forEach((lines, p) => {
    const text = lines.map((l) => l.text).join(' ')
    const words = text.split(/\s+/).filter(Boolean).length
    const sentences = (text.match(/[.!?](?=\s|$)/g) ?? []).length
    const marked =
      (STRONG_MARKERS.test(text) && words < STRONG_MARKER_MAX_WORDS) ||
      lines.some(
        (l) => WEAK_MARKERS.test(l.text) && l.text.split(/\s+/).length <= WEAK_MARKER_MAX_WORDS
      )
    if (marked || (words < 60 && sentences <= 2)) out.push(p + 1)
  })
  return out
}

const REFERENCES_HEADING = /^(references|bibliography|works cited|reference list|notes|endnotes)$/i

/**
 * The first References-style heading in the last 40% of the document: standalone (no trailing page
 * number or dot leaders, which marks a table-of-contents entry) and at least body-sized.
 */
export function referencesStart(
  pages: Line[][],
  body: number
): { page: number; lineIndex: number } | null {
  for (let p = 0; p < pages.length; p++) {
    if (p / pages.length < 0.6) continue
    for (let i = 0; i < pages[p].length; i++) {
      const l = pages[p][i]
      if (l.fontSize < body || /\d\s*$/.test(l.text)) continue
      if (REFERENCES_HEADING.test(l.text.replace(/[.\s]*\d*$/, '')))
        return { page: p + 1, lineIndex: i }
    }
  }
  return null
}
