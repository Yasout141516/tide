const BOUNDARIES = new Set([',', ';', ':', '—'])
const WINDOW = 160

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

/** Split once at the first clause boundary so the first audio is short. Pieces rejoin exactly to `text`. */
export function firstClips(text: string): string[] {
  const limit = Math.min(text.length, WINDOW)
  for (let i = 0; i < limit; i++) {
    if (!BOUNDARIES.has(text[i])) continue
    // , ; : only count before whitespace, so "1,000" and "12:30" stay whole
    if (text[i] !== '—' && !/\s/.test(text[i + 1] ?? '')) continue
    if (wordCount(text.slice(0, i)) >= 4 && wordCount(text.slice(i + 1)) >= 3) {
      return [text.slice(0, i + 1), text.slice(i + 1)]
    }
  }
  return [text]
}
