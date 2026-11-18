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
 * segments are dropped.
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
  return out
}
