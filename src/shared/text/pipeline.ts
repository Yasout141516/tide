import { removeCitations } from './citations'
import {
  bodyFontSize,
  coverPages,
  dropCaptionsAndTables,
  dropFootnotes,
  dropHeadersFooters,
  lineHeight,
  referencesStart,
  resourceSections
} from './filters'
import { buildLines } from './lines'
import { segmentSentences } from './sentences'
import { documentWordsIn, hyphenatedWordsIn, SpokenText } from './spoken'
import {
  DEFAULT_FILTERS,
  type Line,
  type PageText,
  type ReadingFilters,
  type Sentence
} from './types'

/** A line this much larger than body text is a heading: it is a block of its own. */
const HEADING_RATIO = 1.15
/** A baseline gap this many line heights wide starts a new block (a paragraph or section break). */
const GAP_RATIO = 1.4

export interface BuildResult {
  /** The sentences to speak, in reading order; `id` is the 0-based position. */
  sentences: Sentence[]
  /** 1-based pages with no text at all (e.g. a scanned page with no text layer). */
  textlessPages: number[]
  /**
   * 1-based pages the cover-page and References rules skipped, in page order, so the reader can offer
   * "Read everything". A cover page is skipped whole. A References page is skipped from the
   * References heading on: the heading's own page may still have body text spoken above the heading.
   * Pages with no text are listed only in `textlessPages`.
   */
  skippedPages: SkippedPage[]
}

export interface SkippedPage {
  page: number
  reason: 'cover' | 'references' | 'resources'
}

/**
 * The whole text pipeline: PDF pages in, sentences to speak (each mapped back to its text items) out.
 *
 * Steps, each filter only when its `filters` flag is on: lines -> cover pages (not applied when every
 * page with text would go) -> running headers and footers -> footnotes -> captions and tables -> cut
 * at References -> spoken text with hard breaks ->
 * citations (off when `readCitations`) -> sentences.
 *
 * Hard breaks (no sentence ever spans one) go before and after a heading (a line over 1.15 x body
 * size; consecutive lines of the same heading size, no further apart than their size warrants, are one
 * heading) and between two lines of a page whose baselines are more than 1.4 x that page's line height
 * apart. Page boundaries are not breaks: a sentence may run on to the next page. (The brief's "break
 * after a short unpunctuated line followed by such a gap" rule is already covered by the gap break.)
 */
export function buildSentences(
  pages: PageText[],
  filters: ReadingFilters = DEFAULT_FILTERS
): BuildResult {
  const textlessPages = pages.filter((p) => !p.items.some((i) => i.str.trim())).map((p) => p.page)
  const heights = pages.map((p) => p.height)

  const skippedPages: SkippedPage[] = []
  const allLines = pages.map(buildLines)
  let lines = allLines
  const body = bodyFontSize(lines)
  if (filters.skipCoverPages) {
    const cover = new Set(coverPages(lines).filter((p) => lines[p - 1].length > 0))
    // A short handout (1-3 short pages) can look like cover pages from start to end: skipping them
    // all would leave nothing to read, so then the rule is not applied.
    const allCover = lines.every((l, p) => l.length === 0 || cover.has(p + 1))
    if (!allCover) {
      for (const page of cover) skippedPages.push({ page, reason: 'cover' })
      lines = lines.map((l, p) => (cover.has(p + 1) ? [] : l))
    }
  }
  if (filters.skipHeadersFooters) lines = dropHeadersFooters(lines, heights)
  if (filters.skipFootnotes) lines = dropFootnotes(lines, heights, body)
  if (filters.skipCaptionsTables) lines = dropCaptionsAndTables(lines, body)
  if (filters.stopAtReferences) {
    const refs = referencesStart(lines, body)
    if (refs) {
      lines.forEach((l, p) => {
        if (p + 1 >= refs.page && l.length > 0)
          skippedPages.push({ page: p + 1, reason: 'references' })
      })
      lines = lines.map((l, p) =>
        p + 1 < refs.page ? l : p + 1 === refs.page ? l.slice(0, refs.lineIndex) : []
      )
    }
    // Suggested readings / Websites sections go with the References setting. Pages are listed once
    // per section they lose lines on, so a page may carry both reasons.
    const dropped = lines.map(() => new Set<number>())
    for (const sec of resourceSections(lines, body)) {
      for (let p = sec.page - 1; p <= sec.endPage - 1; p++) {
        const from = p === sec.page - 1 ? sec.lineIndex : 0
        const to = p === sec.endPage - 1 ? sec.endLine : lines[p].length
        if (to <= from) continue
        skippedPages.push({ page: p + 1, reason: 'resources' })
        for (let k = from; k < to; k++) dropped[p].add(k)
      }
    }
    lines = lines.map((l, p) => (dropped[p].size ? l.filter((_, k) => !dropped[p].has(k)) : l))
    skippedPages.sort((a, b) => a.page - b.page)
  }

  // A compound split by a line break keeps its hyphen if the document writes it whole anywhere, or
  // starts with a compound prefix and its right part is a word of the document (see keepsHyphen).
  const docLines = allLines.flat()
  const spoken = new SpokenText({
    hyphenatedWords: hyphenatedWordsIn(docLines),
    documentWords: documentWordsIn(docLines)
  })
  for (const pageLines of lines) appendPage(spoken, pageLines, body)
  if (!filters.readCitations) removeCitations(spoken)

  const sentences: Sentence[] = []
  for (const block of spoken.blocks())
    for (const { start, end } of segmentSentences(block.text))
      sentences.push({
        id: sentences.length,
        text: block.text.slice(start, end),
        spans: block.map(start, end)
      })
  return { sentences, textlessPages, skippedPages }
}

/** Appends one page's lines, with hard breaks at headings and at large vertical gaps. */
function appendPage(spoken: SpokenText, lines: Line[], body: number): void {
  const lh = lineHeight(lines, body)
  const heading = (l: Line): boolean => l.fontSize > HEADING_RATIO * body
  const breakBefore = (prev: Line | undefined, l: Line): boolean => {
    if (!prev) return heading(l)
    const gap = l.y - prev.y
    // A heading wrapped over two lines is one block: same size, and the gap scaled to its font size.
    if (heading(prev) && heading(l) && Math.abs(prev.fontSize - l.fontSize) <= 0.5)
      return gap < 0 || gap > GAP_RATIO * lh * (l.fontSize / body)
    return heading(prev) || heading(l) || gap > GAP_RATIO * lh
  }
  lines.forEach((l, i) => {
    if (breakBefore(lines[i - 1], l)) spoken.hardBreak()
    spoken.appendLine(l)
  })
  // A heading at the bottom of a page must not run into the next page's first line.
  if (lines.length && heading(lines[lines.length - 1])) spoken.hardBreak()
}

/**
 * Renders sentences one per line (each line ends in "\n"), with a `--- page N ---` line before every
 * sentence whose first span is on a different page from the previous sentence's. The format of the
 * golden snapshots and of `npm run spoken-text`.
 */
export function renderSentences(sentences: Sentence[]): string {
  let out = ''
  let page: number | undefined
  for (const s of sentences) {
    const p = s.spans[0]?.page
    if (p !== undefined && p !== page) {
      out += `--- page ${p} ---\n`
      page = p
    }
    out += `${s.text}\n`
  }
  return out
}
