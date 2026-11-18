import { tocTitle } from './filters'
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
 * Word parts that start hyphenated compounds ("self-concept", "well-being", "long-term"): a line break
 * right after one of them may keep the hyphen (see `SpokenText.keepsHyphen`). Prefixes that also start
 * many unhyphenated words ("pre", "re", "co") are left out.
 */
const COMPOUND_PREFIXES: ReadonlySet<string> = new Set([
  'self',
  'well',
  'long',
  'short',
  'high',
  'low',
  'non',
  'cross',
  'multi',
  'full',
  'half',
  'mid',
  'semi',
  'ex',
  'counter',
  'anti',
  'inter',
  'intra',
  'post'
])

/** The lowercased hyphenated words ("decision-making") written within a line of `lines`. */
export function hyphenatedWordsIn(lines: Iterable<Line>): Set<string> {
  const out = new Set<string>()
  for (const l of lines)
    for (const m of l.text.matchAll(/\b[a-z]+-[a-z]+\b/gi)) out.add(m[0].toLowerCase())
  return out
}

/** A word: a run of letters, keeping inner apostrophes ("don't"); a hyphen splits it. */
const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g

/**
 * The lowercased words of `lines`, in the same order `hyphenatedWordsIn` takes them, not counting the
 * two halves of a word split by a line-break hyphen ("ex-" / "perience"): they are not words.
 *
 * The second half is the first word of the line after one ending in letter + "-", when that line
 * starts with a lowercase letter. On a new page the first line starting with a lowercase letter is
 * taken instead, so a running header or page number in between does not hide it.
 */
export function documentWordsIn(lines: Iterable<Line>): Set<string> {
  const out = new Set<string>()
  let splitOnPage: number | null = null // page of the last line that ended in letter + "-"
  for (const l of lines) {
    let words: string[] = l.text.match(WORD) ?? []
    if (splitOnPage !== null) {
      if (/^[a-z]/.test(l.text)) {
        words = words.slice(1)
        splitOnPage = null
      } else if (l.page === splitOnPage || l.page > splitOnPage + 1) splitOnPage = null
    }
    if (/[A-Za-z]-$/.test(l.text)) {
      words = words.slice(0, -1)
      splitOnPage = l.page
    }
    for (const w of words) out.add(w.toLowerCase())
  }
  return out
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
  private readonly hyphenatedWords: ReadonlySet<string>
  private readonly documentWords: ReadonlySet<string>

  /**
   * @param options.hyphenatedWords lowercased hyphenated words ("decision-making") that the document
   *   writes unbroken somewhere (see `hyphenatedWordsIn`): such a word split at its hyphen by a line
   *   break keeps the hyphen.
   * @param options.documentWords the document's lowercased words (see `documentWordsIn`), used to
   *   tell a compound split at its hyphen ("self-" + "concept") from a word split by hyphenation
   *   ("ex-" + "perience").
   */
  constructor(
    options: { hyphenatedWords?: ReadonlySet<string>; documentWords?: ReadonlySet<string> } = {}
  ) {
    this.hyphenatedWords = options.hyphenatedWords ?? new Set()
    this.documentWords = options.documentWords ?? new Set()
  }

  /**
   * Appends a line to the current block, joined with a space - or, when the block ends with a letter
   * + "-" and the line starts with a lowercase letter, with no space: the hyphen is kept for a
   * compound ("self-" + "concept", see `keepsHyphen`) and dropped otherwise ("atten-" + "tion",
   * "ex-" + "perience").
   */
  appendLine(line: Line): void {
    // A table-of-contents entry is a block of its own, spoken as its title: no leader, no page number.
    const title = tocTitle(line.text)
    if (title !== null) {
      this.hardBreak()
      this.appendText({ ...line, text: title })
      this.hardBreak()
      return
    }
    this.appendText(line)
  }

  private appendText(line: Line): void {
    const segs = lineSegments(line)
    if (segs.length === 0) return
    if (this.current.length > 0) {
      const tail = lastChars(this.current, 2)
      if (/[A-Za-z]-$/.test(tail) && /^[a-z]/.test(segs[0].text)) {
        const left = /([A-Za-z]+)-$/.exec(lastChars(this.current, 64))![1]
        const right = /^[A-Za-z]+/.exec(line.text)?.[0] ?? ''
        if (!this.keepsHyphen(left, right)) dropLastChar(this.current)
      } else if (!/\s$/.test(tail)) this.current.push({ text: ' ', src: null, linear: false })
    }
    for (const s of segs) this.current.push(s)
  }

  /**
   * Whether "left-" + "right" split by a line break is a hyphenated compound, checked in order:
   * 0. the left part is "self": keep the hyphen, whatever the document's words (hyphenation
   *    virtually never breaks an ordinary word right after "self", and "self-" compounds are common
   *    in psychology readings: "self-" + "regulation");
   * 1. the document writes "left-right" unbroken somewhere: keep the hyphen;
   * 2. the document writes "leftright" as one word somewhere ("experience"): drop it;
   * 3. otherwise keep it only when the left part is a compound prefix ("well", "long", "non"...) AND
   *    the right part is a word of the document ("concept"); "ex-" + "perience" or "inter-" + "est"
   *    are hyphenated words, not compounds.
   */
  private keepsHyphen(left: string, right: string): boolean {
    const l = left.toLowerCase()
    const r = right.toLowerCase()
    if (l === 'self') return true
    if (this.hyphenatedWords.has(`${l}-${r}`)) return true
    if (this.documentWords.has(l + r)) return false
    return COMPOUND_PREFIXES.has(l) && this.documentWords.has(r)
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
/**
 * The single characters `normalizeText` changes: the ff/fi/fl/ffi/ffl ligatures, the soft hyphen and
 * the no-break and thin spaces (collapsing runs of spaces never applies to one character). Every
 * other character normalizes to itself.
 */
const CHANGED_BY_NORMALIZE = /[\uFB00-\uFB04\u00AD\u00A0\u2009]/

function lineSegments(line: Line): Segment[] {
  const text = line.text
  const segs: Segment[] = []
  let t = 0
  let ok = true
  outer: for (const item of line.items) {
    let prev: Segment | null = null // the item's last emitted segment
    let skippedTo = -1 // end of the characters skipped since `prev`
    for (let k = 0; k < item.str.length; k++) {
      const ch = item.str[k]
      const piece = CHANGED_BY_NORMALIZE.test(ch) ? normalizeText(ch) : ch
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

/** The segments with the sorted, non-overlapping [start, end) ranges taken out (one forward pass). */
function cut(segs: Segment[], ranges: Array<[number, number]>): Segment[] {
  const out: Segment[] = []
  let r = 0 // first range that may still overlap the cursor
  let off = 0 // text offset of the current segment
  for (const s of segs) {
    const next = off + s.text.length
    let pos = off
    while (pos < next) {
      while (r < ranges.length && ranges[r][1] <= pos) r++
      const [a, b] = r < ranges.length ? ranges[r] : [Infinity, Infinity]
      if (pos < a) {
        const keepTo = Math.min(a, next)
        out.push(sub(s, pos - off, keepTo - off))
        pos = keepTo
      } else pos = Math.min(b, next)
    }
    off = next
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
