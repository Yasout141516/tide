/** Words after which a sentence segmenter's break is not a real sentence end (lowercase, with the dot). */
const ABBREVIATIONS = new Set([
  'e.g.',
  'i.e.',
  'et al.',
  'p.',
  'pp.',
  'fig.',
  'vs.',
  'dr.',
  'mr.',
  'ms.',
  'mrs.',
  'cf.',
  'ca.',
  'no.',
  'vol.',
  'ch.',
  'ed.',
  'eds.'
])

/** Shorter (trimmed) segments are not sentences of their own, e.g. "A." or "4)". */
const MIN_SENTENCE_CHARS = 3

let segmenter: Intl.Segmenter | undefined

/** A question or exclamation, possibly inside closing quotes or brackets: "...listening?”". */
const ENDS_QUESTION_OR_EXCLAMATION = /[?!]["'”’)\]]*$/

/** Words that start a sentence: a single capital letter before one of them is a word, not an initial. */
const SENTENCE_STARTERS = new Set(
  (
    'The This These That Those It Its In On At A An As However We They He She There But And For ' +
    'When While Although If Our Their Such Some Many Most Each One'
  ).split(' ')
)

/**
 * True when a trimmed segment must not end a sentence: it ends in an abbreviation or a single-letter
 * initial ("J." in "J. K. Rowan", "T." in "Barlow, T. M."), or is tiny. `next` is the trimmed segment
 * after it: an initial followed by a sentence starter ("vitamin C. The body") does end the sentence.
 */
function continues(trimmed: string, next: string | undefined): boolean {
  if (trimmed.length < MIN_SENTENCE_CHARS) return true
  if (/(^|\s)et al\.$/i.test(trimmed)) return true
  // Leading brackets/quotes are not part of the word: "(e.g." and "(A." count.
  const last = trimmed.slice(trimmed.lastIndexOf(' ') + 1).replace(/^[("'“‘[]+/, '')
  if (ABBREVIATIONS.has(last.toLowerCase())) return true
  if (!/^[A-Z]\.$/.test(last)) return false
  // Another initial ("A.") is never a sentence start: "Smith, J. A. found it" stays whole.
  if (next && /^[A-Z]\.(\s|$)/.test(next)) return true
  const nextWord = next?.replace(/^[("'“‘[]+/, '').match(/^[A-Za-z]+/)?.[0]
  return !(nextWord && SENTENCE_STARTERS.has(nextWord))
}

/**
 * Splits one block of spoken text into sentences, as [start, end) ranges of `blockText` with no
 * whitespace at either end.
 *
 * Uses `Intl.Segmenter('en', { granularity: 'sentence' })`, then merges a segment into the next when
 * it ends in a known abbreviation ("e.g.", "et al.", "p.", "Fig." ...) or is under 3 characters once
 * trimmed, or ends in a single capital-letter initial ("J. K. Rowan") unless the next segment starts with a
 * common sentence starter ("Take vitamin C. The body needs it."). A segment that starts with
 * a lowercase letter (or "(" + lowercase) right after a "?" or "!" (the segmenter breaks after `?”` in
 * `“Is anyone listening?” the tutor asked.`) joins the sentence before it. A tiny LAST segment has no
 * next one, so it joins the previous sentence (a lone "6" after a contents line). Whitespace-only
 * segments are dropped. A sentence over `MAX_SENTENCE_CHARS` is then cut into pieces at clause
 * boundaries (see `capRange`), so no single utterance monopolises the voice.
 */
export function segmentSentences(blockText: string): { start: number; end: number }[] {
  segmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' })
  const out: { start: number; end: number }[] = []
  let pending: { start: number; end: number } | null = null
  const segments = [...segmenter.segment(blockText)]
  for (const [k, { segment, index }] of segments.entries()) {
    const lead = segment.length - segment.trimStart().length
    const trimmed = segment.trim()
    if (!trimmed) continue
    const start = index + lead
    const end = start + trimmed.length
    if (!pending) {
      const prev = out[out.length - 1]
      const resumesPrev =
        prev &&
        /^[([]?[a-z]/.test(trimmed) &&
        ENDS_QUESTION_OR_EXCLAMATION.test(blockText.slice(prev.start, prev.end))
      pending = resumesPrev ? out.pop()! : { start, end }
    }
    pending.end = end
    if (continues(trimmed, segments[k + 1]?.segment.trim())) continue
    out.push(pending)
    pending = null
  }
  if (pending) {
    const tiny = blockText.slice(pending.start, pending.end).length < MIN_SENTENCE_CHARS
    if (tiny && out.length > 0) out[out.length - 1].end = pending.end
    else out.push(pending)
  }
  return capSentences(blockText, out)
}

/** No sentence handed to the voice is longer than about this many characters. */
export const MAX_SENTENCE_CHARS = 300
/** A clause break is only used when it leaves at least this many characters in the piece. */
const MIN_PIECE_CHARS = 60

/**
 * Splits one [start, end) range of `text` (no whitespace at either end) into pieces of at most
 * `max` characters, again as ranges with no whitespace at either end. Each cut goes after the last
 * `;` or `:` in the window (then a comma, then a dash), else at the last space, else mid-word. The
 * pieces cover every non-space character exactly once, so spans mapped from them stay exact.
 */
function capRange(
  text: string,
  start: number,
  end: number,
  max: number
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let from = start
  while (end - from > max) {
    // Keep at least MIN_PIECE_CHARS (after the cut's space) for the rest, so no tiny tail piece is left.
    const limit = Math.min(max, end - from - MIN_PIECE_CHARS - 1)
    const window = text.slice(from, from + limit + 1)
    let cut = -1
    // [pattern, where the piece ends relative to the match start]: after the punctuation, or before a dash.
    for (const [re, offset] of [
      [/[;:]\s/g, 1],
      [/,\s/g, 1],
      [/\s[–—-]\s|[–—]/g, 0]
    ] as const) {
      let m: RegExpExecArray | null
      let best = -1
      while ((m = re.exec(window))) {
        const at = m.index + offset
        if (at >= MIN_PIECE_CHARS && at <= limit) best = at
      }
      if (best >= 0) {
        cut = best
        break
      }
    }
    if (cut < 0) {
      const space = window.lastIndexOf(' ', limit)
      cut = space >= MIN_PIECE_CHARS ? space : limit
    }
    const pieceEnd = from + cut
    const trimmedEnd = from + text.slice(from, pieceEnd).trimEnd().length
    out.push({ start: from, end: trimmedEnd })
    from = pieceEnd + (text.slice(pieceEnd).length - text.slice(pieceEnd).trimStart().length)
  }
  if (from < end) out.push({ start: from, end })
  return out
}

/** Applies `capRange` to every sentence range. */
export function capSentences(
  text: string,
  ranges: { start: number; end: number }[],
  max = MAX_SENTENCE_CHARS
): { start: number; end: number }[] {
  return ranges.flatMap((r) => (r.end - r.start > max ? capRange(text, r.start, r.end, max) : [r]))
}
