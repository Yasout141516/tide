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
 * The inclusive sentence range a selection from `a` to `b` touches (either order): the first sentence
 * with a span ending after the earlier point, the last with a span starting before the later one.
 * Null when no sentence overlaps (the selection sits in skipped text).
 */
export function selectionSentences(
  sentences: Sentence[],
  a: Point,
  b: Point
): [number, number] | null {
  const [from, to] = cmp(a, b) <= 0 ? [a, b] : [b, a]
  const first = sentences.findIndex((s) =>
    s.spans.some((sp) => cmp({ page: sp.page, itemIndex: sp.itemIndex, offset: sp.end }, from) > 0)
  )
  if (first < 0) return null
  let last = -1
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (
      sentences[i].spans.some(
        (sp) => cmp({ page: sp.page, itemIndex: sp.itemIndex, offset: sp.start }, to) < 0
      )
    ) {
      last = i
      break
    }
  }
  return last < first ? null : [first, last]
}
