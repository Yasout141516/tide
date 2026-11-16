import { normalizeText } from './normalize'
import type { Line, Span } from './types'

/**
 * A run of spoken text and where it came from.
 *
 * - `src: null` - text the builder inserted (the space joining two lines or two items); it never maps
 *   to a span.
 * - `linear: true` - character k of `text` is character `src.start + k` of the item's `str`
 *   (`text.length === src.end - src.start`).
 * - `linear: false` - the text does not line up character by character with its source (a ligature
 *   "ﬁ" spoken as "fi", or a character with a removed soft hyphen after it), so every part of `text`
 *   maps to the whole of `src`.
 */
interface Segment {
  text: string
  src: Span | null
  linear: boolean
}

export interface SpokenBlock {
  /** Normalized text to speak; never starts or ends with whitespace. */
  text: string
  /**
   * Converts a [start, end) range of `text` into the original text-item ranges it came from, in
   * reading order, merging touching ranges of the same item. Inserted spaces map to nothing.
   */
  map: (start: number, end: number) => Span[]
}

/**
 * Builds the text to speak from lines, remembering for every character which text item (and which
 * characters of its `str`) it came from, so a sentence can later be highlighted on the page.
 *
 * The text equals the lines' normalized `Line.text`, joined with single spaces (or de-hyphenated),
 * while spans always point into the ORIGINAL `item.str`.
 */
export class SpokenText {
  private readonly done: Segment[][] = []
  private current: Segment[] = []

  /**
   * Appends a line to the current block, joined with a space - or, when the block ends with a letter
   * + "-" and the line starts with a lowercase letter, with the hyphen dropped and no space.
   */
  appendLine(line: Line): void {
    const segs = lineSegments(line)
    if (segs.length === 0) return
    if (this.current.length > 0) {
      const tail = lastChars(this.current, 2)
      if (/[A-Za-z]-$/.test(tail) && /^[a-z]/.test(segs[0].text)) dropLastChar(this.current)
      else if (!/\s$/.test(tail)) this.current.push({ text: ' ', src: null, linear: false })
    }
    for (const s of segs) this.current.push(s)
  }

  /** Ends the current block: text after this never joins (or de-hyphenates with) text before it. */
  hardBreak(): void {
    if (this.current.length === 0) return
    this.done.push(this.current)
    this.current = []
  }

  /**
   * Deletes every match of `regex` (the g flag is implied) from the text added so far, block by
   * block. Only the matched characters go; the regex decides whether surrounding spaces go too.
   */
  remove(regex: RegExp): void {
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g'
    const re = new RegExp(regex.source, flags)
    const edit = (segs: Segment[]): Segment[] => {
      const text = segs.map((s) => s.text).join('')
      const cuts: Array<[number, number]> = []
      for (const m of text.matchAll(re))
        if (m[0].length > 0) cuts.push([m.index, m.index + m[0].length])
      return cuts.length ? cut(segs, cuts) : segs
    }
    for (let i = 0; i < this.done.length; i++) this.done[i] = edit(this.done[i])
    this.current = edit(this.current)
  }

  /** The blocks between hard breaks, trimmed, with empty blocks left out. */
  blocks(): SpokenBlock[] {
    const out: SpokenBlock[] = []
    for (const segs of [...this.done, this.current]) {
      const raw = segs.map((s) => s.text).join('')
      const start = raw.length - raw.trimStart().length
      const end = raw.trimEnd().length
      if (end <= start) continue
      out.push({ text: raw.slice(start, end), map: mapper(slice(segs, start, end)) })
    }
    return out
  }
}

// ---------------------------------------------------------------------------------------------
// Building segments from a line
// ---------------------------------------------------------------------------------------------

/**
 * Segments for one line whose text is exactly `line.text`.
 *
 * Each original character of each item is normalized on its own (`normalizeText` works character by
 * character apart from collapsing runs of spaces) and the results are aligned with `line.text`:
 * - a piece that matches the text at the cursor is emitted with that one character as its source;
 * - a space in the text where the items have none is the space `buildLines` inserts between items
 *   that are visibly apart (src null);
 * - whitespace in the items where the text has none was collapsed or trimmed away;
 * - a character that normalizes to nothing (soft hyphen), or a collapsed space, between two spoken
 *   characters of the same item is absorbed into the segment before it, so a highlight does not skip
 *   over it. Skipped characters at an item's edges are left out.
 * If the items and the text ever disagree otherwise (a line whose text was edited), the rest of the
 * text is kept with no source: it is still spoken, it just cannot be highlighted.
 */
function lineSegments(line: Line): Segment[] {
  const text = line.text
  const segs: Segment[] = []
  let t = 0
  let ok = true
  outer: for (const item of line.items) {
    let prev: Segment | null = null // the item's last emitted segment
    let skippedTo = -1 // end of the characters skipped since `prev`
    for (let k = 0; k < item.str.length; k++) {
      const piece = normalizeText(item.str[k])
      if (piece !== '' && piece !== ' ' && text[t] === ' ') {
        segs.push({ text: ' ', src: null, linear: false })
        t++
      }
      if (piece !== '' && text.startsWith(piece, t)) {
        if (prev?.src && skippedTo === k) {
          prev.src.end = k
          prev.linear = false
        }
        const src = { page: item.page, itemIndex: item.index, start: k, end: k + 1 }
        prev = { text: piece, src, linear: piece.length === 1 }
        segs.push(prev)
        skippedTo = -1
        t += piece.length
      } else if (piece === '' || /^\s+$/.test(piece)) {
        if (prev) skippedTo = k + 1
      } else {
        ok = false
        break outer
      }
    }
  }
  if (!ok || t < text.length) segs.push({ text: text.slice(t), src: null, linear: false })
  return merge(segs)
}

/** Merges neighbouring linear segments over contiguous characters of the same item. */
function merge(segs: Segment[]): Segment[] {
  const out: Segment[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (
      last?.linear &&
      s.linear &&
      last.src &&
      s.src &&
      last.src.page === s.src.page &&
      last.src.itemIndex === s.src.itemIndex &&
      last.src.end === s.src.start
    ) {
      last.text += s.text
      last.src.end = s.src.end
    } else out.push(copy(s))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Editing segments
// ---------------------------------------------------------------------------------------------

const copy = (s: Segment): Segment => ({ ...s, src: s.src && { ...s.src } })

/** Up to the last `n` characters of the segments' text. */
function lastChars(segs: Segment[], n: number): string {
  let s = ''
  for (let i = segs.length - 1; i >= 0 && s.length < n; i--) s = segs[i].text + s
  return s.slice(-n)
}

/** Removes the last character (the hyphen being de-hyphenated), and its source with it. */
function dropLastChar(segs: Segment[]): void {
  while (segs.length && segs[segs.length - 1].text === '') segs.pop()
  const last = segs[segs.length - 1]
  if (!last) return
  if (last.text.length === 1) {
    segs.pop()
    return
  }
  const shorter = sub(last, 0, last.text.length - 1)
  segs[segs.length - 1] = shorter
}

/** A copy of the part of one segment covering [a, b) of its text. */
function sub(s: Segment, a: number, b: number): Segment {
  const text = s.text.slice(a, b)
  if (!s.src) return { text, src: null, linear: false }
  if (!s.linear) return { text, src: { ...s.src }, linear: false }
  return { text, src: { ...s.src, start: s.src.start + a, end: s.src.start + b }, linear: true }
}

/** Copies of the segments covering [start, end) of the text. */
function slice(segs: Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = []
  let off = 0
  for (const s of segs) {
    if (off >= end) break
    const next = off + s.text.length
    const a = Math.max(start, off)
    const b = Math.min(end, next)
    if (a < b) out.push(sub(s, a - off, b - off))
    off = next
  }
  return out
}

/** The segments with the sorted, non-overlapping [start, end) ranges taken out. */
function cut(segs: Segment[], ranges: Array<[number, number]>): Segment[] {
  const total = segs.reduce((n, s) => n + s.text.length, 0)
  const out: Segment[] = []
  let from = 0
  for (const [a, b] of [...ranges, [total, total] as [number, number]]) {
    if (a > from) out.push(...slice(segs, from, a))
    from = b
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------------

function mapper(segs: Segment[]): (start: number, end: number) => Span[] {
  const offsets: number[] = []
  let total = 0
  for (const s of segs) {
    offsets.push(total)
    total += s.text.length
  }
  return (start, end) => {
    start = Math.max(0, start)
    end = Math.min(total, end)
    const spans: Span[] = []
    if (start >= end) return spans
    // Binary search for the first segment that ends after `start`.
    let lo = 0
    let hi = segs.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (offsets[mid] + segs[mid].text.length <= start) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < segs.length && offsets[i] < end; i++) {
      const s = segs[i]
      if (!s.src) continue
      let span: Span
      if (s.linear) {
        const a = Math.max(start, offsets[i]) - offsets[i]
        const b = Math.min(end, offsets[i] + s.text.length) - offsets[i]
        span = { ...s.src, start: s.src.start + a, end: s.src.start + b }
      } else span = { ...s.src }
      const last = spans[spans.length - 1]
      if (
        last &&
        last.page === span.page &&
        last.itemIndex === span.itemIndex &&
        span.start >= last.start &&
        span.start <= last.end
      )
        last.end = Math.max(last.end, span.end)
      else spans.push(span)
    }
    return spans
  }
}
