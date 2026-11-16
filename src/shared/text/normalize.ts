const LIGATURES: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl'
}

/**
 * Plain-text form used for matching and speech: expands the ff/fi/fl/ffi/ffl ligatures, removes soft
 * hyphens (U+00AD), turns no-break (U+00A0) and thin (U+2009) spaces into spaces and collapses runs of
 * spaces. It does not trim. Text items keep their original characters; callers that map normalized
 * text back to items must allow for the length changes.
 */
export function normalizeText(s: string): string {
  return s
    .replace(/[\uFB00-\uFB04]/g, (c) => LIGATURES[c])
    .replace(/\u00AD/g, '')
    .replace(/[\u00A0\u2009]/g, ' ')
    .replace(/ {2,}/g, ' ')
}
