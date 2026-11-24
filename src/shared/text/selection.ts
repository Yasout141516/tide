import type { Sentence } from './types'

/** A character position in the page text: which text item, and how many characters into its `str`. */
export interface Point {
  page: number
  itemIndex: number
  offset: number
}

const cmp = (a: Point, b: Point): number =>
  a.page - b.page || a.itemIndex - b.itemIndex || a.offset - b.offset

/**
 * The inclusive sentence range a selection from `a` to `b` touches (either order): the first and last
 * sentence with a span that overlaps the selection (ends after the earlier point and starts before the
 * later one). Text between a sentence's spans (a page header) is not part of it. Null when no sentence
 * overlaps (the selection sits in skipped text).
 */
export function selectionSentences(
  sentences: Sentence[],
  a: Point,
  b: Point
): [number, number] | null {
  const [from, to] = cmp(a, b) <= 0 ? [a, b] : [b, a]
  const touched = (s: Sentence): boolean =>
    s.spans.some(
      (sp) =>
        cmp({ page: sp.page, itemIndex: sp.itemIndex, offset: sp.end }, from) > 0 &&
        cmp({ page: sp.page, itemIndex: sp.itemIndex, offset: sp.start }, to) < 0
    )
  const first = sentences.findIndex(touched)
  if (first < 0) return null
  return [first, sentences.findLastIndex(touched)]
}
