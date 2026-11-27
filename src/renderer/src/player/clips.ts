const BOUNDARIES = new Set([',', ';', ':', '—'])
const CLOSERS = new Set([')', ']', '}', '"', "'", '”', '’', '»'])
/** A piece is never cut so that fewer than this many words are left behind it. */
const MIN_REST_WORDS = 3
/** A sentence this many words over the first limit is still not split. */
const SLACK_WORDS = 2

export interface ProgressiveOptions {
  /** Most words in the first piece (default 8). */
  firstWords?: number
  /**
   * How much larger each piece is aimed to be than the one before (1..2, default 2; never over
   * twice the previous piece). A piece
   * is ready in time only while its synthesis (RTF x its audio) fits inside the previous piece's
   * audio, so the caller passes about 1 / RTF.
   */
  growth?: number
}

function isBoundary(text: string, i: number): boolean {
  if (!BOUNDARIES.has(text[i])) return false
  // , ; : only count before whitespace, so "1,000" and "12:30" stay whole
  return text[i] === '—' || /\s/.test(text[i + 1] ?? '')
}

/**
 * Cut a sentence into pieces whose word counts grow step by step: the first is at most
 * `firstWords`, each next at most `growth` times the previous, so the audio of one piece covers
 * the synthesis of the next and playback never waits mid-sentence. A cut is at a clause
 * boundary when one lies in the last quarter of the allowed span, otherwise at a word boundary
 * (never inside a word, number or time). Pieces rejoin exactly to `text`; a short sentence
 * stays whole.
 */
export function progressiveClips(text: string, opts: ProgressiveOptions = {}): string[] {
  const firstWords = Math.max(2, Math.floor(opts.firstWords ?? 8))
  const growth = Math.min(2, Math.max(1, opts.growth ?? 2))
  const words = [...text.matchAll(/\S+/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length
  }))
  const n = words.length
  const pieces: string[] = []
  let from = 0 // first word of the next piece
  let at = 0 // character offset where it starts
  let limit = firstWords // nominal size of the next piece: grows by `growth` per piece
  let reach = firstWords // hard cap: twice the last piece, so a short clause cut never meets a huge next piece
  // a sentence only slightly over the first limit is kept whole: an extra join costs more than it saves
  while (n - from > Math.min(limit, reach) + (from === 0 ? SLACK_WORDS : 0)) {
    const maxCut = Math.min(limit, reach, n - from - MIN_REST_WORDS) // words in this piece
    if (maxCut < 2) break
    let cutWords = 0
    let cutAt = 0
    const minCut = Math.min(maxCut, Math.ceil(limit * 0.75))
    for (let w = from; w < from + maxCut; w++) {
      // a clause boundary inside word w (its punctuation is attached to it)
      for (let i = words[w].start; i < words[w].end; i++) {
        if (!isBoundary(text, i)) continue
        const count = w - from + 1
        if (count >= minCut) {
          cutWords = count
          cutAt = i + 1
        }
      }
    }
    if (cutWords === 0) {
      for (let m = maxCut; m >= 2; m--) {
        if (CLOSERS.has(text[words[from + m].start])) continue
        cutWords = m
        cutAt = words[from + m - 1].end
        break
      }
    }
    if (cutWords === 0) break
    pieces.push(text.slice(at, cutAt))
    at = cutAt
    from += cutWords
    limit = Math.max(1, Math.floor(limit * growth)) // nominal: a short clause cut does not shrink later pieces
    reach = 2 * cutWords
  }
  pieces.push(text.slice(at))
  return pieces
}
