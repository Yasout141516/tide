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

const WORD_WITH_LETTER = /\p{L}/u
/** A footnote start needs at least this many words containing letters (axis labels like "0 10 20" are out). */
const MIN_FOOTNOTE_WORDS = 2

/**
 * Drops footnotes: in the bottom 35% of a page, a line smaller than 0.85 x body that starts with a
 * digit, `*`, `†` or a superscript digit, has at least 2 words containing letters, and has no line of
 * 0.85 x body or more below it in the same column starts a footnote. Every such line cuts its own
 * column: it goes with every line at or below it whose x-range overlaps its own (full-width lines
 * overlap every column; lines in the other column stay unless they start a footnote of their own).
 * Separately, inline markers (items under 0.75 x body matching `MARKER`, raised at least 0.2 x body
 * above their line's baseline) are removed and their line is rebuilt from the remaining items.
 */
export function dropFootnotes(pages: Line[][], heights: number[], body: number): Line[][] {
  return pages.map((lines, p) => {
    const cutoff = heights[p] * 0.65
    const sameColumn = (a: Line, b: Line): boolean => a.x < b.x + b.width && a.x + a.width > b.x
    const starts = lines.filter(
      (l) =>
        l.y > cutoff &&
        l.fontSize < 0.85 * body &&
        FOOTNOTE_START.test(l.text) &&
        l.text.split(/\s+/).filter((w) => WORD_WITH_LETTER.test(w)).length >= MIN_FOOTNOTE_WORDS &&
        !lines.some((o) => o.y > l.y && o.fontSize >= 0.85 * body && sameColumn(o, l))
    )
    const inFootnote = (l: Line): boolean => starts.some((s) => l.y >= s.y && sameColumn(l, s))
    const kept = starts.length ? lines.filter((l) => !inFootnote(l)) : lines
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

const LIST_MARKER = /^(\d{1,2}[.)]|[•●▪◦–-]|[a-z][.)])$/

interface Cell {
  x: number
  text: string
}

/** The cells of a line: items split by x-gaps over 2 x fontSize. */
function cellsOf(l: Line): Cell[] {
  const cells: Cell[] = []
  let prevEnd = -Infinity
  for (const i of l.items) {
    if (cells.length && i.x - prevEnd <= 2 * l.fontSize) cells[cells.length - 1].text += ` ${i.str}`
    else cells.push({ x: i.x, text: i.str })
    prevEnd = Math.max(prevEnd, i.x + i.width)
  }
  return cells
}

/** A grid row has at least 2 cells and its first cell is not a list marker. */
function gridCells(l: Line): Cell[] | null {
  const cells = cellsOf(l)
  return cells.length >= 2 && !LIST_MARKER.test(cells[0].text.trim()) ? cells : null
}

/**
 * Drop indices of aligned tables: a run of at least 3 grid rows, each with at least 2 cell left edges
 * (within 0.5 x fontSize) at distinct left edges of the run's first grid row, whatever the words per
 * cell. The run may include up to 2 consecutive single-cell rows that start at one of those edges.
 */
function alignedTableRows(lines: Line[]): Set<number> {
  const drop = new Set<number>()
  const rows = lines.map(gridCells)
  const sharesColumns = (cells: Cell[], anchor: Cell[], tol: number): boolean =>
    new Set(
      cells.flatMap((c) => {
        const k = anchor.findIndex((a) => Math.abs(a.x - c.x) <= tol)
        return k < 0 ? [] : [k]
      })
    ).size >= 2
  for (let i = 0; i < lines.length; ) {
    const anchor = rows[i]
    if (!anchor) {
      i++
      continue
    }
    const tol = 0.5 * lines[i].fontSize
    let grid = 1
    let end = i + 1 // exclusive end of the run, trimmed to its last grid row
    let wrapped = 0
    for (let j = i + 1; j < lines.length; j++) {
      const cells = rows[j]
      if (cells && sharesColumns(cells, anchor, tol)) {
        grid++
        end = j + 1
        wrapped = 0
      } else if (
        !cells &&
        wrapped < 2 &&
        cellsOf(lines[j]).length === 1 &&
        anchor.some((a) => Math.abs(a.x - lines[j].x) <= tol)
      ) {
        wrapped++
      } else break
    }
    if (grid >= 3) for (let k = i; k < end; k++) drop.add(k)
    i = Math.max(end, i + 1)
  }
  return drop
}

/**
 * Drops figure/table captions (a line matching `CAPTION`, plus following lines of the same font size
 * until a gap over 1.5 x line height or a size change) and tables (runs of >= 3 consecutive
 * `isTableRow` lines, and aligned multi-word tables, see `alignedTableRows`).
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
    for (const k of alignedTableRows(lines)) drop.add(k)
    return lines.filter((_, i) => !drop.has(i))
  })
}

const STRONG_MARKERS = /©|copyright|all rights reserved|isbn/i
/** Phrases that also occur in running prose ("this course pack ..."), so they count only on a short line. */
const WEAK_MARKERS = /course\s*pack|reproduced (with|by) permission/i
const WEAK_MARKER_MAX_WORDS = 8
/** A reprinted article's first page carries a (c) line too; only short pages are copyright pages. */
const STRONG_MARKER_MAX_WORDS = 150

/** An unmarked page is sparse only below this share of the document's median page word count. */
const SPARSE_SHARE_OF_MEDIAN = 0.25

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length
const pageText = (lines: Line[]): string => lines.map((l) => l.text).join(' ')

/** The median word count of the pages that have any words (0 when none has). */
function medianWords(pages: Line[][]): number {
  const counts = pages
    .map((lines) => wordCount(pageText(lines)))
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  if (counts.length === 0) return 0
  const mid = counts.length >> 1
  return counts.length % 2 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2
}

/**
 * The 1-based pages among the first three that are cover/copyright pages and should be skipped: a
 * page with a copyright marker (see `STRONG_MARKERS`, `WEAK_MARKERS`), or an unmarked sparse page -
 * under 60 words, at most 2 sentences, AND under 25% of the median word count of all the document's
 * non-empty pages (so a deck of short slides keeps its first slides).
 */
export function coverPages(pages: Line[][]): number[] {
  const out: number[] = []
  const median = medianWords(pages)
  pages.slice(0, 3).forEach((lines, p) => {
    const text = pageText(lines)
    const words = wordCount(text)
    const sentences = (text.match(/[.!?](?=\s|$)/g) ?? []).length
    const marked =
      (STRONG_MARKERS.test(text) && words < STRONG_MARKER_MAX_WORDS) ||
      lines.some(
        (l) => WEAK_MARKERS.test(l.text) && l.text.split(/\s+/).length <= WEAK_MARKER_MAX_WORDS
      )
    const sparse = words < 60 && sentences <= 2 && words < SPARSE_SHARE_OF_MEDIAN * median
    if (marked || sparse) out.push(p + 1)
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

const RESOURCE_HEADING =
  /^(?:(?:suggested|further|recommended|additional|selected|key)\s+(?:readings?|resources|websites|viewing)|(?:useful\s+|relevant\s+)?(?:websites|web\s+sites|web\s+links)|(?:audio-?visual|online|internet|web)\s+(?:resources|materials))$/i

/** A line this much larger than body text is a heading (same ratio as the pipeline's block breaks). */
const SECTION_HEADING_RATIO = 1.15

export interface ResourceSection {
  /** 1-based page and index of the heading line the section starts at. */
  page: number
  lineIndex: number
  /** 1-based page and line index just past the section: the next heading, or the end of the document. */
  endPage: number
  endLine: number
}

/**
 * End-of-chapter resource lists ("Suggested readings", "Websites"...). A section starts at a
 * standalone line of at least body size matching `RESOURCE_HEADING` on a page with
 * (page - 1) / pageCount >= 0.6, and ends just before the next heading (over 1.15 x body) that does
 * not itself match, or at the end of the document. Lines from the start up to, not including, the end
 * position are the section.
 */
export function resourceSections(pages: Line[][], body: number): ResourceSection[] {
  const out: ResourceSection[] = []
  const isHeading = (l: Line): boolean => l.fontSize > SECTION_HEADING_RATIO * body
  const matches = (l: Line): boolean => RESOURCE_HEADING.test(l.text.trim())
  let p = 0
  let i = 0
  while (p < pages.length) {
    if (i >= pages[p].length) {
      p++
      i = 0
      continue
    }
    const l = pages[p][i]
    if (p / pages.length < 0.6 || l.fontSize < body || !matches(l)) {
      i++
      continue
    }
    // Scan forward for the section's end.
    let ep = p
    let ei = i + 1
    for (;;) {
      if (ei >= pages[ep].length) {
        if (ep + 1 >= pages.length) break
        ep++
        ei = 0
        continue
      }
      const e = pages[ep][ei]
      if (isHeading(e) && !matches(e)) break
      ei++
    }
    out.push({ page: p + 1, lineIndex: i, endPage: ep + 1, endLine: ei })
    p = ep
    i = ei
  }
  return out
}
