// Builds the `export:start` spec inside main's limits (src/shared/export-limits.ts), so a long title,
// file name or sentence never turns into an unrecoverable "something went wrong".
import type { ExportSpec } from '../../../shared/ipc-types'
import { MAX_NAME, MAX_SENTENCES, MAX_TEXT } from '../../../shared/export-limits'

const isHighSurrogate = (c: number): boolean => c >= 0xd800 && c <= 0xdbff

/** The longest cut of `s` of at most `max` characters, at a word boundary where one exists in the back half. */
function cutPoint(s: string, max: number): number {
  if (s.length <= max) return s.length
  // Cutting before a whitespace character is already at a boundary.
  let at = /\s/.test(s[max]) ? max : -1
  if (at < 0) {
    for (let i = max - 1; i > max / 2; i--) {
      if (/\s/.test(s[i])) {
        at = i
        break
      }
    }
  }
  if (at < 0) {
    at = max // one very long word: cut hard, but never inside a surrogate pair
    if (isHighSurrogate(s.charCodeAt(at - 1))) at -= 1
  }
  return at
}

/** `s` cut to at most `max` characters, at a word boundary where possible. */
export function clampText(s: string, max: number): string {
  return s.slice(0, cutPoint(s, max)).trimEnd()
}

/** Pieces of `text`, each at most `max` characters, split at word boundaries; nothing is lost but spaces at the joins. */
export function splitLongText(text: string, max: number = MAX_TEXT): string[] {
  const pieces: string[] = []
  let rest = text
  while (rest.length > max) {
    const at = cutPoint(rest, max)
    const piece = rest.slice(0, at).trim()
    if (piece) pieces.push(piece)
    rest = rest.slice(at).trimStart()
  }
  if (rest.trim()) pieces.push(rest.trim())
  return pieces
}

/** Sentences as main takes them: blank ones dropped, long ones split into pieces on the same page. */
export function exportSentences(
  spoken: { text: string; page: number }[]
): { text: string; page: number }[] {
  const out: { text: string; page: number }[] = []
  for (const s of spoken) {
    if (s.text.trim() === '') continue
    if (s.text.length <= MAX_TEXT) out.push(s)
    else for (const text of splitLongText(s.text)) out.push({ text, page: s.page })
  }
  return out
}

export const tooLongForOneFile = (sentences: { length: number }): boolean =>
  sentences.length > MAX_SENTENCES

export const TOO_LONG_MESSAGE =
  'This reading is too long for one file. Save a range of pages instead.'

/** The spec for `export:start`, with the names cut to main's limit. `sentences` come from exportSentences. */
export function buildExportSpec(
  o: Omit<ExportSpec, 'baseName' | 'title'> & {
    baseName: string
    title: string
  }
): ExportSpec {
  return {
    ...o,
    baseName: clampText(o.baseName, MAX_NAME),
    title: clampText(o.title, MAX_NAME)
  }
}
