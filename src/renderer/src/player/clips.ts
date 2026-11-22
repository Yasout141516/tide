const BOUNDARIES = new Set([',', ';', ':', '—'])
const WINDOW = 160

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

export interface FirstClipsOptions {
  /**
   * Prefer a boundary within the first N words (as few as 2 before it), so the first audio is
   * shorter. Falls back to the usual rule when there is none.
   */
  maxFirstWords?: number
}

function isBoundary(text: string, i: number): boolean {
  if (!BOUNDARIES.has(text[i])) return false
  // , ; : only count before whitespace, so "1,000" and "12:30" stay whole
  return text[i] === '—' || /\s/.test(text[i + 1] ?? '')
}

/** Split once at the first clause boundary so the first audio is short. Pieces rejoin exactly to `text`. */
export function firstClips(text: string, opts: FirstClipsOptions = {}): string[] {
  const limit = Math.min(text.length, WINDOW)
  const { maxFirstWords } = opts
  if (maxFirstWords !== undefined) {
    for (let i = 0; i < limit; i++) {
      if (!isBoundary(text, i)) continue
      const before = wordCount(text.slice(0, i))
      if (before > maxFirstWords) break
      if (before >= 2 && wordCount(text.slice(i + 1)) >= 3) {
        return [text.slice(0, i + 1), text.slice(i + 1)]
      }
    }
  }
  for (let i = 0; i < limit; i++) {
    if (!isBoundary(text, i)) continue
    if (wordCount(text.slice(0, i)) >= 4 && wordCount(text.slice(i + 1)) >= 3) {
      return [text.slice(0, i + 1), text.slice(i + 1)]
    }
  }
  if (maxFirstWords !== undefined) {
    const at = wordSplit(text, maxFirstWords)
    if (at !== null) return [text.slice(0, at), text.slice(at)]
  }
  return [text]
}

const CLOSERS = new Set([')', ']', '}', '"', "'", '”', '’', '»'])

/** Index just after word `n` (so a clip never ends inside a word, number or time), or null. */
function wordSplit(text: string, n: number): number | null {
  const words = [...text.matchAll(/\S+/g)]
  for (let w = n - 1; w < words.length - 3; w++) {
    const next = words[w + 1][0]
    if (w < 1 || CLOSERS.has(next[0])) continue
    return words[w].index + words[w][0].length
  }
  return null
}
