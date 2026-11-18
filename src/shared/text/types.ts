// Shared text-pipeline types. Pure TypeScript: no Electron, DOM or Node imports, so this code runs in
// Vitest, in a Node CLI and in a renderer Web Worker.

/** One non-empty pdf.js text item. Coordinates are PDF points with a top-left origin. */
export interface TextItem {
  /** 1-based page number. */
  page: number
  /** Index of this item in pdf.js `getTextContent().items` (empty items are skipped but still counted). */
  index: number
  /** The item's text exactly as pdf.js gives it (ligatures etc. are NOT normalized here). */
  str: string
  /** Left edge. */
  x: number
  /** Baseline distance from the page TOP (pdf.js transform f -> pageHeight - f). */
  y: number
  width: number
  fontSize: number
}

export interface PageText {
  page: number
  width: number
  height: number
  items: TextItem[]
}

export interface Line {
  page: number
  /** The line's items, left to right (whitespace-only items are not included). */
  items: TextItem[]
  /** Normalized text of the items, joined with a space where they are visibly apart. */
  text: string
  /** Left edge of the leftmost item. */
  x: number
  /** Baseline (top-origin) of the line's dominant font size. */
  y: number
  /** From `x` to the right edge of the rightmost item. */
  width: number
  /** The font size carrying most of the line's characters (a superscript does not change it). */
  fontSize: number
}

/** A [start, end) range of characters in one text item's `str`. */
export interface Span {
  page: number
  itemIndex: number
  start: number
  end: number
}

export interface Sentence {
  id: number
  text: string
  spans: Span[]
}

export interface ReadingFilters {
  skipHeadersFooters: boolean
  skipFootnotes: boolean
  stopAtReferences: boolean
  skipCaptionsTables: boolean
  skipCoverPages: boolean
  readCitations: boolean
}

export const DEFAULT_FILTERS: ReadingFilters = Object.freeze({
  skipHeadersFooters: true,
  skipFootnotes: true,
  stopAtReferences: true,
  skipCaptionsTables: true,
  skipCoverPages: true,
  readCitations: false
})

export const READ_EVERYTHING: ReadingFilters = Object.freeze({
  skipHeadersFooters: false,
  skipFootnotes: false,
  stopAtReferences: false,
  skipCaptionsTables: false,
  skipCoverPages: false,
  readCitations: true
})

/** Bump whenever pipeline output can change, so cached spoken text is never served stale. */
export const PIPELINE_VERSION = 3
